import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { ensureEpicsBootstrap } from './epicBootstrapper';

const DEFAULT_MCP_PACKAGE = 'github:hueanmy/aidlc-pipeline';
const DEFAULT_FOLDER_NAME = 'aidlc-example';
const SYNC_TIMEOUT_MS = 90_000;
const EXAMPLE_REPO_URL = 'https://github.com/hueanmy/aidlc-pipeline.git';
const EXAMPLE_REPO_SUBFOLDER = path.join('examples', 'demo-project');
const DEMO_DOCS_WRAPPER = path.join('docs', 'demo-project');
const DEMO_EPICS_PATH = path.join(DEMO_DOCS_WRAPPER, 'sdlc', 'epics');
const CLONE_TIMEOUT_MS = 60_000;

export interface ExampleProjectContext {
  extensionPath: string;
  log: (msg: string) => void;
}

export async function loadExampleProject(ctx: ExampleProjectContext): Promise<void> {
  const defaultTarget = path.join(os.homedir(), DEFAULT_FOLDER_NAME);
  const proceed = await vscode.window.showWarningMessage(
    `Create AIDLC example project at ${defaultTarget}? This clones the demo repo, writes .claude/settings.json, and opens the folder in a new window.`,
    { modal: true },
    'Create Example',
  );
  if (proceed !== 'Create Example') {
    return;
  }

  const target = await resolveTargetFolder();
  if (!target) {
    return;
  }

  fs.mkdirSync(target, { recursive: true });
  ctx.log(`Creating example project at ${target}`);

  const fetched = await fetchExampleFromGithub(target, ctx.log);
  if (!fetched) {
    void vscode.window.showErrorMessage(
      `Failed to download example project from ${EXAMPLE_REPO_URL}. Check the SDLC Pipeline output for details.`,
    );
    return;
  }

  const cfg = vscode.workspace.getConfiguration('cfPipeline');
  const mcpPackage = (cfg.get<string>('mcpPackage') || DEFAULT_MCP_PACKAGE).trim() || DEFAULT_MCP_PACKAGE;
  const mcpServerName = (cfg.get<string>('mcpServerName') || 'sdlc').trim() || 'sdlc';
  const mcpCommand = (cfg.get<string>('mcpCommand') || 'npx').trim() || 'npx';
  const platform = cfg.get<string>('platform', 'generic') || 'generic';

  writeMcpSettings(target, { mcpServerName, mcpCommand, mcpPackage, platform });
  ctx.log(`Wrote .claude/settings.json with MCP "${mcpServerName}" -> ${mcpPackage}`);

  writeWorkspaceSettings(target);
  ctx.log(`Pinned cfPipeline.epicsPath = ${DEMO_EPICS_PATH} in .vscode/settings.json`);

  ensureEpicsBootstrap(
    target,
    DEMO_EPICS_PATH,
    path.join(ctx.extensionPath, 'templates', 'generic'),
    (msg) => ctx.log(`[bootstrap] ${msg}`),
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'AIDLC: syncing pipeline (agents, skills, schemas)…',
      cancellable: false,
    },
    () => triggerMcpSync(target, mcpCommand, mcpPackage, ctx.log),
  );

  await openCreatedProject(target);
}

export async function clearExampleProject(ctx: ExampleProjectContext): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.join(os.homedir(), DEFAULT_FOLDER_NAME)),
    openLabel: 'Clear This Example Project',
    title: 'Pick the example project folder to delete',
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const target = picked[0].fsPath;

  if (!looksLikeExampleProject(target)) {
    void vscode.window.showErrorMessage(
      `"${target}" doesn't look like an AIDLC example project (missing ${DEMO_EPICS_PATH} or .claude/settings.json). Aborting to be safe.`,
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Permanently delete "${target}" and everything inside it?`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') {
    return;
  }

  fs.rmSync(target, { recursive: true, force: true });
  ctx.log(`Deleted example project at ${target}`);
  void vscode.window.showInformationMessage(`Removed ${target}.`);
}

async function resolveTargetFolder(): Promise<string | undefined> {
  const target = path.join(os.homedir(), DEFAULT_FOLDER_NAME);

  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `${target} already exists and is not empty. Overwrite it?`,
      { modal: true },
      'Overwrite',
      'Choose Different Location',
    );
    if (choice === 'Overwrite') {
      fs.rmSync(target, { recursive: true, force: true });
      return target;
    }
    if (choice === 'Choose Different Location') {
      return await pickAlternateLocation();
    }
    return undefined;
  }

  return target;
}

async function pickAlternateLocation(): Promise<string | undefined> {
  const parentPick = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(os.homedir()),
    openLabel: 'Create Example Here',
    title: 'Choose a parent folder for the AIDLC example project',
  });
  if (!parentPick || parentPick.length === 0) {
    return undefined;
  }
  const parent = parentPick[0].fsPath;
  const name = await vscode.window.showInputBox({
    title: 'Example project folder name',
    prompt: `It will be created under ${parent}.`,
    value: DEFAULT_FOLDER_NAME,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = (value || '').trim();
      if (!trimmed) {
        return 'Folder name cannot be empty.';
      }
      if (/[\\/]/.test(trimmed)) {
        return 'Folder name cannot contain slashes.';
      }
      return null;
    },
  });
  if (!name) {
    return undefined;
  }
  const target = path.join(parent, name.trim());
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    const ok = await vscode.window.showWarningMessage(
      `${target} already exists and is not empty. Overwrite it?`,
      { modal: true },
      'Overwrite',
    );
    if (ok !== 'Overwrite') {
      return undefined;
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  return target;
}

async function fetchExampleFromGithub(
  target: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-example-'));
  try {
    log(`Cloning ${EXAMPLE_REPO_URL} (depth=1) into ${tmpDir}…`);
    const cloneOk = await runGitClone(tmpDir, log);
    if (!cloneOk) {
      return false;
    }
    const sourceDir = path.join(tmpDir, EXAMPLE_REPO_SUBFOLDER);
    if (!fs.existsSync(sourceDir)) {
      log(`[error] ${EXAMPLE_REPO_SUBFOLDER} not found in cloned repo`);
      return false;
    }
    copyDemoProject(sourceDir, target);
    log(`Copied ${EXAMPLE_REPO_SUBFOLDER} → ${target} (docs wrapped under ${DEMO_DOCS_WRAPPER})`);
    return true;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore tmp cleanup errors */
    }
  }
}

function runGitClone(tmpDir: string, log: (msg: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('git', ['clone', '--depth', '1', EXAMPLE_REPO_URL, tmpDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      log(`[clone] spawn failed: ${err instanceof Error ? err.message : String(err)} — is git installed?`);
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(watchdog);
      try {
        if (!ok && !proc.killed) {
          proc.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
      resolve(ok);
    };

    const watchdog = setTimeout(() => {
      log('[clone] timed out — killing git process');
      finish(false);
    }, CLONE_TIMEOUT_MS);

    const handle = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim().length > 0) {
          log(`[clone] ${line.trim()}`);
        }
      }
    };
    proc.stdout?.on('data', handle);
    proc.stderr?.on('data', handle);
    proc.on('error', (err) => {
      log(`[clone] process error: ${err.message}`);
      finish(false);
    });
    proc.on('close', (code) => {
      if (code === 0) {
        finish(true);
      } else {
        log(`[clone] git exited with code ${code}`);
        finish(false);
      }
    });
  });
}

function copyDemoProject(src: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    if (entry.isDirectory() && entry.name === 'docs') {
      copyRecursive(sp, path.join(target, DEMO_DOCS_WRAPPER));
    } else if (entry.isDirectory()) {
      copyRecursive(sp, path.join(target, entry.name));
    } else if (entry.isFile()) {
      fs.copyFileSync(sp, path.join(target, entry.name));
    }
  }
}

function copyRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(sp, dp);
    } else if (entry.isFile()) {
      fs.copyFileSync(sp, dp);
    }
  }
}

interface McpSettingsInput {
  mcpServerName: string;
  mcpCommand: string;
  mcpPackage: string;
  platform: string;
}

function writeWorkspaceSettings(target: string): void {
  const dir = path.join(target, '.vscode');
  fs.mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, 'settings.json');
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      existing = {};
    }
  }
  const next = {
    ...existing,
    'cfPipeline.epicsPath': DEMO_EPICS_PATH,
  };
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

function writeMcpSettings(target: string, input: McpSettingsInput): void {
  const claudeDir = path.join(target, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settings = {
    mcpServers: {
      [input.mcpServerName]: {
        command: input.mcpCommand,
        args: ['-y', input.mcpPackage],
        env: {
          SDLC_PLATFORM: input.platform,
        },
      },
    },
  };
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify(settings, null, 2) + '\n',
    'utf8',
  );
}

async function triggerMcpSync(
  cwd: string,
  command: string,
  pkg: string,
  log: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, ['-y', pkg], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      log(`[sync] spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
      clearTimeout(watchdog);
      resolve();
    };

    const watchdog = setTimeout(() => {
      log('[sync] timed out — killing MCP boot process');
      finish();
    }, SYNC_TIMEOUT_MS);

    const handle = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) {
          log(`[sync] ${line.trim()}`);
        }
      }
      if (text.includes('Auto-sync completed') || text.includes('MCP server started')) {
        // Give the server ~400ms to flush remaining log lines, then kill.
        setTimeout(finish, 400);
      }
    };

    proc.stdout?.on('data', handle);
    proc.stderr?.on('data', handle);
    proc.on('error', (err) => {
      log(`[sync] process error: ${err.message}`);
      finish();
    });
    proc.on('close', () => finish());
  });
}

async function openCreatedProject(target: string): Promise<void> {
  void vscode.window.showInformationMessage(`AIDLC example project ready at ${target}. Opening…`);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), {
    forceNewWindow: true,
  });
}

function looksLikeExampleProject(target: string): boolean {
  if (!fs.existsSync(target)) {
    return false;
  }
  const settings = path.join(target, '.claude', 'settings.json');
  const epics = path.join(target, DEMO_EPICS_PATH);
  return fs.existsSync(settings) && fs.existsSync(epics);
}
