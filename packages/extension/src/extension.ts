/**
 * AIDLC Flow extension entry point.
 *
 * v2 architecture: workspace.yaml-driven agents/skills/pipelines. The
 * extension is a thin layer over @aidlc/core that adds:
 *   - sidebar webview launcher
 *   - main-area Builder panel
 *   - command palette wizards (Add Skill / Add Agent / Add Pipeline)
 *   - Claude CLI terminal helper
 *
 * Everything legacy (SDLC epic tree, MCP auto-config, dashboard, settings,
 * review panel, example loader) was removed in 0.8.0. See CHANGELOG for
 * migration notes.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';

import { registerV2WorkspaceCommands } from './v2/workspaceCommands';
import { SidebarWebviewProvider } from './v2/sidebarWebview';
import { themeManager } from './v2/themeManager';
import { registerTokenMonitor } from './v2/tokenMonitor';
import { registerAstGraph } from './v2/astGraph';
import { WORKSPACE_DIR, WORKSPACE_FILENAME } from '@aidlc/core';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('AIDLC');
  context.subscriptions.push(output);

  output.appendLine('Activating AIDLC Flow extension');

  // Theme override manager — owns the persisted `auto|light|dark` choice
  // and broadcasts user toggles to every open webview.
  themeManager.init(context);

  // Commands (Show Workspace Config, Init, Add Skill/Agent/Pipeline, Open
  // Builder, Open Claude CLI). All under `aidlc.*` namespace.
  const { disposables, presetStore } = registerV2WorkspaceCommands(context, output);
  context.subscriptions.push(...disposables);

  // Sidebar webview — minimalist launcher into the Builder panel.
  const sidebar = new SidebarWebviewProvider(context.extensionUri, presetStore);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarWebviewProvider.viewType,
      sidebar,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Watch workspace.yaml so the sidebar (and any open Builder panel) refresh
  // automatically when the user edits the file directly. We don't rely on
  // a single watcher because the user can switch projects mid-session.
  const watcher = createWorkspaceYamlWatcher();
  if (watcher) {
    const refresh = () => sidebar.refresh();
    watcher.onDidChange(refresh, null, context.subscriptions);
    watcher.onDidCreate(refresh, null, context.subscriptions);
    watcher.onDidDelete(refresh, null, context.subscriptions);
    context.subscriptions.push(watcher);
  }

  // Watch project-scoped templates so the sidebar's Workflows section updates
  // when users save / delete templates via the Builder or command palette.
  const templatesWatcher = createTemplatesWatcher();
  if (templatesWatcher) {
    const refresh = () => sidebar.refresh();
    templatesWatcher.onDidChange(refresh, null, context.subscriptions);
    templatesWatcher.onDidCreate(refresh, null, context.subscriptions);
    templatesWatcher.onDidDelete(refresh, null, context.subscriptions);
    context.subscriptions.push(templatesWatcher);
  }

  // Watch project-level Claude assets (.claude/skills, .claude/agents) so
  // the sidebar + builder reflect new / deleted skills + agents without a
  // manual refresh. Global ~/.claude lives outside the workspace so it
  // refreshes only when the panel becomes visible (good enough — users
  // edit globals rarely).
  const claudeWatcher = createClaudeAssetsWatcher();
  if (claudeWatcher) {
    const refresh = () => sidebar.refresh();
    claudeWatcher.onDidChange(refresh, null, context.subscriptions);
    claudeWatcher.onDidCreate(refresh, null, context.subscriptions);
    claudeWatcher.onDidDelete(refresh, null, context.subscriptions);
    context.subscriptions.push(claudeWatcher);
  }

  // Same for AIDLC scope's agent/skill folders — workspace.yaml is already
  // watched, but the .md files referenced from it can change independently.
  const aidlcAssetsWatcher = createAidlcAssetsWatcher();
  if (aidlcAssetsWatcher) {
    const refresh = () => sidebar.refresh();
    aidlcAssetsWatcher.onDidChange(refresh, null, context.subscriptions);
    aidlcAssetsWatcher.onDidCreate(refresh, null, context.subscriptions);
    aidlcAssetsWatcher.onDidDelete(refresh, null, context.subscriptions);
    context.subscriptions.push(aidlcAssetsWatcher);
  }

  // Watch pipeline run state so the sidebar's "Pipeline runs" section
  // updates whenever a step transitions (markStepDone / approve / reject /
  // rerun all rewrite the run JSON).
  const runsWatcher = createRunsWatcher();
  if (runsWatcher) {
    const refresh = () => sidebar.refresh();
    runsWatcher.onDidChange(refresh, null, context.subscriptions);
    runsWatcher.onDidCreate(refresh, null, context.subscriptions);
    runsWatcher.onDidDelete(refresh, null, context.subscriptions);
    context.subscriptions.push(runsWatcher);
  }

  // Re-build watcher when the user opens/closes a folder so a freshly opened
  // project is reflected in the sidebar without a window reload.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sidebar.refresh();
    }),
  );

  // Check for aidlc CLI — prompt once per install if missing.
  checkCliInstalled(context, output);

  // Status bar quick-launcher into the Builder.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.text = '$(rocket) AIDLC';
  status.tooltip = 'Open AIDLC Builder';
  status.command = 'aidlc.openBuilder';
  status.show();
  context.subscriptions.push(status);

  // Token monitor — reads ~/.claude/projects/*.jsonl and shows today/month spend.
  // Ported from claude-token-monitor (https://github.com/emtyty/claude-token-monitor).
  registerTokenMonitor(context, output, context.extensionUri);

  // AST graph — auto-downloads ast-graph CLI, scans workspace in the
  // background, registers it as a Claude MCP server so Claude can read
  // structural code context cheaply instead of grep+read sweeps.
  registerAstGraph(context, output);

  output.appendLine('Activation complete.');
}

export function deactivate(): void {}

/**
 * Check if the `aidlc` CLI is on PATH. Runs asynchronously so activation is
 * never blocked. Prompts once per VS Code install (globalState flag). The flag
 * is set only after the user dismisses/acts on the prompt, so a crashed session
 * doesn't permanently suppress the prompt.
 */
function checkCliInstalled(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  const SEEN_KEY = 'aidlc.cliInstallPromptSeen';
  const cmd = process.platform === 'win32' ? 'where aidlc' : 'which aidlc';

  // Run the check off the activation hot path — no blocking.
  exec(cmd, { timeout: 5000 }, (err, stdout) => {
    if (!err && stdout.trim()) {
      output.appendLine(`aidlc CLI found: ${stdout.trim()}`);
      return;
    }

    output.appendLine('aidlc CLI not found on PATH.');
    if (context.globalState.get<boolean>(SEEN_KEY)) { return; }

    void vscode.window.showInformationMessage(
      'The AIDLC CLI (`aidlc`) is not installed. Install it to run agents, manage workspace config, and watch pipeline runs from the terminal.',
      'Install via npm',
      'Not now',
    ).then((pick) => {
      // Mark seen only after the user responds, so a crashed session re-prompts.
      void context.globalState.update(SEEN_KEY, true);
      if (pick !== 'Install via npm') { return; }
      const terminal = vscode.window.createTerminal({ name: 'AIDLC CLI Setup' });
      terminal.sendText('npm install -g aidlc');
      terminal.show();
      output.appendLine('Opened terminal to run: npm install -g aidlc');
    });
  });
}

/**
 * Watcher for `<workspace>/.aidlc/workspace.yaml`. Returns null when no
 * workspace folder is open — caller should re-create the watcher when one
 * opens via `onDidChangeWorkspaceFolders`.
 */
function createWorkspaceYamlWatcher(): vscode.FileSystemWatcher | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return null; }
  const pattern = new vscode.RelativePattern(
    folder,
    path.join(WORKSPACE_DIR, WORKSPACE_FILENAME),
  );
  return vscode.workspace.createFileSystemWatcher(pattern);
}

/**
 * Watcher for `<workspace>/.aidlc/templates/*.json` — project-scoped user
 * templates. Built-in templates ship with the extension and don't change
 * at runtime, so they don't need a watcher.
 */
function createTemplatesWatcher(): vscode.FileSystemWatcher | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return null; }
  const pattern = new vscode.RelativePattern(
    folder,
    path.join(WORKSPACE_DIR, 'templates', '*.json'),
  );
  return vscode.workspace.createFileSystemWatcher(pattern);
}

/**
 * Watcher for `<workspace>/.claude/{skills,agents}/**` — project-scoped
 * Claude Code native assets. Triggers a refresh on add / change / delete
 * so the catalog the user sees in the Builder is always in sync with
 * disk. The glob is broad on purpose (recursive) — folder-form skills
 * `<id>/SKILL.md` count as a change to the asset itself, not just to a
 * deeply-nested file.
 */
function createClaudeAssetsWatcher(): vscode.FileSystemWatcher | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return null; }
  const pattern = new vscode.RelativePattern(folder, '.claude/{skills,agents}/**');
  return vscode.workspace.createFileSystemWatcher(pattern);
}

/**
 * Watcher for `<workspace>/.aidlc/{skills,agents}/**` — AIDLC-scoped
 * skill / agent .md files. Workspace.yaml has its own watcher; this one
 * picks up edits to the referenced .md files themselves.
 */
function createAidlcAssetsWatcher(): vscode.FileSystemWatcher | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return null; }
  const pattern = new vscode.RelativePattern(folder, '.aidlc/{skills,agents}/**');
  return vscode.workspace.createFileSystemWatcher(pattern);
}

/**
 * Watcher for `<workspace>/.aidlc/runs/*.json` — pipeline run state.
 * Triggers a sidebar refresh whenever a step transitions so the
 * Pipeline runs section reflects the new status / step / revision.
 */
function createRunsWatcher(): vscode.FileSystemWatcher | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return null; }
  const pattern = new vscode.RelativePattern(
    folder,
    path.join(WORKSPACE_DIR, 'runs', '*.json'),
  );
  return vscode.workspace.createFileSystemWatcher(pattern);
}
