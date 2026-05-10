/**
 * AST Graph integration orchestrator. Wires the binary downloader, the
 * scanner, the MCP registration, and the status-bar entry point into a
 * single `registerAstGraph(context, output)` call invoked from
 * `extension.ts`.
 *
 * Lifecycle per workspace folder (primary only — multi-root falls back
 * to the first folder, matching what Claude's `local` MCP scope can
 * actually point at):
 *   1. Resolve binary (download + verify on first run, cache afterwards)
 *   2. Run initial scan with progress notification
 *   3. Register MCP server with Claude CLI (best-effort)
 *   4. Start a debounced file watcher → incremental rescans on save
 *
 * Failures are surfaced via the status-bar pill rather than blocking
 * notifications — the user can click into the report to see what went
 * wrong and retry.
 */

import * as vscode from 'vscode';

import { ensureAstGraphBinary, UnsupportedPlatformError } from './binary';
import {
  createSourceWatcher,
  ensureGitignoreEntry,
  runScan,
  type ScanSummary,
} from './scanner';
import { isAlreadyRegistered, registerMcpServer } from './mcpRegister';
import { ensureClaudeMdHint } from './claudeMdHint';
import { AstGraphReportWebview } from './reportWebview';

const SETTING_NAMESPACE = 'aidlc.astGraph';
const OPEN_REPORT_CMD = 'aidlc.astGraph.openReport';
const RESCAN_CMD = 'aidlc.astGraph.rescan';
const REREGISTER_CMD = 'aidlc.astGraph.reregisterMcp';

interface FolderState {
  folder: vscode.WorkspaceFolder;
  lastScan: ScanSummary | null;
  scanning: boolean;
  mcp: { ok: boolean; reason: string };
  watcher: vscode.Disposable | null;
}

export function registerAstGraph(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  const cfg = () => vscode.workspace.getConfiguration(SETTING_NAMESPACE);
  if (!cfg().get<boolean>('enabled', true)) {
    output.appendLine('AST graph: disabled via aidlc.astGraph.enabled.');
    return;
  }

  // ---- Status bar ----------------------------------------------------------
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  item.text = '$(type-hierarchy) AST …';
  item.tooltip = 'AST graph: preparing…';
  item.command = OPEN_REPORT_CMD;
  item.show();
  context.subscriptions.push(item);

  // ---- Per-folder state ----------------------------------------------------
  const folderStates = new Map<string, FolderState>();
  let binPath: string | null = null;

  const primaryFolder = (): vscode.WorkspaceFolder | undefined =>
    vscode.workspace.workspaceFolders?.[0];

  const primaryState = (): FolderState | undefined => {
    const f = primaryFolder();
    return f ? folderStates.get(f.uri.toString()) : undefined;
  };

  const updateStatusBar = (): void => {
    const f = primaryFolder();
    const s = f ? folderStates.get(f.uri.toString()) : undefined;
    if (!binPath) {
      item.text = '$(cloud-download) AST …';
      item.tooltip = 'AST graph: downloading binary…';
      return;
    }
    if (!s) {
      item.text = '$(type-hierarchy) AST';
      item.tooltip = 'AST graph: no workspace folder.';
      return;
    }
    if (s.scanning) {
      item.text = '$(sync~spin) AST';
      item.tooltip = 'AST graph: scanning…';
      return;
    }
    if (s.lastScan) {
      const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      item.text = `$(type-hierarchy) AST ${k(s.lastScan.nodes)}n`;
      const md = new vscode.MarkdownString();
      md.appendMarkdown('**AST graph**\n\n');
      md.appendMarkdown(`Files: ${s.lastScan.files} · Nodes: ${s.lastScan.nodes} · Edges: ${s.lastScan.edges}\n\n`);
      md.appendMarkdown(`Languages: ${s.lastScan.languages.join(', ') || '—'}\n\n`);
      md.appendMarkdown(`MCP: ${s.mcp.ok ? 'registered' : `off (${s.mcp.reason || 'not registered'})`}\n\n`);
      md.appendMarkdown('Click to open the report.');
      item.tooltip = md;
    } else {
      item.text = '$(type-hierarchy) AST';
      item.tooltip = 'AST graph: no scan yet. Click to open.';
    }
    AstGraphReportWebview.notifyUpdate();
  };

  // ---- Scan + MCP runner ---------------------------------------------------
  async function scanFolder(folder: vscode.WorkspaceFolder, clean: boolean): Promise<void> {
    if (!binPath) {
      output.appendLine('AST graph: binary not ready, scan skipped.');
      return;
    }
    const key = folder.uri.toString();
    const state: FolderState = folderStates.get(key) ?? {
      folder,
      lastScan: null,
      scanning: false,
      mcp: { ok: false, reason: 'not registered yet' },
      watcher: null,
    };
    if (state.scanning) {
      output.appendLine(`AST graph: scan already in flight for ${folder.name}, skipping.`);
      return;
    }
    state.scanning = true;
    folderStates.set(key, state);
    updateStatusBar();

    try {
      await ensureGitignoreEntry(folder);
      const summary = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `ast-graph scan: ${folder.name}`,
        },
        () => runScan({ binPath: binPath!, folder, clean, output }),
      );
      state.lastScan = summary;
      output.appendLine(
        `AST graph: scan done — ${summary.files} files, ${summary.nodes} nodes, ${summary.edges} edges in ${summary.durationMs}ms.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.appendLine(`AST graph: scan failed — ${msg}`);
      void vscode.window.showWarningMessage(`AST graph scan failed: ${msg}`);
    } finally {
      state.scanning = false;
      folderStates.set(key, state);
      updateStatusBar();
    }
  }

  async function registerMcp(folder: vscode.WorkspaceFolder): Promise<void> {
    if (!binPath) return;
    const key = folder.uri.toString();
    const state = folderStates.get(key);
    if (!state || !state.lastScan) return;

    const already = await isAlreadyRegistered(folder.uri.fsPath);
    if (already) {
      state.mcp = { ok: true, reason: 'already registered' };
      folderStates.set(key, state);
      output.appendLine(`AST graph: MCP already registered in ${folder.name}.`);
      updateStatusBar();
      return;
    }
    const result = await registerMcpServer({
      binPath,
      dbPath: state.lastScan.dbPath,
      cwd: folder.uri.fsPath,
    });
    state.mcp = result;
    folderStates.set(key, state);
    if (result.ok) {
      output.appendLine(`AST graph: registered MCP server in ${folder.name}.`);
      // Drop a hint into .claude/CLAUDE.md so Claude actually reaches
      // for ast-graph tools instead of defaulting to grep+read. Without
      // this the MCP server is "available but unused".
      try {
        const hintPath = await ensureClaudeMdHint(folder);
        output.appendLine(`AST graph: CLAUDE.md hint ensured at ${hintPath}`);
      } catch (err) {
        output.appendLine(`AST graph: failed to write CLAUDE.md hint — ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      output.appendLine(`AST graph: MCP registration skipped — ${result.reason}`);
    }
    updateStatusBar();
  }

  function attachWatcher(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    const state = folderStates.get(key);
    if (!state) return;
    if (state.watcher) return; // already attached

    const debounceMs = Math.max(1, cfg().get<number>('autoRescanDebounceSeconds', 5)) * 1000;
    state.watcher = createSourceWatcher({
      folder,
      debounceMs,
      onTrigger: () => {
        // Incremental rescan — don't pass --clean, the CLI re-parses
        // only changed files.
        void scanFolder(folder, false);
      },
    });
    folderStates.set(key, state);
    context.subscriptions.push(state.watcher);
  }

  // ---- Bootstrap (async, non-blocking) -------------------------------------
  async function bootstrap(): Promise<void> {
    try {
      const res = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'Preparing AST graph CLI…',
        },
        () => ensureAstGraphBinary(context, output),
      );
      binPath = res.path;
      output.appendLine(`AST graph: binary ready (v${res.version}) at ${res.path}`);
    } catch (err) {
      if (err instanceof UnsupportedPlatformError) {
        output.appendLine(`AST graph: ${err.message}`);
      } else {
        output.appendLine(`AST graph: binary install failed — ${err instanceof Error ? err.message : String(err)}`);
        void vscode.window.showWarningMessage(
          `AST graph: failed to install the bundled CLI. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      updateStatusBar();
      return;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const f of folders) {
      const key = f.uri.toString();
      if (!folderStates.has(key)) {
        folderStates.set(key, {
          folder: f,
          lastScan: null,
          scanning: false,
          mcp: { ok: false, reason: 'not registered yet' },
          watcher: null,
        });
      }
    }

    updateStatusBar();

    // Only auto-scan the primary folder. Multi-root scans would
    // multiply work and the MCP local scope can only point at one
    // db — users with multi-root setups can switch with `Rescan`.
    const primary = folders[0];
    if (!primary) {
      output.appendLine('AST graph: no workspace folder open, deferring scan.');
      return;
    }
    await scanFolder(primary, false);
    if (folderStates.get(primary.uri.toString())?.lastScan) {
      await registerMcp(primary);
      attachWatcher(primary);
    }
  }

  void bootstrap();

  // ---- Workspace folder change → bootstrap newly added folders -------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (ev) => {
      for (const f of ev.removed) {
        const s = folderStates.get(f.uri.toString());
        if (s?.watcher) s.watcher.dispose();
        folderStates.delete(f.uri.toString());
      }
      for (const f of ev.added) {
        folderStates.set(f.uri.toString(), {
          folder: f,
          lastScan: null,
          scanning: false,
          mcp: { ok: false, reason: 'not registered yet' },
          watcher: null,
        });
      }
      const primary = primaryFolder();
      if (primary && binPath && !folderStates.get(primary.uri.toString())?.lastScan) {
        await scanFolder(primary, false);
        if (folderStates.get(primary.uri.toString())?.lastScan) {
          await registerMcp(primary);
          attachWatcher(primary);
        }
      }
      updateStatusBar();
    }),
  );

  // ---- Runtime exposed to the report webview ------------------------------
  const runtime = {
    binPath: () => binPath,
    lastScan: () => primaryState()?.lastScan ?? null,
    isScanning: () => primaryState()?.scanning ?? false,
    mcpStatus: () => primaryState()?.mcp ?? { ok: false, reason: 'no workspace folder' },
    primaryFolder,
    async rescan(clean: boolean): Promise<void> {
      const f = primaryFolder();
      if (!f) return;
      await scanFolder(f, clean);
      if (primaryState()?.lastScan) {
        await registerMcp(f);
        attachWatcher(f);
      }
    },
    async reregisterMcp(): Promise<void> {
      const f = primaryFolder();
      if (!f) return;
      // Force a re-run by bypassing the "already registered" short-circuit:
      // bump the local state to "not registered" and re-invoke.
      const s = folderStates.get(f.uri.toString());
      if (s) {
        s.mcp = { ok: false, reason: 'reregistering…' };
        folderStates.set(f.uri.toString(), s);
      }
      // Skip the isAlreadyRegistered check on this path by inlining:
      if (!binPath || !s?.lastScan) return;
      const res = await registerMcpServer({
        binPath,
        dbPath: s.lastScan.dbPath,
        cwd: f.uri.fsPath,
      });
      s.mcp = res;
      folderStates.set(f.uri.toString(), s);
      if (res.ok) {
        try {
          await ensureClaudeMdHint(f);
        } catch (err) {
          output.appendLine(`AST graph: failed to refresh CLAUDE.md hint — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      updateStatusBar();
    },
  };

  // ---- Commands ------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_REPORT_CMD, () => AstGraphReportWebview.show(runtime)),
    vscode.commands.registerCommand(RESCAN_CMD, async () => {
      await runtime.rescan(true);
    }),
    vscode.commands.registerCommand(REREGISTER_CMD, async () => {
      await runtime.reregisterMcp();
    }),
  );

  output.appendLine('AST graph: integration registered.');
}
