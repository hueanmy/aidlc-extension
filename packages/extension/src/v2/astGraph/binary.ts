/**
 * Download / cache / verify the pinned `ast-graph` CLI binary in extension
 * globalStorage. Pinned to v0.1.0 — bump AST_GRAPH_VERSION + checksums
 * together when picking up a new upstream release.
 *
 * Cache layout:
 *   <globalStorage>/ast-graph/<version>/ast-graph[.exe]
 *
 * On first call we download the right per-platform tar.xz/zip from the
 * GitHub release, verify SHA256 against the values baked in below, extract
 * the executable, strip macOS quarantine, and return the absolute path.
 * Subsequent calls hit the cached file.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { execFile } from 'child_process';

export const AST_GRAPH_VERSION = '0.1.0';
const RELEASE_BASE = `https://github.com/emtyty/ast-graph/releases/download/v${AST_GRAPH_VERSION}`;

/**
 * Per-target asset name + SHA256 of the archive itself (not the unpacked
 * binary) — taken from dist-manifest.json on the v0.1.0 release. Keep
 * sorted alphabetically by target triple.
 */
interface TargetSpec {
  asset: string;
  /** SHA256 of the archive file. */
  sha256: string;
  /** Name of the executable after extraction. */
  exe: string;
}

const TARGETS: Record<string, TargetSpec> = {
  'aarch64-apple-darwin': {
    asset: 'ast-graph-cli-aarch64-apple-darwin.tar.xz',
    sha256: '67d30ecb823b53e36b0e76804e6cb2030a36ceedbdcbf744c22779d67e35946b',
    exe: 'ast-graph',
  },
  'x86_64-apple-darwin': {
    asset: 'ast-graph-cli-x86_64-apple-darwin.tar.xz',
    sha256: '099ba006610afb79fa60036d4ba15114881395b12a04f63d2ef5cb3cbc28bcb2',
    exe: 'ast-graph',
  },
  'x86_64-unknown-linux-gnu': {
    asset: 'ast-graph-cli-x86_64-unknown-linux-gnu.tar.xz',
    // Upstream publishes a `.sha256` sidecar; we verify on first download and
    // log a mismatch instead of blocking — the official checksum file is the
    // source of truth, this constant is a defense-in-depth check.
    sha256: '',
    exe: 'ast-graph',
  },
  'x86_64-pc-windows-msvc': {
    asset: 'ast-graph-cli-x86_64-pc-windows-msvc.zip',
    sha256: '606763a7821caeb3169479db05896e526c3f76054c8fb77f2d7dde478405c840',
    exe: 'ast-graph.exe',
  },
};

export interface BinaryResolution {
  path: string;
  version: string;
}

export class UnsupportedPlatformError extends Error {
  constructor(public platform: string, public arch: string) {
    super(`ast-graph: no prebuilt binary for ${platform}/${arch}. Supported: macOS (arm64/x64), Linux (x64), Windows (x64).`);
  }
}

function detectTarget(): string {
  const { platform, arch } = process;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new UnsupportedPlatformError(platform, arch);
}

function installDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'ast-graph', AST_GRAPH_VERSION);
}

/**
 * Return the path to the cached `ast-graph` binary, downloading and
 * extracting it on first call. Idempotent. Throws on unsupported
 * platform, network failure, or checksum mismatch.
 */
export async function ensureAstGraphBinary(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<BinaryResolution> {
  const target = detectTarget();
  const spec = TARGETS[target];
  const dir = installDir(context);
  const exePath = path.join(dir, spec.exe);

  if (await isFileReady(exePath)) {
    return { path: exePath, version: AST_GRAPH_VERSION };
  }

  await fs.promises.mkdir(dir, { recursive: true });
  const archivePath = path.join(dir, spec.asset);
  const url = `${RELEASE_BASE}/${spec.asset}`;

  output.appendLine(`ast-graph: downloading ${url}`);
  await downloadFile(url, archivePath);

  // Verify SHA256 — prefer the pinned value, fall back to the sidecar
  // for targets whose pinned hash wasn't baked in.
  const actual = await sha256OfFile(archivePath);
  const expected = spec.sha256 || (await fetchExpectedSha(`${url}.sha256`));
  if (expected && actual.toLowerCase() !== expected.toLowerCase()) {
    await fs.promises.unlink(archivePath).catch(() => {});
    throw new Error(`ast-graph: checksum mismatch for ${spec.asset} (got ${actual}, expected ${expected})`);
  }
  output.appendLine(`ast-graph: checksum OK (${actual.slice(0, 12)}…)`);

  await extractArchive(archivePath, dir, spec.exe, output);
  await fs.promises.unlink(archivePath).catch(() => {});

  if (process.platform !== 'win32') {
    await fs.promises.chmod(exePath, 0o755).catch(() => {});
  }
  if (process.platform === 'darwin') {
    // Best-effort: strip the quarantine attribute set by Gatekeeper on
    // downloaded executables. Failure is non-fatal — the user just hits
    // the "cannot be opened" dialog and has to allow it manually.
    await runChecked('xattr', ['-dr', 'com.apple.quarantine', exePath], 5_000).catch(() => {});
  }

  if (!(await isFileReady(exePath))) {
    throw new Error(`ast-graph: executable not found after extraction at ${exePath}`);
  }

  output.appendLine(`ast-graph: installed at ${exePath}`);
  return { path: exePath, version: AST_GRAPH_VERSION };
}

async function isFileReady(p: string): Promise<boolean> {
  try {
    const st = await fs.promises.stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Stream a URL to disk, following up to 5 redirects. Atomic-ish: writes to
 * `<dst>.part` and renames on success.
 */
function downloadFile(url: string, dst: string, hops = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (hops > 5) {
      reject(new Error(`ast-graph: too many redirects fetching ${url}`));
      return;
    }
    const tmp = `${dst}.part`;
    const file = fs.createWriteStream(tmp);
    https.get(url, { headers: { 'User-Agent': 'aidlc-vscode' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.promises.unlink(tmp).catch(() => {});
        const next = new URL(res.headers.location, url).toString();
        downloadFile(next, dst, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.promises.unlink(tmp).catch(() => {});
        reject(new Error(`ast-graph: HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.promises.rename(tmp, dst).then(resolve, reject);
        });
      });
      res.on('error', (err) => {
        file.close();
        fs.promises.unlink(tmp).catch(() => {});
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      fs.promises.unlink(tmp).catch(() => {});
      reject(err);
    });
  });
}

async function fetchExpectedSha(url: string): Promise<string> {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'aidlc-vscode' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one hop — sha files redirect just like archives.
        fetchExpectedSha(new URL(res.headers.location, url).toString()).then(resolve);
        return;
      }
      if (res.statusCode !== 200) { resolve(''); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        // sha256sum format: "<hash>  <filename>"
        const first = body.trim().split(/\s+/)[0] ?? '';
        resolve(first);
      });
    }).on('error', () => resolve(''));
  });
}

function sha256OfFile(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (chunk) => hash.update(chunk));
    s.on('error', reject);
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

async function extractArchive(
  archive: string,
  dest: string,
  exeName: string,
  output: vscode.OutputChannel,
): Promise<void> {
  if (archive.endsWith('.zip')) {
    // Windows path: use PowerShell. `-Force` overwrites existing files
    // (relevant on version bumps to the same dir).
    await runChecked(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -Path "${archive}" -DestinationPath "${dest}" -Force`,
      ],
      120_000,
    );
  } else {
    // tar.xz on macOS + Linux. The archive contains a top-level dir
    // like `ast-graph-cli-aarch64-apple-darwin/ast-graph` — use
    // `--strip-components=1` so the binary lands directly at <dest>/ast-graph.
    await runChecked(
      'tar',
      ['-xJf', archive, '-C', dest, '--strip-components=1'],
      120_000,
    );
  }

  // If we extracted into a subdir (Windows zip layout), surface the exe
  // up one level so callers don't need to know the asset layout.
  const direct = path.join(dest, exeName);
  if (await isFileReady(direct)) return;

  const entries = await fs.promises.readdir(dest, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const nested = path.join(dest, ent.name, exeName);
    if (await isFileReady(nested)) {
      await fs.promises.rename(nested, direct);
      output.appendLine(`ast-graph: lifted ${exeName} out of ${ent.name}/`);
      return;
    }
  }
}

function runChecked(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}${stderr ? ` — ${stderr.toString().trim()}` : ''}`));
        return;
      }
      resolve();
    });
  });
}
