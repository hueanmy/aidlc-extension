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

import { readYaml } from './yamlIO';
import { WORKSPACE_DIR, WORKSPACE_FILENAME } from '@aidlc/core';
import { listEpics } from './epicsList';
import type { PresetStore } from './presetStore';

interface TemplateRef {
  id: string;
  name: string;
  description: string;
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
    };
  }

  const root = folder.uri.fsPath;
  const doc = readYaml(root);

  // Epics live on disk independent of workspace.yaml — list them either way.
  const allEpics = listEpics(root, doc);
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

  if (!doc) {
    return {
      hasFolder: true,
      workspaceName: folder.name,
      configExists: false,
      agentsCount: 0, skillsCount: 0, pipelinesCount: 0,
      epicsCount: allEpics.length, recentEpics,
      slashCommands: [],
      builtinTemplates, projectTemplates,
    };
  }

  return {
    hasFolder: true,
    // Use the folder name as the project identity, not workspace.yaml's
    // free-form `name:` field (see comment in builderWebview.ts).
    workspaceName: folder.name,
    configExists: true,
    agentsCount: doc.agents.length,
    skillsCount: doc.skills.length,
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
  };
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
          await vscode.commands.executeCommand(
            'vscode.openFolder', picked[0], { forceNewWindow: false },
          );
        }
        return;
      }
      case 'init':
        await vscode.commands.executeCommand('aidlc.initWorkspace');
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
      case 'refresh':
        this.refresh();
        return;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg'),
    ).toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>AIDLC</title>
<style>${SIDEBAR_CSS}</style>
</head>
<body><div id="app"></div>
<script nonce="${nonce}">
window.BRAND_ICON_URI = ${JSON.stringify(iconUri)};
${SIDEBAR_JS}
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

const SIDEBAR_CSS = `
:root {
  --text: rgba(255,255,255,0.94);
  --text-soft: rgba(255,255,255,0.66);
  --text-muted: rgba(255,255,255,0.46);
  --text-faint: rgba(255,255,255,0.30);
  --accent: #5eead4;
  --accent-2: #2dd4bf;
  --accent-3: #eca4b8;
  --glass: rgba(255,255,255,0.04);
  --glass-strong: rgba(255,255,255,0.08);
  --glass-border: rgba(94,234,212,0.18);
  --hairline: rgba(255,255,255,0.06);
  --radius: 12px;
  --radius-sm: 8px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  color: var(--text);
  background:
    radial-gradient(800px 500px at 100% -10%, rgba(45,212,191,0.16), transparent 60%),
    radial-gradient(600px 400px at -10% 110%, rgba(236,164,184,0.10), transparent 55%),
    linear-gradient(180deg, #0a0d14 0%, #050810 100%);
  background-attachment: fixed;
  padding: 12px 12px 24px;
  -webkit-font-smoothing: antialiased;
}

.header { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
.brand-mark {
  width: 28px; height: 28px; border-radius: 8px;
  display: block;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(94,234,212,0.20);
}
.brand-title { font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; font-weight: 700; }
.brand-sub {
  font-size: 9.5px; letter-spacing: 0.4px; color: var(--text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 140px;
}

.project-bar {
  display: flex; align-items: center; gap: 9px;
  width: 100%;
  padding: 10px 6px 10px 12px;
  border: 1px solid rgba(94,234,212,0.32);
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, rgba(94,234,212,0.14), rgba(45,212,191,0.04));
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 8px;
  transition: all .15s ease;
  text-align: left;
  color: var(--text);
  box-shadow: 0 2px 14px rgba(94,234,212,0.08);
}
.project-bar:hover {
  background: linear-gradient(135deg, rgba(94,234,212,0.22), rgba(45,212,191,0.08));
  box-shadow: 0 4px 20px rgba(94,234,212,0.18);
  transform: translateY(-1px);
}
.project-icon { font-size: 13px; flex-shrink: 0; }
.project-meta { flex: 1; min-width: 0; }
.project-name {
  font-size: 11.5px; font-weight: 700; color: var(--accent);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: 0.3px;
}
.project-status {
  font-size: 9.5px; color: var(--accent-3);
  letter-spacing: 0.3px;
  margin-top: 1px;
}
.project-change {
  display: grid; place-items: center;
  width: 24px; height: 24px;
  font-size: 13px;
  color: var(--text-muted);
  border-radius: 6px;
  flex-shrink: 0;
  cursor: pointer;
  transition: all .12s ease;
}
.project-change:hover {
  background: rgba(94,234,212,0.16);
  color: var(--accent);
}

.cta-primary {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(94,234,212,0.32);
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, rgba(94,234,212,0.18), rgba(45,212,191,0.06));
  color: var(--accent);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 8px;
  transition: all .15s ease;
  box-shadow: 0 2px 14px rgba(94,234,212,0.10);
}
.cta-primary:hover {
  background: linear-gradient(135deg, rgba(94,234,212,0.26), rgba(45,212,191,0.10));
  box-shadow: 0 4px 20px rgba(94,234,212,0.22);
  transform: translateY(-1px);
}
.cta-primary .arrow { margin-left: auto; opacity: .6; font-weight: 400; }

.btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--glass);
  color: var(--text-soft);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.4px;
  margin-bottom: 8px;
  transition: all .12s ease;
}
.btn:hover { background: var(--glass-strong); color: var(--accent); border-color: var(--glass-border); }
.btn .arrow { margin-left: auto; opacity: .5; font-weight: 400; }

.empty {
  padding: 18px 14px;
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(94,234,212,0.04), rgba(255,255,255,0.02));
  text-align: center;
  margin-bottom: 12px;
}
.empty h3 { font-size: 12px; color: var(--text); margin-bottom: 6px; font-weight: 700; letter-spacing: 0.3px; }
.empty p { font-size: 10.5px; color: var(--text-soft); margin-bottom: 12px; line-height: 1.55; }

.stats { display: flex; gap: 6px; margin-bottom: 12px; }
.stat {
  flex: 1;
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 6px;
  text-align: center;
}
.stat-val {
  font-size: 17px; font-weight: 700; color: var(--accent);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.stat-label {
  font-size: 9px; color: var(--text-faint);
  letter-spacing: 0.6px; text-transform: uppercase;
  margin-top: 4px;
}

.section-title {
  font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--text-faint); padding: 8px 4px 4px;
  font-weight: 700;
}
.section-title-row {
  display: flex; align-items: center; justify-content: space-between;
  padding-right: 4px;
}
.section-title-row .section-title { padding-right: 0; }
.section-toggle {
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: none;
  cursor: pointer;
  font-family: inherit;
  padding: 8px 4px 4px;
  color: var(--text-faint);
  flex: 1;
  text-align: left;
}
.section-toggle:hover { color: var(--text-soft); }
.section-toggle:hover .section-chevron { color: var(--accent); }
.section-chevron {
  font-size: 9px;
  color: var(--text-faint);
  width: 10px;
  display: inline-block;
  transition: transform .15s ease;
}
.section-chevron.collapsed { transform: rotate(-90deg); }
.section-link {
  font-size: 10px; color: var(--text-soft);
  cursor: pointer; padding: 8px 4px 4px;
  letter-spacing: 0.3px;
  text-decoration: none;
}
.section-link:hover { color: var(--accent); }
.subgroup-label {
  font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--text-muted);
  padding: 6px 4px 3px;
  font-weight: 600;
}
.tpl {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 10.5px;
  margin-bottom: 4px;
  cursor: pointer;
  transition: all .12s ease;
}
.tpl:hover { background: var(--glass-strong); border-color: var(--glass-border); }
.tpl-icon { font-size: 11px; flex-shrink: 0; opacity: .8; }
.tpl-name {
  font-weight: 600; color: var(--accent);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex-shrink: 0;
}
.tpl-desc {
  color: var(--text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
.slash {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 10.5px;
  margin-bottom: 4px;
}
.slash-name {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10.5px; color: var(--accent);
  font-weight: 600;
}
.slash-target {
  color: var(--text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.epic-mini {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
  font-size: 10.5px;
  cursor: pointer;
  transition: all .12s ease;
}
.epic-mini:hover { background: var(--glass-strong); border-color: var(--glass-border); }
.epic-mini-dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0;
}
.epic-mini-dot.dot-pending     { background: rgba(255,255,255,0.30); }
.epic-mini-dot.dot-in_progress { background: var(--review); box-shadow: 0 0 4px rgba(251,191,36,0.6); }
.epic-mini-dot.dot-done        { background: var(--done); }
.epic-mini-dot.dot-failed      { background: var(--rejected); }
.epic-mini-id {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.3px;
}
.epic-mini-title {
  color: var(--text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}

.hint {
  margin-top: 6px;
  padding: 10px 12px;
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, rgba(94,234,212,0.04), rgba(255,255,255,0.02));
  font-size: 10.5px;
  color: var(--text-soft);
  line-height: 1.5;
}
.hint code {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--accent);
  background: rgba(94,234,212,0.08);
  padding: 1px 5px;
  border-radius: 3px;
}

.footer {
  margin-top: auto;
  padding: 10px 4px 4px;
  font-size: 9.5px; color: var(--text-faint);
  text-align: center;
}
.footer a { color: var(--text-soft); cursor: pointer; text-decoration: none; }
.footer a:hover { color: var(--accent); }
`;

const SIDEBAR_JS = `
const vscode = acquireVsCodeApi();
let state = null;
/** Persisted UI prefs — which sections the user has collapsed. */
const persisted = vscode.getState() || {};
const collapsed = Object.assign(
  { recentEpics: false, slashCommands: true, workflows: false },
  persisted.collapsed || {},
);

function persistUi() {
  vscode.setState(Object.assign({}, vscode.getState() || {}, { collapsed }));
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

function render() {
  const root = document.getElementById('app');
  if (!state) {
    root.innerHTML = '<div style="padding:32px 12px; text-align:center; color:rgba(255,255,255,0.45); font-size:11px;">Loading…</div>';
    return;
  }

  let html = renderHeader();

  if (!state.hasFolder) {
    html += renderEmptyNoFolder();
  } else {
    html += renderActive();
  }

  html += renderFooter();
  root.innerHTML = html;
}

function renderHeader() {
  let html = '<div class="header">';
  html += '<img class="brand-mark" src="' + escapeHtml(window.BRAND_ICON_URI || '') + '" alt="AIDLC" />';
  html += '<div>';
  html += '<div class="brand-title">AIDLC</div>';
  html += '<div class="brand-sub">Agent workflow runner</div>';
  html += '</div></div>';
  return html;
}

/**
 * Project bar — shows the current project name with a separate switch
 * icon on the right. Two click zones:
 *   - main area  → Open AIDLC Builder
 *   - ⇄ icon     → Switch project (folder picker)
 *
 * Implemented as a div (not button) so nested click targets work via
 * document-level click delegation: closest('[data-action]') matches the
 * innermost element with a data-action attribute.
 */
function renderProjectBar() {
  if (!state.hasFolder) { return ''; }
  const status = state.configExists ? '' : 'no workspace.yaml';
  let html = '<div class="project-bar" data-action="openBuilder" title="Click to open Builder">';
  html += '<span class="project-icon">📂</span>';
  html += '<div class="project-meta">';
  html += '<div class="project-name">' + escapeHtml(state.workspaceName) + '</div>';
  if (status) {
    html += '<div class="project-status">' + escapeHtml(status) + '</div>';
  }
  html += '</div>';
  html += '<span class="project-change" data-action="openProject" title="Switch project">⇄</span>';
  html += '</div>';
  return html;
}

function renderEmptyNoFolder() {
  return '<div class="empty">' +
    '<h3>No project open</h3>' +
    '<p>Open a folder to start building agents and workflows.</p>' +
    '<button class="cta-primary" data-action="openProject"><span>📂</span><span>Open Project</span><span class="arrow">→</span></button>' +
    '</div>';
}

/**
 * Folder is open. Project bar shows current project + switch affordance.
 * The Builder + Claude CLI actions live in the view title icons (▦ and
 * terminal) — duplicating them here was noisy, so they're gone.
 */
function renderActive() {
  let html = '';
  html += renderProjectBar();
  if (state.configExists) {
    html += '<button class="btn" data-action="openYaml"><span>📄</span><span>Open workspace.yaml</span></button>';
  }

  if (!state.configExists) {
    html += '<div class="hint">No <code>workspace.yaml</code> yet — use the <strong>▦</strong> icon at the top to open the Builder and scaffold one.</div>';
    html += renderWorkflows();
    return html;
  }

  html += '<button class="cta-primary" data-action="startEpic"><span>▶</span><span>Start Epic</span><span class="arrow">→</span></button>';

  html += '<div class="stats">';
  html += '<div class="stat"><div class="stat-val">' + state.agentsCount + '</div><div class="stat-label">Agents</div></div>';
  html += '<div class="stat"><div class="stat-val">' + state.skillsCount + '</div><div class="stat-label">Skills</div></div>';
  html += '<div class="stat"><div class="stat-val">' + state.pipelinesCount + '</div><div class="stat-label">Flows</div></div>';
  html += '<div class="stat"><div class="stat-val">' + state.epicsCount + '</div><div class="stat-label">Epics</div></div>';
  html += '</div>';

  if (state.recentEpics.length > 0) {
    const isCol = !!collapsed.recentEpics;
    const chev = '<span class="section-chevron' + (isCol ? ' collapsed' : '') + '">▾</span>';
    html += '<div class="section-title-row">';
    html += '<button class="section-toggle" data-action="toggleSection" data-section="recentEpics">';
    html += chev + '<span class="section-title">Recent Epics</span>';
    html += '</button>';
    html += '<a class="section-link" data-action="openEpicsList">All ' + state.epicsCount + ' →</a>';
    html += '</div>';
    if (!isCol) {
      for (const e of state.recentEpics) {
        const dot = '<span class="epic-mini-dot dot-' + escapeHtml(e.status) + '"></span>';
        const title = e.title ? ' · ' + escapeHtml(e.title) : '';
        html += '<div class="epic-mini" data-action="openEpicState" data-path="' + escapeHtml(e.statePath) + '">';
        html += dot + '<span class="epic-mini-id">' + escapeHtml(e.id) + '</span><span class="epic-mini-title">' + title + '</span>';
        html += '</div>';
      }
    }
  }

  if (state.slashCommands.length > 0) {
    const isCol = !!collapsed.slashCommands;
    const chev = '<span class="section-chevron' + (isCol ? ' collapsed' : '') + '">▾</span>';
    html += '<div class="section-title-row">';
    html += '<button class="section-toggle" data-action="toggleSection" data-section="slashCommands">';
    html += chev + '<span class="section-title">Slash commands</span>';
    html += '</button>';
    html += '</div>';
    if (!isCol) {
      for (const c of state.slashCommands) {
        html += '<div class="slash">';
        html += '<span class="slash-name">' + escapeHtml(c.name) + '</span>';
        html += '<span class="slash-target">→ ' + escapeHtml(c.target) + '</span>';
        html += '</div>';
      }
    }
  }

  html += renderWorkflows();

  return html;
}

/**
 * Workflows section — workspace templates split by source. Built-in
 * (extension) templates first, then project-scoped templates from
 * .aidlc/templates/. Click applies the template (with overwrite confirm
 * if workspace.yaml already exists).
 */
function renderWorkflows() {
  const builtins = state.builtinTemplates || [];
  const project = state.projectTemplates || [];
  if (builtins.length === 0 && project.length === 0) { return ''; }

  const isCol = !!collapsed.workflows;
  const chev = '<span class="section-chevron' + (isCol ? ' collapsed' : '') + '">▾</span>';
  let html = '<div class="section-title-row">';
  html += '<button class="section-toggle" data-action="toggleSection" data-section="workflows">';
  html += chev + '<span class="section-title">Workflows</span>';
  html += '</button>';
  html += '</div>';

  if (isCol) { return html; }

  if (builtins.length > 0) {
    html += '<div class="subgroup-label">Common</div>';
    for (const t of builtins) { html += renderTemplate(t, true); }
  }
  if (project.length > 0) {
    html += '<div class="subgroup-label">Custom</div>';
    for (const t of project) { html += renderTemplate(t, false); }
  }
  return html;
}

function renderTemplate(t, isBuiltin) {
  const icon = isBuiltin ? '✦' : '◆';
  const desc = t.description ? escapeHtml(t.description) : escapeHtml(t.id);
  let h = '<div class="tpl" data-action="applyTemplate" data-id="' + escapeHtml(t.id) + '" title="Apply template ' + escapeHtml(t.id) + '">';
  h += '<span class="tpl-icon">' + icon + '</span>';
  h += '<span class="tpl-name">' + escapeHtml(t.name) + '</span>';
  h += '<span class="tpl-desc">· ' + desc + '</span>';
  h += '</div>';
  return h;
}

function renderFooter() {
  if (!state.hasFolder) { return '<div class="footer">v0.8.0 · <a data-action="openProject">Open Project</a></div>'; }
  return '<div class="footer">v0.8.0 · <a data-action="openBuilder">Builder</a> · <a data-action="refresh">Refresh</a></div>';
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) { return; }
  const action = target.dataset.action;

  if (action === 'toggleSection') {
    const key = target.dataset.section;
    if (key) {
      collapsed[key] = !collapsed[key];
      persistUi();
      render();
    }
    return;
  }

  if (action === 'openEpicState') {
    vscode.postMessage({ type: action, path: target.dataset.path });
    return;
  }

  if (action === 'applyTemplate') {
    vscode.postMessage({ type: action, id: target.dataset.id });
    return;
  }

  post(action);
});

post('ready');
`;
