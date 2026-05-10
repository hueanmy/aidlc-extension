/**
 * Register the bundled `ast-graph` binary as a `local`-scoped MCP server
 * via the `claude mcp` CLI. Local scope = scoped to one project dir,
 * which matches our per-workspace db.
 *
 * We re-run `claude mcp add` whenever the binary path or db path change
 * (e.g. version bump, workspace switch). `claude mcp` is idempotent —
 * it overwrites an existing entry with the same name.
 *
 * Failure modes (all non-fatal, surfaced via the returned status):
 *   - `claude` not on PATH (user installed extension but not the CLI)
 *   - `claude mcp add` returns non-zero
 *   - The CLI takes longer than 15s to respond
 */

import { execFile } from 'child_process';

export interface McpRegistration {
  ok: boolean;
  /** When false, this string explains why (CLI missing, timeout, error). */
  reason: string;
}

const MCP_NAME = 'ast-graph';
const ADD_TIMEOUT_MS = 15_000;

interface RegisterOpts {
  binPath: string;
  dbPath: string;
  cwd: string;
  claudeBin?: string;
}

/**
 * Run `claude mcp add ast-graph --scope local -- <binPath> mcp --db <dbPath>`
 * inside `cwd` (the workspace folder). Returns a status object — callers
 * decide whether to surface the failure to the user.
 */
export function registerMcpServer(opts: RegisterOpts): Promise<McpRegistration> {
  const claude = opts.claudeBin ?? 'claude';
  const args = [
    'mcp',
    'add',
    MCP_NAME,
    '--scope',
    'local',
    '--',
    opts.binPath,
    'mcp',
    '--db',
    opts.dbPath,
  ];

  return new Promise((resolve) => {
    execFile(
      claude,
      args,
      { timeout: ADD_TIMEOUT_MS, cwd: opts.cwd },
      (err, _stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            resolve({ ok: false, reason: `\`${claude}\` not found on PATH — install Claude Code CLI to enable MCP.` });
            return;
          }
          if (code === 'ETIMEDOUT') {
            resolve({ ok: false, reason: 'claude mcp add timed out (>15s).' });
            return;
          }
          resolve({
            ok: false,
            reason: (stderr || err.message).toString().trim().split(/\r?\n/).slice(-3).join(' | '),
          });
          return;
        }
        resolve({ ok: true, reason: '' });
      },
    );
  });
}

/**
 * Check whether ast-graph is already registered locally for `cwd`.
 * Reads `claude mcp list` and looks for our name. Failure = "unknown",
 * we still attempt to register in that case.
 */
export function isAlreadyRegistered(cwd: string, claudeBin = 'claude'): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      claudeBin,
      ['mcp', 'list'],
      { timeout: 20_000, cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(false); return; }
        const has = stdout
          .split(/\r?\n/)
          .some((line) => line.trim().toLowerCase().startsWith(`${MCP_NAME}:`));
        resolve(has);
      },
    );
  });
}
