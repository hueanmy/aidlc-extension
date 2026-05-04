/**
 * Epics list panel — separate webview from the Builder, dedicated to
 * monitoring epic progress. Shows every epic in the project with full
 * step-by-step progression so the user can see "which agent is running",
 * "what's left", "where it stalled" at a glance.
 *
 * Same lifecycle pattern as BuilderPanel:
 *   - singleton instance, reveals existing panel on second open
 *   - file watcher on every state.json (under any path) refreshes whenever
 *     a runner updates state on disk
 *   - retainContextWhenHidden so switching back is instant
 *
 * Distinct from the sidebar's "Recent Epics" mini-list (last 3) and the
 * Builder's compact "Epics" section. This panel is the canonical place
 * to monitor active runs.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { readYaml } from './yamlIO';
import { listEpics, type EpicSummary } from './epicsList';

interface AgentMetadata {
  name: string;
  description: string;
  inputs: string;
  outputs: string;
  artifact: string;
}

interface PanelState {
  workspaceRoot: string | null;
  workspaceName: string;
  /**
   * Epics with an extra `existingArtifacts` map per epic — set of filenames
   * (basename) that actually exist in `<epicDir>/artifacts/`. The panel uses
   * this to decide whether the artifact tag is clickable + whether to show
   * a "missing" indicator.
   */
  epics: Array<EpicSummary & { existingArtifacts: string[] }>;
  /**
   * Lookup of agent.id → display metadata pulled from workspace.yaml. The
   * panel uses this to render "what does this step take/produce" alongside
   * each pipeline circle.
   */
  agents: Record<string, AgentMetadata>;
}

function buildState(): PanelState {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return { workspaceRoot: null, workspaceName: '(no folder open)', epics: [], agents: {} };
  }
  const root = folder.uri.fsPath;
  const doc = readYaml(root);

  const agents: Record<string, AgentMetadata> = {};
  if (doc) {
    for (const a of doc.agents) {
      const id = String(a.id);
      agents[id] = {
        name: typeof a.name === 'string' ? a.name : id,
        description: typeof a.description === 'string' ? a.description : '',
        inputs: typeof a.inputs === 'string' ? a.inputs : '',
        outputs: typeof a.outputs === 'string' ? a.outputs : '',
        artifact: typeof a.artifact === 'string' ? a.artifact : '',
      };
    }
  }

  const epics = listEpics(root, doc).map((e) => {
    const artifactsDir = path.join(e.epicDir, 'artifacts');
    let existingArtifacts: string[] = [];
    if (fs.existsSync(artifactsDir)) {
      existingArtifacts = fs.readdirSync(artifactsDir).filter((n) => !n.startsWith('.'));
    }
    return { ...e, existingArtifacts };
  });

  return {
    workspaceRoot: root,
    workspaceName: folder.name,
    epics,
    agents,
  };
}

export class EpicsPanel {
  static current: EpicsPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.One;
    if (EpicsPanel.current) {
      EpicsPanel.current.panel.reveal(column);
      EpicsPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'aidlc.epics',
      'AIDLC Epics',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    EpicsPanel.current = new EpicsPanel(panel, extensionUri);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
      const refresh = () => this.refresh();
      const pattern = new vscode.RelativePattern(vscode.Uri.file(root), '**/state.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(refresh, null, this.disposables);
      watcher.onDidCreate(refresh, null, this.disposables);
      watcher.onDidDelete(refresh, null, this.disposables);
      this.disposables.push(watcher);
    }

    this.refresh();
  }

  refresh(): void {
    void this.panel.webview.postMessage({ type: 'state', state: buildState() });
  }

  private dispose(): void {
    EpicsPanel.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.refresh();
        return;

      case 'startEpic':
        await vscode.commands.executeCommand('aidlc.startEpic');
        return;

      case 'openClaude':
        await vscode.commands.executeCommand('aidlc.openClaudeTerminal');
        return;

      case 'openBuilder':
        await vscode.commands.executeCommand('aidlc.openBuilder');
        return;

      case 'openStateJson': {
        const p = String(msg.path ?? '');
        if (!p || !fs.existsSync(p)) { return; }
        const doc = await vscode.workspace.openTextDocument(p);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }

      case 'openInputsJson': {
        const epicDir = String(msg.epicDir ?? '');
        if (!epicDir) { return; }
        const p = path.join(epicDir, 'inputs.json');
        if (!fs.existsSync(p)) { return; }
        const doc = await vscode.workspace.openTextDocument(p);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }

      case 'revealArtifacts': {
        const epicDir = String(msg.epicDir ?? '');
        if (!epicDir) { return; }
        const artifactsDir = path.join(epicDir, 'artifacts');
        if (!fs.existsSync(artifactsDir)) { return; }
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(artifactsDir));
        return;
      }

      case 'openArtifactFile': {
        const epicDir = String(msg.epicDir ?? '');
        const filename = String(msg.filename ?? '');
        if (!epicDir || !filename) { return; }
        const filePath = path.join(epicDir, 'artifacts', filename);
        // Defensive: webview only renders the link when the file exists.
        if (!fs.existsSync(filePath)) { return; }
        // Same options as `openStateJson` / `openInputsJson` — opens a new
        // pinned tab in the editor group hosting the panel.
        const docOpen = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(docOpen, { preview: false });
        return;
      }
    }
  }

  private getHtml(): string {
    const nonce = makeNonce();
    const iconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg'),
    ).toString();
    const cspSource = this.panel.webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>AIDLC Epics</title>
<style>${EPICS_CSS}</style>
</head>
<body><div id="app"></div>
<script nonce="${nonce}">
window.BRAND_ICON_URI = ${JSON.stringify(iconUri)};
${EPICS_JS}
</script>
</body></html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) { out += chars[Math.floor(Math.random() * chars.length)]; }
  return out;
}

const EPICS_CSS = `
:root {
  --text: rgba(255,255,255,0.94);
  --text-soft: rgba(255,255,255,0.66);
  --text-muted: rgba(255,255,255,0.46);
  --text-faint: rgba(255,255,255,0.30);
  --accent: #5eead4;
  --accent-2: #2dd4bf;
  --accent-3: #eca4b8;
  --done: #86d4a8;
  --warn: #fbbf24;
  --rejected: #f87171;
  --glass: rgba(255,255,255,0.04);
  --glass-strong: rgba(255,255,255,0.08);
  --glass-border: rgba(94,234,212,0.18);
  --hairline: rgba(255,255,255,0.06);
  --radius: 14px;
  --radius-sm: 10px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--text);
  background:
    radial-gradient(1100px 700px at 100% -10%, rgba(45,212,191,0.16), transparent 60%),
    radial-gradient(800px 500px at -10% 110%, rgba(236,164,184,0.10), transparent 55%),
    linear-gradient(180deg, #0a0d14 0%, #050810 100%);
  background-attachment: fixed;
  padding: 28px 32px 60px;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  width: 36px; height: 36px; border-radius: 10px;
  display: block;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 6px 18px rgba(94,234,212,0.20);
}
.brand-meta { display: flex; flex-direction: column; }
.brand-title { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; }
.brand-sub { font-size: 11px; color: var(--text-faint); letter-spacing: 0.3px; }

.project-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: 1px solid var(--hairline); border-radius: 999px;
  background: var(--glass); font-size: 12px; color: var(--text-soft);
}
.project-pill .label { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.6px; }
.project-pill strong { color: var(--accent); font-weight: 600; }

.spacer { flex: 1; }

.btn {
  font-family: inherit;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.4px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--glass);
  color: var(--text-soft);
  cursor: pointer;
  transition: all .12s ease;
  text-transform: uppercase;
}
.btn:hover { background: var(--glass-strong); color: var(--accent); border-color: var(--glass-border); }
.btn-primary {
  background: linear-gradient(135deg, rgba(94,234,212,0.20), rgba(45,212,191,0.08));
  color: var(--accent); border-color: rgba(94,234,212,0.32);
}
.btn-primary:hover { box-shadow: 0 4px 18px rgba(94,234,212,0.20); transform: translateY(-1px); }

.empty {
  padding: 40px 24px;
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(94,234,212,0.04), rgba(255,255,255,0.02));
  text-align: center;
  font-size: 13px;
  color: var(--text-soft);
}
.empty p { margin-bottom: 16px; }

/* Filter row */
.filters {
  display: flex; gap: 6px; margin-bottom: 22px; flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--hairline);
}
.filter-tab {
  font-family: inherit;
  font-size: 11px; font-weight: 600;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: var(--glass);
  color: var(--text-soft);
  cursor: pointer;
  letter-spacing: 0.3px;
  transition: all .12s ease;
}
.filter-tab:hover { background: var(--glass-strong); color: var(--accent); border-color: var(--glass-border); }
.filter-tab.active {
  background: linear-gradient(135deg, rgba(94,234,212,0.18), rgba(45,212,191,0.06));
  color: var(--accent);
  border-color: rgba(94,234,212,0.32);
}
.filter-count {
  font-size: 9.5px;
  margin-left: 4px;
  opacity: 0.7;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}

/* Epic detail card */
.epic {
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  padding: 20px 24px;
  margin-bottom: 14px;
  transition: border-color .12s ease;
}
.epic:hover { border-color: var(--glass-border); }
.epic-status-pending  { border-left: 3px solid rgba(255,255,255,0.10); }
.epic-status-in_progress { border-left: 3px solid var(--warn); }
.epic-status-done     { border-left: 3px solid var(--done); }
.epic-status-failed   { border-left: 3px solid var(--rejected); }

.epic-head {
  display: flex; align-items: baseline; gap: 12px;
  margin-bottom: 8px;
}
.epic-id {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px; font-weight: 700;
  color: var(--accent); letter-spacing: 0.4px;
  flex-shrink: 0;
}
.epic-title {
  font-size: 14px; font-weight: 600; color: var(--text);
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.epic-pct {
  font-size: 11px; font-weight: 700;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  padding: 3px 10px; border-radius: 999px;
  background: linear-gradient(135deg, rgba(236,164,184,0.18), rgba(94,234,212,0.10));
  color: var(--accent);
  border: 1px solid rgba(94,234,212,0.30);
  letter-spacing: 0.4px;
  flex-shrink: 0;
}
.epic-pill {
  font-size: 9px; font-weight: 700;
  padding: 3px 9px; border-radius: 999px;
  letter-spacing: 0.5px; text-transform: uppercase;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.epic-toggle {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  margin-left: 6px;
  border: 1px solid var(--hairline);
  border-radius: 7px;
  background: var(--glass);
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  flex-shrink: 0;
  transition: all .12s ease;
}
.epic-toggle:hover {
  background: var(--glass-strong);
  color: var(--accent);
  border-color: var(--glass-border);
}
.epic.is-collapsed { padding-bottom: 18px; }
.epic.is-collapsed .epic-head { margin-bottom: 0; }
.pill-pending  { background: rgba(255,255,255,0.06); color: var(--text-soft); border-color: rgba(255,255,255,0.10); }
.pill-progress { background: rgba(251,191,36,0.14); color: var(--warn); border-color: rgba(251,191,36,0.30); }
.pill-done     { background: rgba(61,255,160,0.12); color: var(--done); border-color: rgba(61,255,160,0.28); }
.pill-failed   { background: rgba(248,113,113,0.14); color: var(--rejected); border-color: rgba(248,113,113,0.30); }

.epic-desc {
  font-size: 12px; color: var(--text-soft);
  margin-bottom: 14px;
  line-height: 1.5;
}
.epic-meta-row {
  display: flex; gap: 14px; flex-wrap: wrap;
  font-size: 10.5px; color: var(--text-faint);
  margin-bottom: 16px;
}
.epic-meta-row strong { color: var(--text-soft); font-weight: 600; }

.steps-section { margin-bottom: 14px; }
.section-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase;
  color: var(--text-faint);
  letter-spacing: 1.2px;
  margin-bottom: 8px;
}

/* Horizontal pipeline — numbered circles connected by lines */
.pipeline {
  display: flex; align-items: flex-start;
  padding: 18px 8px 6px;
  margin-bottom: 14px;
  background: rgba(0,0,0,0.18);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}
.pipe-step {
  flex: 1;
  min-width: 60px;
  display: flex; flex-direction: column; align-items: center;
  position: relative;
  padding: 0 4px;
}
/* Connector line from previous step's circle to this step's circle.
 * Uses ::before to draw to the LEFT of the circle so the first step
 * has no leading line. Color reflects this step's incoming state — if
 * the previous step is done, the line is green up to here. */
.pipe-step:not(:first-child)::before {
  content: '';
  position: absolute;
  top: 13px;        /* circle radius (28/2 = 14) - line thickness/2 */
  left: -50%;
  width: 100%;
  height: 2px;
  background: rgba(255,255,255,0.10);
  z-index: 0;
}
.pipe-step.s-done:not(:first-child)::before,
.pipe-step.s-in_progress:not(:first-child)::before { background: var(--done); }
.pipe-step.s-failed:not(:first-child)::before { background: var(--rejected); }

.pipe-circle {
  position: relative;
  z-index: 1;
  width: 28px; height: 28px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px; font-weight: 800;
  border: 2px solid var(--hairline);
  background: rgba(255,255,255,0.06);
  color: var(--text-muted);
  transition: all .15s ease;
}
.pipe-step.s-done .pipe-circle {
  background: var(--done); color: #062423; border-color: var(--done);
}
.pipe-step.s-in_progress .pipe-circle {
  background: var(--warn); color: #062423; border-color: var(--warn);
  box-shadow: 0 0 14px rgba(251,191,36,0.55);
}
.pipe-step.s-failed .pipe-circle {
  background: var(--rejected); color: #fff; border-color: var(--rejected);
}
.pipe-step.s-current .pipe-circle { transform: scale(1.12); }

.pipe-label {
  font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-soft);
  margin-top: 8px;
  text-align: center;
  max-width: 80px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pipe-step.s-done .pipe-label,
.pipe-step.s-in_progress .pipe-label { color: var(--text); }

/* Make pipe-step clickable + show focus ring on the selected step. */
.pipe-step { cursor: pointer; transition: transform .12s ease; }
.pipe-step:hover .pipe-circle { transform: scale(1.06); }
.pipe-step.s-focused .pipe-circle {
  box-shadow: 0 0 0 3px rgba(94,234,212,0.30), 0 0 18px rgba(94,234,212,0.35);
}
.pipe-step.s-focused.s-in_progress .pipe-circle {
  box-shadow: 0 0 0 3px rgba(251,191,36,0.30), 0 0 18px rgba(251,191,36,0.55);
}
.pipe-step.s-focused .pipe-label { color: var(--accent); }

/* Selected-step detail card under the pipeline */
.pipeline-wrap { margin-bottom: 14px; }
.step-detail {
  margin-top: 10px;
  padding: 14px 18px;
  background: rgba(0,0,0,0.22);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--accent);
}
.step-detail.s-pending     { border-left-color: rgba(255,255,255,0.16); }
.step-detail.s-in_progress { border-left-color: var(--warn); }
.step-detail.s-done        { border-left-color: var(--done); }
.step-detail.s-failed      { border-left-color: var(--rejected); }
.step-detail-head {
  display: flex; align-items: baseline; gap: 10px;
  margin-bottom: 8px;
}
.step-detail-num {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px; color: var(--text-faint);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.step-detail-name {
  font-size: 13px; font-weight: 700;
  color: var(--text);
  flex: 1;
}
.step-detail-status {
  font-size: 9px; font-weight: 700;
  padding: 3px 9px; border-radius: 999px;
  letter-spacing: 0.5px; text-transform: uppercase;
}
.step-detail-desc {
  font-size: 11.5px; color: var(--text-soft);
  margin-bottom: 10px;
  line-height: 1.5;
  font-style: italic;
}
.step-detail-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 14px;
  font-size: 11.5px;
  align-items: baseline;
}
.step-detail-label {
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.step-detail-val {
  color: var(--text);
  line-height: 1.5;
}
.step-detail-val.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--accent);
  background: rgba(94,234,212,0.06);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(94,234,212,0.14);
  display: inline-block;
}
.step-detail-val.is-empty { color: var(--text-faint); font-style: italic; }
button.step-detail-val.is-link {
  cursor: pointer;
  text-decoration: none;
  background: rgba(94,234,212,0.12);
  border-color: rgba(94,234,212,0.30);
  color: var(--accent);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(94,234,212,0.30);
  transition: all .12s ease;
  font-weight: 500;
  letter-spacing: 0.2px;
}
button.step-detail-val.is-link:hover {
  background: rgba(94,234,212,0.22);
  border-color: rgba(94,234,212,0.45);
  box-shadow: 0 0 12px rgba(94,234,212,0.20);
}
button.step-detail-val.is-link:active {
  transform: scale(0.97);
}
.step-detail-val.is-missing {
  color: var(--text-faint);
  background: rgba(255,255,255,0.03);
  border-color: rgba(255,255,255,0.06);
  font-style: italic;
  cursor: not-allowed;
  opacity: 0.55;
  user-select: none;
}

/* Inputs */
.inputs-grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 4px 16px;
  font-size: 11.5px;
}
.input-key {
  color: var(--text-faint);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10.5px;
}
.input-val {
  color: var(--text);
  word-break: break-all;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10.5px;
}

.epic-actions {
  display: flex; gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--hairline);
}
.epic-actions .btn { font-size: 10px; padding: 6px 10px; }
`;

const EPICS_JS = `
const vscode = acquireVsCodeApi();
let state = null;
let activeFilter = 'all';
/** Per-epic focused-step index (epic id → number). Sticky across renders. */
const focusedStep = {};
/**
 * Per-epic expanded flag. Missing key = collapsed (the default — gives a
 * scannable list). Persisted via vscode.setState so user choices survive
 * panel hide/show + soft reloads.
 */
const persisted = vscode.getState() || {};
const expandedEpics = persisted.expandedEpics || {};

function persistUiState() {
  vscode.setState({ expandedEpics });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'state') {
    state = msg.state;
    render();
  }
});

function post(type, payload) {
  vscode.postMessage(Object.assign({ type }, payload || {}));
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

const STATUS_LABEL = {
  pending: 'pending',
  in_progress: 'in progress',
  done: 'done',
  failed: 'failed',
};

const STATUS_DOT_GLYPH = {
  pending: '',
  in_progress: '⏵',
  done: '✓',
  failed: '✕',
};

const PILL_CLASS = {
  pending: 'pill-pending',
  in_progress: 'pill-progress',
  done: 'pill-done',
  failed: 'pill-failed',
};

function render() {
  const root = document.getElementById('app');
  if (!state) {
    root.innerHTML = '<div style="padding:60px 24px; text-align:center; color:rgba(255,255,255,0.45); font-size:13px;">Loading epics…</div>';
    return;
  }

  let html = '';
  html += renderHeader();

  if (!state.workspaceRoot) {
    html += '<div class="empty"><p><strong>No folder open.</strong></p>' +
      '<p>Open a project to see its epics.</p></div>';
  } else if (state.epics.length === 0) {
    html += '<div class="empty"><p><strong>No epics started yet.</strong></p>' +
      '<p>Start an epic to bind a workflow to project-specific values.</p>' +
      '<button class="btn btn-primary" data-action="startEpic">+ Start Epic</button></div>';
  } else {
    html += renderFilters();
    const filtered = filteredEpics();
    if (filtered.length === 0) {
      html += '<div class="empty"><p>No epics match the active filter.</p></div>';
    } else {
      for (const e of filtered) { html += renderEpic(e); }
    }
  }

  root.innerHTML = html;
}

function renderHeader() {
  let html = '<div class="header">';
  html += '<div class="brand">';
  html += '<img class="brand-mark" src="' + escapeHtml(window.BRAND_ICON_URI || '') + '" alt="AIDLC" />';
  html += '<div class="brand-meta">';
  html += '<div class="brand-title">AIDLC Epics</div>';
  html += '<div class="brand-sub">Workflow runs · progress · inputs</div>';
  html += '</div></div>';

  if (state.workspaceRoot) {
    html += '<div class="project-pill">';
    html += '<span class="label">Project</span>';
    html += '<strong>' + escapeHtml(state.workspaceName) + '</strong>';
    html += '</div>';
  }

  html += '<div class="spacer"></div>';
  html += '<button class="btn btn-ghost" data-action="openBuilder">Open Builder</button>';
  html += '<button class="btn btn-primary" data-action="startEpic">+ Start Epic</button>';
  html += '</div>';
  return html;
}

function renderFilters() {
  const counts = countByStatus();
  const tabs = [
    { id: 'all',         label: 'All',         count: state.epics.length },
    { id: 'in_progress', label: 'In progress', count: counts.in_progress },
    { id: 'pending',     label: 'Pending',     count: counts.pending },
    { id: 'done',        label: 'Done',        count: counts.done },
    { id: 'failed',      label: 'Failed',      count: counts.failed },
  ];
  let html = '<div class="filters">';
  for (const t of tabs) {
    const active = activeFilter === t.id ? ' active' : '';
    html += '<button class="filter-tab' + active + '" data-action="filter" data-filter="' + escapeHtml(t.id) + '">';
    html += escapeHtml(t.label) + '<span class="filter-count">' + t.count + '</span>';
    html += '</button>';
  }
  html += '</div>';
  return html;
}

function countByStatus() {
  const out = { pending: 0, in_progress: 0, done: 0, failed: 0 };
  for (const e of state.epics) {
    if (out[e.status] !== undefined) { out[e.status]++; }
  }
  return out;
}

function filteredEpics() {
  if (activeFilter === 'all') { return state.epics; }
  return state.epics.filter((e) => e.status === activeFilter);
}

function renderEpic(e) {
  const total = (e.stepDetails && e.stepDetails.length) || 0;
  const done = total > 0 ? e.stepDetails.filter((s) => s.status === 'done').length : 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  // Default collapsed → user expands selectively. Sticky via vscode.setState.
  const collapsed = !expandedEpics[e.id];

  let html = '<div class="epic epic-status-' + escapeHtml(e.status) + (collapsed ? ' is-collapsed' : '') + '">';

  // Head
  html += '<div class="epic-head">';
  html += '<span class="epic-id">' + escapeHtml(e.id) + '</span>';
  html += '<span class="epic-title">' + escapeHtml(e.title || '(untitled)') + '</span>';
  if (total > 0) {
    html += '<span class="epic-pct">' + pct + '%</span>';
  }
  html += '<span class="epic-pill ' + (PILL_CLASS[e.status] || 'pill-pending') + '">' + escapeHtml(STATUS_LABEL[e.status] || e.status) + '</span>';
  html += '<button class="epic-toggle" data-action="toggleEpic" data-epic-id="' + escapeHtml(e.id) + '" title="' + (collapsed ? 'Expand' : 'Collapse') + '" aria-label="' + (collapsed ? 'Expand' : 'Collapse') + '">';
  html += collapsed ? '▸' : '▾';
  html += '</button>';
  html += '</div>';

  if (collapsed) {
    html += '</div>';
    return html;
  }

  // Description
  if (e.description) {
    html += '<div class="epic-desc">' + escapeHtml(e.description) + '</div>';
  }

  // Meta row (compact — pipeline + date; progress lives in % badge + dots)
  html += '<div class="epic-meta-row">';
  if (e.pipeline) {
    html += '<span>Pipeline: <strong>' + escapeHtml(e.pipeline) + '</strong></span>';
  } else if (e.agent) {
    html += '<span>Agent: <strong>' + escapeHtml(e.agent) + '</strong></span>';
  }
  if (total > 0) {
    html += '<span>· <strong>' + done + '/' + total + '</strong> steps done</span>';
  }
  if (e.createdAt) {
    html += '<span>· Started <strong>' + escapeHtml(e.createdAt.slice(0, 10)) + '</strong></span>';
  }
  html += '</div>';

  // Pipeline (horizontal numbered circles, lines between)
  if (e.stepDetails && e.stepDetails.length > 0) {
    // Track which step is "focused" for the inline detail view. Default
    // to the current/in-progress step so the user lands on the live one.
    const focusKey = e.id;
    const focusedIdx = focusedStep[focusKey] !== undefined
      ? focusedStep[focusKey]
      : e.currentStep;

    html += '<div class="pipeline-wrap">';
    html += '<div class="pipeline">';
    for (let i = 0; i < e.stepDetails.length; i++) {
      const s = e.stepDetails[i];
      const isCurrent = (i === e.currentStep && e.status === 'in_progress');
      const isFocused = (i === focusedIdx);
      let stepCls = 'pipe-step s-' + s.status;
      if (isCurrent) { stepCls += ' s-current'; }
      if (isFocused) { stepCls += ' s-focused'; }
      const labelTitle = s.agent + ' — ' + STATUS_LABEL[s.status];
      html += '<div class="' + stepCls + '" data-action="focusStep" data-epic-id="' + escapeHtml(e.id) + '" data-idx="' + i + '" title="' + escapeHtml(labelTitle) + '">';
      const inner = s.status === 'done' ? '✓' : (s.status === 'failed' ? '✕' : String(i + 1));
      html += '<div class="pipe-circle">' + inner + '</div>';
      html += '<div class="pipe-label">' + escapeHtml(s.agent) + '</div>';
      html += '</div>';
    }
    html += '</div>';

    // Selected-step detail card — input / output / artifact pulled from
    // workspace.yaml's agent metadata (display-only fields).
    const focused = e.stepDetails[focusedIdx];
    if (focused) {
      const meta = state.agents[focused.agent] || { name: focused.agent, description: '', inputs: '', outputs: '', artifact: '' };
      html += '<div class="step-detail s-' + focused.status + '">';
      html += '<div class="step-detail-head">';
      html += '<span class="step-detail-num">Step ' + (focusedIdx + 1) + '/' + e.stepDetails.length + '</span>';
      html += '<span class="step-detail-name">' + escapeHtml(meta.name) + '</span>';
      html += '<span class="step-detail-status ' + (PILL_CLASS[focused.status] || 'pill-pending') + '">' + escapeHtml(STATUS_LABEL[focused.status]) + '</span>';
      html += '</div>';
      if (meta.description) {
        html += '<div class="step-detail-desc">' + escapeHtml(meta.description) + '</div>';
      }
      html += '<div class="step-detail-grid">';
      html += '<div class="step-detail-label">📥 Input</div>';
      html += '<div class="step-detail-val' + (meta.inputs ? '' : ' is-empty') + '">' + escapeHtml(meta.inputs || '—') + '</div>';
      html += '<div class="step-detail-label">📤 Output</div>';
      html += '<div class="step-detail-val' + (meta.outputs ? '' : ' is-empty') + '">' + escapeHtml(meta.outputs || '—') + '</div>';
      html += '<div class="step-detail-label">📄 Artifact</div>';
      if (meta.artifact) {
        const artifactExists = (e.existingArtifacts || []).includes(meta.artifact);
        if (artifactExists) {
          html += '<button class="step-detail-val mono is-link" data-action="openArtifactFile" data-epic-dir="' + escapeHtml(e.epicDir) + '" data-filename="' + escapeHtml(meta.artifact) + '" title="Open ' + escapeHtml(meta.artifact) + ' in a new tab">' + escapeHtml(meta.artifact) + ' ↗</button>';
        } else {
          html += '<div class="step-detail-val mono is-missing" title="File not produced yet — will land in artifacts/ when this step runs">' + escapeHtml(meta.artifact) + ' · not produced yet</div>';
        }
      } else {
        html += '<div class="step-detail-val mono is-empty">—</div>';
      }
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Inputs
  const inputKeys = Object.keys(e.inputs || {});
  if (inputKeys.length > 0) {
    html += '<div class="steps-section">';
    html += '<div class="section-label">Inputs</div>';
    html += '<div class="inputs-grid">';
    for (const k of inputKeys) {
      html += '<span class="input-key">' + escapeHtml(k) + '</span>';
      html += '<span class="input-val">' + escapeHtml(e.inputs[k]) + '</span>';
    }
    html += '</div></div>';
  }

  // Actions
  html += '<div class="epic-actions">';
  html += '<button class="btn" data-action="openStateJson" data-path="' + escapeHtml(e.statePath) + '">Open state.json</button>';
  if (inputKeys.length > 0) {
    html += '<button class="btn" data-action="openInputsJson" data-epic-dir="' + escapeHtml(e.epicDir) + '">Open inputs.json</button>';
  }
  html += '<button class="btn" data-action="revealArtifacts" data-epic-dir="' + escapeHtml(e.epicDir) + '">Reveal artifacts</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) { return; }
  const action = target.dataset.action;

  if (action === 'filter') {
    activeFilter = target.dataset.filter || 'all';
    render();
    return;
  }
  if (action === 'toggleEpic') {
    const epicId = target.dataset.epicId;
    if (epicId) {
      expandedEpics[epicId] = !expandedEpics[epicId];
      persistUiState();
      render();
    }
    return;
  }
  if (action === 'focusStep') {
    const epicId = target.dataset.epicId;
    const idx = Number(target.dataset.idx);
    if (epicId && !Number.isNaN(idx)) {
      focusedStep[epicId] = idx;
      render();
    }
    return;
  }
  if (action === 'startEpic')        { post('startEpic'); return; }
  if (action === 'openClaude')       { post('openClaude'); return; }
  if (action === 'openBuilder')      { post('openBuilder'); return; }
  if (action === 'openStateJson')    { post('openStateJson', { path: target.dataset.path }); return; }
  if (action === 'openInputsJson')   { post('openInputsJson', { epicDir: target.dataset.epicDir }); return; }
  if (action === 'revealArtifacts')  { post('revealArtifacts', { epicDir: target.dataset.epicDir }); return; }
  if (action === 'openArtifactFile') {
    e.preventDefault();
    e.stopPropagation();
    post('openArtifactFile', {
      epicDir: target.dataset.epicDir,
      filename: target.dataset.filename,
    });
    return;
  }
});

post('ready');
`;
