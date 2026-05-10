/**
 * Sidebar webview — minimal v2 launcher.
 *
 * Replaces the legacy SDLC pipeline tree view. The sidebar is intentionally
 * simple: it shows where you are (project / workspace.yaml status / counts),
 * provides one-click access to the Builder panel and Claude CLI, and
 * surfaces the slash commands the user has wired up. Everything that needs
 * real estate (forms, cards, workflow editor) lives in the Builder panel.
 *
 * The data source is `.aidlc/workspace.yaml`. State is rebuilt on every
 * file change via a workspace watcher (set up in extension.ts).
 */

import * as vscode from 'vscode';
import * as path from 'path';

import * as fs from 'fs';

import { readYaml } from './yamlIO';
import {
  WORKSPACE_DIR,
  WORKSPACE_FILENAME,
  RunStateStore,
  normalizeStep,
  resolvePath,
  discoverAssets,
} from '@aidlc/core';
import type { PipelineConfig } from '@aidlc/core';
import { listEpics } from './epicsList';
import type { PresetStore } from './presetStore';
import { themeManager } from './themeManager';

// VS Code reuses output channels by name, so this resolves to the same
// channel created in extension.ts activate().
const output = vscode.window.createOutputChannel('AIDLC');

interface TemplateRef {
  id: string;
  name: string;
  description: string;
}

/** Resolved artifact path with existence check, surfaced in the run card. */
interface ArtifactPath {
  /** Path relative to workspace root, with placeholders substituted. */
  path: string;
  exists: boolean;
}

/** Compact run summary for sidebar rendering. */
interface ActiveRun {
  runId: string;
  pipelineId: string;
  currentStepIdx: number;
  totalSteps: number;
  currentAgent: string;
  /** awaiting_work | awaiting_review | rejected */
  currentStepStatus: string;
  revision: number;
  rejectReason?: string;
  /** Files this step is expected to produce (resolved from template + context). */
  produces: ArtifactPath[];
  /** Files this step needs from upstream (already-produced gate inputs). */
  requires: ArtifactPath[];
  /**
   * Slash command (including the leading `/`) that invokes the current
   * step's agent, when one is wired up in `slash_commands`. Empty when no
   * command targets this agent — the user just sees the agent id then.
   */
  currentSlashCommand?: string;
}

interface SidebarState {
  hasFolder: boolean;
  workspaceName: string;
  configExists: boolean;
  agentsCount: number;
  skillsCount: number;
  pipelinesCount: number;
  epicsCount: number;
  /** Last 3 epics with status, for the "Recent Epics" mini-list. */
  recentEpics: Array<{ id: string; title: string; status: string; statePath: string }>;
  slashCommands: Array<{ name: string; target: string }>;
  /** Workspace templates split by source — built-in (extension) vs project. */
  builtinTemplates: TemplateRef[];
  projectTemplates: TemplateRef[];
  /** Pipeline runs with status === 'running'. */
  activeRuns: ActiveRun[];
}

function buildState(presetStore: PresetStore | null): SidebarState {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {
      hasFolder: false,
      workspaceName: '',
      configExists: false,
      agentsCount: 0, skillsCount: 0, pipelinesCount: 0,
      epicsCount: 0, recentEpics: [],
      slashCommands: [],
      builtinTemplates: [], projectTemplates: [],
      activeRuns: [],
    };
  }

  const root = folder.uri.fsPath;
  const doc = readYaml(root);

  // Epics live on disk independent of workspace.yaml — list them either way.
  const allEpics = listEpics(root, doc);

  // Discovered skills + agents from .claude/ (project) and ~/.claude/
  // (global). These are independent of workspace.yaml — they exist as
  // long as the folder is open. The disk scan returns aidlc-scope items
  // too, but for counting we ignore those and rely on the workspace.yaml
  // declarations (the runtime source of truth for AIDLC pipelines).
  const discovered = discoverAssets(root);
  const claudeSkills = discovered.skills.filter((s) => s.scope !== 'aidlc');
  const claudeAgents = discovered.agents.filter((a) => a.scope !== 'aidlc');
  const recentEpics = allEpics.slice(0, 3).map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    statePath: e.statePath,
  }));

  // Templates also live independent of workspace.yaml — surface them even
  // when the project hasn't been initialized yet, so the user can apply one
  // as their first action.
  const { builtinTemplates, projectTemplates } = listTemplates(presetStore, root);

  // Active pipeline runs live in .aidlc/runs/ and are independent of the
  // workspace doc — surface them whenever the folder is open.
  const activeRuns = listActiveRuns(root);

  if (!doc) {
    return {
      hasFolder: true,
      workspaceName: folder.name,
      configExists: false,
      agentsCount: claudeAgents.length,
      skillsCount: claudeSkills.length,
      pipelinesCount: 0,
      epicsCount: allEpics.length, recentEpics,
      slashCommands: [],
      builtinTemplates, projectTemplates,
      activeRuns,
    };
  }

  return {
    hasFolder: true,
    // Use the folder name as the project identity, not workspace.yaml's
    // free-form `name:` field (see comment in builderWebview.ts).
    workspaceName: folder.name,
    configExists: true,
    // Counts span all 3 scopes: workspace.yaml entries (aidlc) + .claude/
    // (project) + ~/.claude/ (global). Same total the Builder tab shows.
    agentsCount: doc.agents.length + claudeAgents.length,
    skillsCount: doc.skills.length + claudeSkills.length,
    pipelinesCount: doc.pipelines.length,
    epicsCount: allEpics.length,
    recentEpics,
    slashCommands: doc.slash_commands.map((c) => ({
      name: typeof c.name === 'string' ? c.name : '',
      target:
        typeof (c as { agent?: unknown }).agent === 'string'
          ? `agent ${(c as { agent: string }).agent}`
          : typeof (c as { pipeline?: unknown }).pipeline === 'string'
          ? `pipeline ${(c as { pipeline: string }).pipeline}`
          : '',
    })),
    builtinTemplates,
    projectTemplates,
    activeRuns,
  };
}

function listActiveRuns(root: string): ActiveRun[] {
  try {
    // Read pipelines once so we can map runs → step config without
    // re-parsing workspace.yaml per run.
    const doc = readYaml(root);
    const pipelinesById = new Map<string, PipelineConfig>();
    // agent id → slash command name (including leading `/`). First wins
    // when multiple commands point at the same agent — the workspace
    // schema doesn't forbid that, but it's a config smell so we don't
    // bother surfacing duplicates.
    const slashByAgent = new Map<string, string>();
    if (doc) {
      for (const p of doc.pipelines as PipelineConfig[]) {
        if (typeof p.id === 'string') { pipelinesById.set(p.id, p); }
      }
      for (const c of doc.slash_commands) {
        const agent = (c as { agent?: unknown }).agent;
        if (typeof c.name === 'string' && typeof agent === 'string' && !slashByAgent.has(agent)) {
          slashByAgent.set(agent, c.name);
        }
      }
    }

    return RunStateStore.list(root)
      .filter((r) => r.status === 'running')
      .map((r) => {
        const step = r.steps[r.currentStepIdx];
        const pipeline = pipelinesById.get(r.pipelineId);
        const stepConfig = pipeline?.steps?.[r.currentStepIdx];
        const norm = stepConfig ? normalizeStep(stepConfig) : null;
        const agent = step?.agent ?? '';

        return {
          runId: r.runId,
          pipelineId: r.pipelineId,
          currentStepIdx: r.currentStepIdx,
          totalSteps: r.steps.length,
          currentAgent: agent,
          currentStepStatus: step?.status ?? '',
          revision: step?.revision ?? 1,
          rejectReason: step?.rejectReason,
          produces: norm
            ? norm.produces.map((p) => resolveArtifact(root, p, r.context))
            : [],
          requires: norm
            ? norm.requires.map((p) => resolveArtifact(root, p, r.context))
            : [],
          currentSlashCommand: agent ? slashByAgent.get(agent) : undefined,
        };
      });
  } catch {
    return [];
  }
}

function resolveArtifact(
  root: string,
  template: string,
  context: Record<string, string>,
): ArtifactPath {
  const resolved = resolvePath(template, context);
  const abs = path.isAbsolute(resolved) ? resolved : path.join(root, resolved);
  return { path: resolved, exists: fs.existsSync(abs) };
}

function listTemplates(
  store: PresetStore | null,
  root: string,
): { builtinTemplates: TemplateRef[]; projectTemplates: TemplateRef[] } {
  if (!store) { return { builtinTemplates: [], projectTemplates: [] }; }
  try {
    const all = store.list(root);
    const builtinTemplates: TemplateRef[] = [];
    const projectTemplates: TemplateRef[] = [];
    for (const p of all) {
      const ref = { id: p.id, name: p.name, description: p.description };
      if (p.builtin) { builtinTemplates.push(ref); } else { projectTemplates.push(ref); }
    }
    return { builtinTemplates, projectTemplates };
  } catch {
    return { builtinTemplates: [], projectTemplates: [] };
  }
}

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aidlcSidebar';
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly presetStore: PresetStore | null = null,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    view.onDidChangeVisibility(() => {
      if (view.visible) { this.refresh(); }
    });
    // Register the webview with the theme manager so user toggles in any
    // other panel propagate here too.
    const themeReg = themeManager.register(view.webview);
    view.onDidDispose(() => themeReg.dispose());
    this.refresh();
  }

  refresh(): void {
    if (!this.view) { return; }
    void this.view.webview.postMessage({ type: 'state', state: buildState(this.presetStore) });
  }

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.refresh();
        return;
      case 'setTheme': {
        const mode = String(msg.mode ?? '');
        if (mode === 'auto' || mode === 'light' || mode === 'dark') {
          await themeManager.set(mode);
        }
        return;
      }
      case 'openBuilder':
        await vscode.commands.executeCommand('aidlc.openBuilder');
        return;
      case 'openClaude':
        await vscode.commands.executeCommand('aidlc.openClaudeTerminal');
        return;
      case 'openProject': {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
          openLabel: 'Open project',
        });
        if (picked && picked.length > 0) {
          output.appendLine(`[openProject] Opening folder: ${picked[0].fsPath}`);
          try {
            await vscode.commands.executeCommand(
              'vscode.openFolder', picked[0], { forceNewWindow: false },
            );
            output.appendLine('[openProject] openFolder command returned');
          } catch (err) {
            output.appendLine(`[openProject] Error: ${err}`);
            await vscode.window.showErrorMessage(`Failed to open folder: ${err}`);
          }
        }
        return;
      }
      case 'closeProject':
        await vscode.commands.executeCommand('workbench.action.closeFolder');
        return;
      case 'init':
        await vscode.commands.executeCommand('aidlc.initWorkspace');
        return;
      case 'loadDemoProject':
        await vscode.commands.executeCommand('aidlc.loadDemoProject');
        return;
      case 'startEpic':
        await vscode.commands.executeCommand('aidlc.startEpic');
        return;
      case 'openEpicsList':
        await vscode.commands.executeCommand('aidlc.openEpicsList');
        return;
      case 'openEpicState': {
        const statePath = String(msg.path ?? '');
        if (!statePath) { return; }
        const docOpen = await vscode.workspace.openTextDocument(statePath);
        await vscode.window.showTextDocument(docOpen, { preview: false });
        return;
      }
      case 'openYaml': {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return; }
        const yp = path.join(root, WORKSPACE_DIR, WORKSPACE_FILENAME);
        const doc = await vscode.workspace.openTextDocument(yp);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      case 'applyTemplate': {
        const id = String(msg.id ?? '');
        if (!id) { return; }
        await vscode.commands.executeCommand('aidlc.applyPreset', id);
        return;
      }
      case 'startPipelineRun':
        await vscode.commands.executeCommand('aidlc.startPipelineRun');
        return;
      case 'markStepDone':
      case 'approveStep':
      case 'rejectStep':
      case 'rerunStep':
      case 'runAutoReview':
      case 'openRunState':
      case 'deleteRun': {
        const runId = String(msg.runId ?? '');
        const cmd = `aidlc.${msg.type}`;
        await vscode.commands.executeCommand(cmd, runId || undefined);
        return;
      }
      case 'openArtifact': {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return; }
        const rel = String(msg.path ?? '');
        if (!rel) { return; }
        const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
        const uri = vscode.Uri.file(abs);
        try {
          // If the file exists, open it. If not, reveal the parent dir
          // in the explorer so the user can create it. This matches the
          // sidebar's "produces with a ◌ icon" affordance.
          await vscode.workspace.fs.stat(uri);
          const docArt = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(docArt, { preview: false });
        } catch {
          await vscode.commands.executeCommand('revealInExplorer', uri);
        }
        return;
      }
      case 'copyCommand': {
        const cmd = String(msg.command ?? '');
        if (!cmd) { return; }
        await vscode.env.clipboard.writeText(cmd);
        void vscode.window.setStatusBarMessage(`Copied ${cmd} to clipboard`, 2000);
        return;
      }
      case 'refresh':
        this.refresh();
        return;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const cspSource = webview.cspSource;
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg'),
    ).toString();
    const version = readExtensionVersion(this.extensionUri.fsPath);
    const initialState = buildState(this.presetStore);
    const initialTheme = themeManager.current;

    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, 'out', 'webviews');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'styles.css')).toString();
    const entryUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'sidebar.js')).toString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           img-src ${cspSource} https: data:;
           font-src ${cspSource} https: data:;
           style-src ${cspSource} 'unsafe-inline';
           script-src 'nonce-${nonce}' ${cspSource};">
<title>AIDLC</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">
window.BRAND_ICON_URI = ${JSON.stringify(iconUri)};
window.EXTENSION_VERSION = ${JSON.stringify(version)};
window.__AIDLC_INITIAL_STATE__ = ${JSON.stringify(initialState)};
window.__AIDLC_INITIAL_THEME__ = ${JSON.stringify(initialTheme)};
</script>
<script type="module" nonce="${nonce}" src="${entryUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) { out += chars[Math.floor(Math.random() * chars.length)]; }
  return out;
}

function readExtensionVersion(extensionRoot: string): string {
  try {
    const raw = fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) { return pkg.version; }
  } catch { /* fall through */ }
  return '';
}

