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

import { registerV2WorkspaceCommands } from './v2/workspaceCommands';
import { SidebarWebviewProvider } from './v2/sidebarWebview';
import { WORKSPACE_DIR, WORKSPACE_FILENAME } from '@aidlc/core';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('AIDLC');
  context.subscriptions.push(output);

  output.appendLine('Activating AIDLC Flow extension');

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

  // Status bar quick-launcher into the Builder.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.text = '$(rocket) AIDLC';
  status.tooltip = 'Open AIDLC Builder';
  status.command = 'aidlc.openBuilder';
  status.show();
  context.subscriptions.push(status);

  output.appendLine('Activation complete.');
}

export function deactivate(): void {}

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
