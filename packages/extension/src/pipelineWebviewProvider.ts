import * as vscode from 'vscode';
import * as path from 'path';
import { EpicScanner, EpicStatus, PhaseStatus, PhaseStatusValue } from './epicScanner';

/**
 * Webview-based pipeline sidebar. Replaces the native TreeDataProvider so we
 * can render the full glassmorphism look (status pills, phase strips, action
 * buttons) without VSCode's tree-row constraints.
 *
 * Wire-up in extension.ts: register with `vscode.window.registerWebviewViewProvider`.
 * The view ID `cfPipelineView` must have `"type": "webview"` in package.json.
 */
export class PipelineWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cfPipelineView';

  private _view?: vscode.WebviewView;
  private scanner: EpicScanner;
  private epics: EpicStatus[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private workspaceRoot: string,
    epicsRelativePath?: string,
  ) {
    this.scanner = new EpicScanner(workspaceRoot, epicsRelativePath);
    this.refresh();
  }

  setEpicsPath(relativePath: string): void {
    this.scanner.setEpicsDir(this.workspaceRoot, relativePath);
    this.refresh();
  }

  getEpicsDir(): string {
    return this.scanner.getEpicsDir();
  }

  getEpics(): EpicStatus[] {
    return this.epics;
  }

  refresh(): void {
    this.epics = this.scanner.scanAll();
    void vscode.commands.executeCommand('setContext', 'cfPipeline.empty', this.epics.length === 0);
    this.postState();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postState();
      }
    });

    this.postState();
  }

  private postState(): void {
    if (!this._view) { return; }
    this._view.webview.postMessage({
      type: 'state',
      epics: this.epics.map(serializeEpic),
      empty: this.epics.length === 0,
    });
  }

  private findContext(epicKey: string, phaseId: string):
    { phase: PhaseStatus; epic: EpicStatus } | undefined {
    const epic = this.epics.find(e => e.key === epicKey);
    if (!epic) { return undefined; }
    const phase = epic.phases.find(p => p.id === phaseId);
    if (!phase) { return undefined; }
    return { phase, epic };
  }

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postState();
        break;

      case 'refresh':
        this.refresh();
        break;

      case 'openClaude':
        await vscode.commands.executeCommand('cfPipeline.openClaudeTerminal');
        break;

      case 'openDashboard':
        await vscode.commands.executeCommand('cfPipeline.openDashboard');
        break;

      case 'openSettings':
        await vscode.commands.executeCommand('cfPipeline.openSettings');
        break;

      case 'selectEpicsFolder':
        await vscode.commands.executeCommand('cfPipeline.selectEpicsFolder');
        break;

      case 'loadExample':
        await vscode.commands.executeCommand('cfPipeline.loadExampleProject');
        break;

      case 'openEpic': {
        const epic = this.epics.find(e => e.key === String(msg.epicKey ?? ''));
        if (!epic) { return; }
        const epicDoc = path.join(epic.folderPath, `${epic.key}.md`);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(epicDoc));
        break;
      }

      case 'openArtifact': {
        const artifactPath = String(msg.path ?? '');
        const epicKey = String(msg.epicKey ?? '');
        if (!artifactPath || !epicKey) { return; }
        await vscode.commands.executeCommand(
          'cfPipeline.openOrCreateArtifact', artifactPath, epicKey,
        );
        break;
      }

      case 'phasePrimary':
      case 'phaseAction': {
        const ctx = this.findContext(String(msg.epicKey ?? ''), String(msg.phaseId ?? ''));
        if (!ctx) { return; }
        const action = msg.action ? String(msg.action) : computePrimaryAction(ctx.phase, ctx.epic);
        const cmd = COMMAND_FOR_ACTION[action];
        if (!cmd) { return; }
        await vscode.commands.executeCommand(cmd, { phase: ctx.phase, epic: ctx.epic });
        break;
      }

      case 'openPhaseSession': {
        const ctx = this.findContext(String(msg.epicKey ?? ''), String(msg.phaseId ?? ''));
        if (!ctx) { return; }
        await vscode.commands.executeCommand('cfPipeline.openPhaseSession', { phase: ctx.phase, epic: ctx.epic });
        break;
      }

      case 'advanceEpic': {
        const epicKey = String(msg.epicKey ?? '');
        if (!epicKey) { return; }
        await vscode.commands.executeCommand('cfPipeline.advanceEpic', epicKey);
        break;
      }
    }
  }

  private getHtml(): string {
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AIDLC Pipeline</title>
<style>${SIDEBAR_CSS}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">${SIDEBAR_JS}</script>
</body>
</html>`;
  }
}

interface SerializedPhase {
  id: string;
  name: string;
  agent: string;
  agentEmoji: string;
  status: PhaseStatusValue;
  artifact: string | null;
  artifactPath: string | null;
  input: string;
  output: string;
  command: string;
  revision?: number;
  hasFeedback: boolean;
  contextValue: PhaseContextValue;
}

interface SerializedEpic {
  key: string;
  title: string;
  progress: number;
  currentPhase: number;
  hasAwaitingReview: boolean;
  hasFailure: boolean;
  phases: SerializedPhase[];
}

function serializeEpic(epic: EpicStatus): SerializedEpic {
  return {
    key: epic.key,
    title: epic.title,
    progress: epic.progress,
    currentPhase: epic.currentPhase,
    hasAwaitingReview: epic.hasAwaitingReview,
    hasFailure: epic.hasFailure,
    phases: epic.phases.map((p, idx) => ({
      id: p.id,
      name: p.name,
      agent: p.agent,
      agentEmoji: p.agentEmoji,
      status: p.status,
      artifact: p.artifact,
      artifactPath: p.artifactPath,
      input: p.input,
      output: p.output,
      command: p.command,
      revision: p.revision,
      hasFeedback: !!(p.userFeedback && p.userFeedback.length > 0),
      contextValue: computePhaseContextValue(p, idx === epic.currentPhase),
    })),
  };
}

type PhaseContextValue =
  | 'phase'
  | 'phase-run'
  | 'phase-rerun'
  | 'phase-review'
  | 'phase-feedback';

/**
 * Mirror of the legacy pipelineProvider.computePhaseContextValue. Drives the
 * per-phase action pill (Run / Re-run / Review / Feedback / no-op).
 */
function computePhaseContextValue(phase: PhaseStatus, isNext: boolean): PhaseContextValue {
  const s = phase.status;
  if (s === 'awaiting_human_review') { return 'phase-review'; }
  if (s === 'rejected' || s === 'failed_needs_human') { return 'phase-feedback'; }

  const isOrchestratorManaged = phase.revision !== undefined;
  if (!isOrchestratorManaged) {
    if (s === 'done' || s === 'passed') { return 'phase-rerun'; }
    return 'phase-run';
  }

  if (s === 'passed' || s === 'done' || s === 'in_progress' || s === 'in-progress' || s === 'in_review') {
    return 'phase-rerun';
  }
  if (s === 'stale' || (s === 'pending' && isNext)) {
    return 'phase-run';
  }
  return 'phase';
}

function computePrimaryAction(phase: PhaseStatus, epic: EpicStatus): string {
  const isNext = epic.currentPhase < epic.phases.length && epic.phases[epic.currentPhase].id === phase.id;
  return computePhaseContextValue(phase, isNext);
}

const COMMAND_FOR_ACTION: Record<string, string> = {
  'phase-review': 'cfPipeline.reviewGate',
  'phase-feedback': 'cfPipeline.feedbackAndRerun',
  'phase-rerun': 'cfPipeline.runStep',
  'phase-run': 'cfPipeline.runStep',
  'phase': 'cfPipeline.openPhaseSession',
};

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
  --done: #86d4a8;
  --progress: #e8c872;
  --review: #fbbf24;
  --rejected: #f87171;
  --stale: #c4a4d4;
  --glass: rgba(255,255,255,0.04);
  --glass-strong: rgba(255,255,255,0.08);
  --glass-border: rgba(94,234,212,0.18);
  --hairline: rgba(255,255,255,0.06);
  --pill-radius: 999px;
  --radius: 14px;
  --radius-sm: 10px;
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
  overflow-x: hidden;
}

.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
.brand-mark {
  width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-3) 100%);
  display: grid; place-items: center;
  color: #062423; font-weight: 800; font-size: 13px;
  box-shadow: 0 4px 14px rgba(94,234,212,0.30);
  flex-shrink: 0;
}
.brand-meta { min-width: 0; }
.brand-title {
  font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--text); font-weight: 700;
}
.brand-sub {
  font-size: 9.5px; letter-spacing: 0.4px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.toolbar { display: flex; gap: 4px; flex-shrink: 0; }
.icon-btn {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  border: 1px solid var(--hairline);
  border-radius: 7px;
  background: var(--glass);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: all .15s ease;
}
.icon-btn:hover {
  background: var(--glass-strong);
  color: var(--accent);
  border-color: var(--glass-border);
}

.cli-btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(94,234,212,0.32);
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, rgba(94,234,212,0.14), rgba(45,212,191,0.04));
  color: var(--accent);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 14px;
  transition: all .15s ease;
  box-shadow: 0 2px 14px rgba(94,234,212,0.10);
}
.cli-btn:hover {
  background: linear-gradient(135deg, rgba(94,234,212,0.20), rgba(45,212,191,0.08));
  box-shadow: 0 4px 20px rgba(94,234,212,0.20);
  transform: translateY(-1px);
}
.cli-btn .glyph { font-size: 12px; }
.cli-btn .arrow { margin-left: auto; opacity: .55; font-weight: 400; }

.empty-card {
  padding: 20px 16px;
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(94,234,212,0.04), rgba(255,255,255,0.02));
  text-align: center;
}
.empty-card h3 { font-size: 12px; color: var(--text); margin-bottom: 6px; font-weight: 700; letter-spacing: 0.3px; }
.empty-card p { font-size: 10.5px; color: var(--text-soft); margin-bottom: 14px; line-height: 1.55; }
.empty-actions { display: flex; flex-direction: column; gap: 6px; }
.btn-primary {
  width: 100%;
  padding: 9px 12px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #062423; font-weight: 700;
  border: none; border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 10.5px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  transition: all .15s ease;
}
.btn-primary:hover { box-shadow: 0 4px 18px rgba(94,234,212,0.30); transform: translateY(-1px); }
.btn-ghost {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  color: var(--text-soft);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 10.5px;
  letter-spacing: 0.4px;
  transition: all .15s ease;
}
.btn-ghost:hover { color: var(--accent); border-color: var(--glass-border); }

.epic {
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--glass);
  margin-bottom: 12px;
  overflow: hidden;
  transition: border-color .15s ease;
}
.epic:hover { border-color: var(--glass-border); }
.epic.has-review { border-color: rgba(251,191,36,0.30); }
.epic.has-failure { border-color: rgba(248,113,113,0.30); }

.epic-head {
  padding: 11px 12px 8px;
  display: flex; align-items: baseline; gap: 8px;
  cursor: pointer;
}
.epic-head:hover .epic-title { color: var(--accent); }
.epic-key {
  font-size: 10.5px; font-weight: 700;
  color: var(--accent); letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.epic-title {
  font-size: 11px; color: var(--text-soft); flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-weight: 500;
  transition: color .12s ease;
}
.epic-progress {
  font-size: 10px; color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.epic-badge {
  font-size: 11px;
  margin-left: 4px;
}

.epic-strip {
  padding: 0 12px 10px;
  display: flex; gap: 3px;
}
.dot {
  flex: 1; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,0.10);
  transition: background .15s ease;
}
.dot.s-done { background: var(--done); }
.dot.s-progress { background: var(--progress); }
.dot.s-review { background: var(--review); }
.dot.s-rejected { background: var(--rejected); }
.dot.s-stale { background: var(--stale); }

.epic-current {
  padding: 0 12px 10px;
  font-size: 9.5px; color: var(--text-faint);
  letter-spacing: 0.3px;
}
.epic-current strong {
  color: var(--text-soft);
  font-weight: 600;
}

.phases {
  border-top: 1px solid var(--hairline);
  padding: 4px 0;
}
.phase {
  border-left: 2px solid transparent;
  transition: border-color .12s ease;
}
.phase.is-current {
  border-left-color: var(--accent);
  background: rgba(94,234,212,0.04);
}
.phase.is-rejected { border-left-color: var(--rejected); }
.phase.is-review { border-left-color: var(--review); }

.phase-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background .12s ease;
}
.phase-row:hover { background: rgba(255,255,255,0.025); }

.phase-caret {
  font-size: 9px;
  color: var(--text-faint);
  width: 10px;
  text-align: center;
  flex-shrink: 0;
  transition: transform .15s ease, color .12s ease;
  user-select: none;
}
.phase.is-expanded .phase-caret {
  transform: rotate(90deg);
  color: var(--accent);
}

.phase-details {
  display: none;
  padding: 4px 12px 10px 32px;
  background: rgba(0,0,0,0.18);
  border-top: 1px solid var(--hairline);
}
.phase.is-expanded .phase-details { display: block; }

.detail-row {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 10.5px;
  align-items: baseline;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.detail-row:last-child { border-bottom: none; }
.detail-label {
  flex-shrink: 0;
  width: 56px;
  color: var(--text-faint);
  font-size: 9px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  font-weight: 700;
  padding-top: 1px;
}
.detail-value {
  flex: 1;
  color: var(--text-soft);
  word-break: break-word;
  line-height: 1.45;
}
.detail-value.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--accent);
  background: rgba(94,234,212,0.06);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(94,234,212,0.12);
}
.detail-value.link {
  color: var(--accent);
  cursor: pointer;
  text-decoration: none;
}
.detail-value.link:hover { text-decoration: underline; }
.detail-value.empty { color: var(--text-faint); font-style: italic; }
.detail-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.04);
}
.detail-action {
  flex: 1;
  padding: 5px 8px;
  background: var(--glass);
  color: var(--text-soft);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  transition: all .12s ease;
}
.detail-action:hover {
  background: var(--glass-strong);
  color: var(--accent);
  border-color: var(--glass-border);
}
.phase-icon {
  width: 14px; height: 14px;
  display: grid; place-items: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.phase-icon.s-done { color: var(--done); }
.phase-icon.s-progress { color: var(--progress); }
.phase-icon.s-review { color: var(--review); }
.phase-icon.s-rejected { color: var(--rejected); }
.phase-icon.s-pending { color: var(--text-faint); }
.phase-icon.s-stale { color: var(--stale); }

.phase-body { flex: 1; min-width: 0; }
.phase-name {
  font-size: 11px; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-weight: 500;
}
.phase-meta {
  font-size: 9.5px; color: var(--text-faint);
  margin-top: 1px;
  letter-spacing: 0.2px;
}
.phase-feedback-mark { color: var(--accent-3); margin-left: 4px; }

.phase-pill {
  font-size: 9px; font-weight: 700;
  padding: 3.5px 8px;
  border-radius: var(--pill-radius);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  white-space: nowrap;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: all .12s ease;
  flex-shrink: 0;
}
.phase-pill:hover { transform: scale(1.04); }
.pill-run {
  background: rgba(94,234,212,0.16);
  color: var(--accent);
  border-color: rgba(94,234,212,0.34);
  box-shadow: 0 2px 10px rgba(94,234,212,0.15);
}
.pill-rerun {
  background: rgba(255,255,255,0.06);
  color: var(--text-soft);
  border-color: rgba(255,255,255,0.12);
}
.pill-review {
  background: rgba(251,191,36,0.16);
  color: var(--review);
  border-color: rgba(251,191,36,0.34);
}
.pill-feedback {
  background: rgba(236,164,184,0.16);
  color: var(--accent-3);
  border-color: rgba(236,164,184,0.34);
}
.pill-done {
  background: transparent;
  color: var(--done);
  border-color: transparent;
  cursor: default;
}
.pill-done:hover { transform: none; }
.pill-muted {
  background: transparent;
  color: var(--text-faint);
  border-color: transparent;
  cursor: default;
}
.pill-muted:hover { transform: none; }

.section-title {
  font-size: 9px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 10px 12px 4px;
  font-weight: 700;
}
.artifact {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px;
  font-size: 10.5px; color: var(--text-soft);
  cursor: pointer;
  transition: color .12s ease;
}
.artifact:hover { color: var(--accent); }
.artifact-icon { font-size: 10px; opacity: 0.7; flex-shrink: 0; }
.artifact-name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.epic-actions {
  display: flex; gap: 6px;
  padding: 8px 12px 12px;
  border-top: 1px solid var(--hairline);
  margin-top: 4px;
}
.epic-action {
  flex: 1;
  padding: 6px 8px;
  background: var(--glass);
  color: var(--text-soft);
  border: 1px solid var(--hairline);
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  transition: all .12s ease;
}
.epic-action:hover {
  background: var(--glass-strong);
  color: var(--accent);
  border-color: var(--glass-border);
}
.epic-action.primary {
  background: linear-gradient(135deg, rgba(94,234,212,0.16), rgba(45,212,191,0.06));
  color: var(--accent);
  border-color: rgba(94,234,212,0.30);
}

.footer {
  margin-top: 12px;
  padding: 8px 4px;
  font-size: 9.5px; color: var(--text-faint);
  text-align: center;
  letter-spacing: 0.3px;
}
.footer a {
  color: var(--text-soft);
  cursor: pointer;
  text-decoration: none;
}
.footer a:hover { color: var(--accent); }
`;

const SIDEBAR_JS = `
const vscode = acquireVsCodeApi();
let state = { epics: [], empty: true };
const expandedPhases = new Set();

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'state') {
    state = { epics: msg.epics || [], empty: !!msg.empty };
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

function pillFor(phase) {
  switch (phase.contextValue) {
    case 'phase-review':   return { cls: 'pill-review',   label: 'Review',   actionable: true };
    case 'phase-feedback': return { cls: 'pill-feedback', label: 'Feedback', actionable: true };
    case 'phase-rerun':    return { cls: 'pill-rerun',    label: 'Re-run',   actionable: true };
    case 'phase-run':      return { cls: 'pill-run',      label: 'Run',      actionable: true };
    default:
      if (phase.status === 'passed' || phase.status === 'done') {
        return { cls: 'pill-done', label: '✓ Done', actionable: false };
      }
      if (phase.status === 'blocked') {
        return { cls: 'pill-muted', label: 'Blocked', actionable: false };
      }
      return { cls: 'pill-muted', label: 'Pending', actionable: false };
  }
}

function phaseSeverityClass(status) {
  if (status === 'passed' || status === 'done') return 's-done';
  if (status === 'in_progress' || status === 'in-progress' || status === 'in_review') return 's-progress';
  if (status === 'awaiting_human_review') return 's-review';
  if (status === 'rejected' || status === 'failed_needs_human') return 's-rejected';
  if (status === 'stale') return 's-stale';
  return 's-pending';
}

function phaseGlyph(status) {
  if (status === 'passed' || status === 'done') return '✓';
  if (status === 'in_progress' || status === 'in-progress') return '◐';
  if (status === 'in_review') return '◑';
  if (status === 'awaiting_human_review') return '🔔';
  if (status === 'rejected') return '✕';
  if (status === 'failed_needs_human') return '!';
  if (status === 'stale') return '⚠';
  if (status === 'blocked') return '⊘';
  return '○';
}

function render() {
  const root = document.getElementById('app');
  const epics = state.epics;
  const totalEpics = epics.length;
  const activeEpics = epics.filter(function(e) { return e.progress > 0 && e.progress < 100; }).length;

  let html = '';
  html += '<div class="header">';
  html += '<div class="brand">';
  html += '<div class="brand-mark">A</div>';
  html += '<div class="brand-meta">';
  html += '<div class="brand-title">AIDLC</div>';
  if (totalEpics === 0) {
    html += '<div class="brand-sub">No epics yet</div>';
  } else {
    html += '<div class="brand-sub">' + totalEpics + ' epic' + (totalEpics === 1 ? '' : 's') + ' · ' + activeEpics + ' active</div>';
  }
  html += '</div></div>';
  html += '<div class="toolbar">';
  html += '<button class="icon-btn" data-action="refresh" title="Refresh">⟳</button>';
  html += '<button class="icon-btn" data-action="dashboard" title="Open Dashboard">▦</button>';
  html += '<button class="icon-btn" data-action="folder" title="Select Epics Folder">▤</button>';
  html += '<button class="icon-btn" data-action="settings" title="Settings">⚙</button>';
  html += '</div>';
  html += '</div>';

  html += '<button class="cli-btn" data-action="claude" title="Open zsh terminal and run Claude CLI">';
  html += '<span class="glyph">▶</span>';
  html += '<span>Open Claude CLI</span>';
  html += '<span class="arrow">↗</span>';
  html += '</button>';

  if (state.empty || totalEpics === 0) {
    html += '<div class="empty-card">';
    html += '<h3>No SDLC epics yet</h3>';
    html += '<p>Spin up a fully-bootstrapped example workspace to explore the AIDLC pipeline end-to-end.</p>';
    html += '<div class="empty-actions">';
    html += '<button class="btn-primary" data-action="loadExample">Load Example Project</button>';
    html += '<button class="btn-ghost" data-action="settings">Pipeline Settings</button>';
    html += '<button class="btn-ghost" data-action="folder">Select Epics Folder</button>';
    html += '</div>';
    html += '</div>';
  } else {
    for (var i = 0; i < epics.length; i++) {
      html += renderEpic(epics[i]);
    }
  }

  html += '<div class="footer">AIDLC Pipeline · <a data-action="settings">Settings</a> · <a data-action="dashboard">Dashboard</a></div>';

  root.innerHTML = html;
}

function renderEpic(epic) {
  let html = '';
  let cls = 'epic';
  if (epic.hasFailure) { cls += ' has-failure'; }
  else if (epic.hasAwaitingReview) { cls += ' has-review'; }

  const badge = epic.hasFailure ? '<span class="epic-badge" title="Auto-reviewer needs human">⛔</span>'
              : epic.hasAwaitingReview ? '<span class="epic-badge" title="Awaiting review">🔔</span>'
              : '';

  const currentName = epic.currentPhase < epic.phases.length
    ? epic.phases[epic.currentPhase].name
    : 'Complete';

  html += '<div class="' + cls + '">';
  html += '<div class="epic-head" data-action="openEpic" data-key="' + escapeHtml(epic.key) + '">';
  html += '<div class="epic-key">' + escapeHtml(epic.key) + '</div>';
  html += '<div class="epic-title">' + escapeHtml(epic.title) + badge + '</div>';
  html += '<div class="epic-progress">' + epic.progress + '%</div>';
  html += '</div>';

  // Phase strip dots
  html += '<div class="epic-strip">';
  for (let i = 0; i < epic.phases.length; i++) {
    html += '<div class="dot ' + phaseSeverityClass(epic.phases[i].status) + '" title="' + escapeHtml(epic.phases[i].name + ': ' + epic.phases[i].status) + '"></div>';
  }
  html += '</div>';

  html += '<div class="epic-current">Current: <strong>' + escapeHtml(currentName) + '</strong></div>';

  html += '<div class="phases">';
  for (let i = 0; i < epic.phases.length; i++) {
    html += renderPhase(epic, epic.phases[i], i);
  }
  html += '</div>';

  // Run files / artifacts
  const artifacts = epic.phases.filter(function(p) { return p.artifactPath; });
  if (artifacts.length > 0) {
    html += '<div class="section-title">Run Files</div>';
    for (let i = 0; i < artifacts.length; i++) {
      const a = artifacts[i];
      html += '<div class="artifact" data-action="openArtifact" data-path="' + escapeHtml(a.artifactPath) + '" data-epic="' + escapeHtml(epic.key) + '">';
      html += '<span class="artifact-icon">📄</span>';
      html += '<span class="artifact-name">' + escapeHtml(a.artifact || '') + '</span>';
      html += '</div>';
    }
  }

  html += '<div class="epic-actions">';
  html += '<button class="epic-action primary" data-action="advance" data-key="' + escapeHtml(epic.key) + '">▶ Advance</button>';
  html += '<button class="epic-action" data-action="dashboard">Dashboard</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderPhase(epic, phase, idx) {
  const isCurrent = epic.currentPhase === idx;
  const sev = phaseSeverityClass(phase.status);
  const pill = pillFor(phase);
  const expandKey = epic.key + '/' + phase.id;
  const isExpanded = expandedPhases.has(expandKey);

  let cls = 'phase';
  if (isCurrent) { cls += ' is-current'; }
  if (phase.status === 'rejected' || phase.status === 'failed_needs_human') { cls += ' is-rejected'; }
  if (phase.status === 'awaiting_human_review') { cls += ' is-review'; }
  if (isExpanded) { cls += ' is-expanded'; }

  const revLabel = (phase.revision && phase.revision > 1) ? ' · rev ' + phase.revision : '';
  const feedbackMark = phase.hasFeedback ? '<span class="phase-feedback-mark" title="Has user feedback">●</span>' : '';

  let html = '';
  html += '<div class="' + cls + '">';
  html += '<div class="phase-row" data-action="togglePhase" data-epic="' + escapeHtml(epic.key) + '" data-phase="' + escapeHtml(phase.id) + '">';
  html += '<div class="phase-caret">▶</div>';
  html += '<div class="phase-icon ' + sev + '">' + phaseGlyph(phase.status) + '</div>';
  html += '<div class="phase-body">';
  html += '<div class="phase-name">' + escapeHtml(phase.name) + feedbackMark + '</div>';
  html += '<div class="phase-meta">' + escapeHtml(phase.agentEmoji + ' ' + phase.agent) + revLabel + '</div>';
  html += '</div>';

  if (pill.actionable) {
    html += '<button class="phase-pill ' + pill.cls + '" data-action="phasePrimary" data-epic="' + escapeHtml(epic.key) + '" data-phase="' + escapeHtml(phase.id) + '">' + pill.label + '</button>';
  } else {
    html += '<span class="phase-pill ' + pill.cls + '">' + pill.label + '</span>';
  }
  html += '</div>';

  // Details panel — Input / Output / Command / Artifact + per-phase actions
  html += '<div class="phase-details">';
  html += '<div class="detail-row"><span class="detail-label">Input</span><span class="detail-value' + (phase.input ? '' : ' empty') + '">' + escapeHtml(phase.input || '—') + '</span></div>';
  html += '<div class="detail-row"><span class="detail-label">Output</span><span class="detail-value' + (phase.output ? '' : ' empty') + '">' + escapeHtml(phase.output || '—') + '</span></div>';
  html += '<div class="detail-row"><span class="detail-label">Command</span><span class="detail-value mono">' + escapeHtml(phase.command || '—') + '</span></div>';
  if (phase.artifactPath) {
    html += '<div class="detail-row"><span class="detail-label">Artifact</span>';
    html += '<a class="detail-value link" data-action="openArtifact" data-path="' + escapeHtml(phase.artifactPath) + '" data-epic="' + escapeHtml(epic.key) + '">' + escapeHtml(phase.artifact || phase.artifactPath) + '</a>';
    html += '</div>';
  }
  html += '<div class="detail-actions">';
  html += '<button class="detail-action" data-action="phaseSession" data-epic="' + escapeHtml(epic.key) + '" data-phase="' + escapeHtml(phase.id) + '">Open Session</button>';
  html += '<button class="detail-action" data-action="phaseAction" data-action-kind="phase-feedback" data-epic="' + escapeHtml(epic.key) + '" data-phase="' + escapeHtml(phase.id) + '">Feedback</button>';
  html += '<button class="detail-action" data-action="phaseAction" data-action-kind="phase-review" data-epic="' + escapeHtml(epic.key) + '" data-phase="' + escapeHtml(phase.id) + '">Review</button>';
  html += '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

document.addEventListener('click', function(e) {
  const target = e.target.closest('[data-action]');
  if (!target) { return; }
  const action = target.dataset.action;

  if (action === 'togglePhase') {
    const key = target.dataset.epic + '/' + target.dataset.phase;
    if (expandedPhases.has(key)) { expandedPhases.delete(key); }
    else { expandedPhases.add(key); }
    render();
    return;
  }
  if (action === 'phasePrimary') {
    e.stopPropagation();
    post('phaseAction', { epicKey: target.dataset.epic, phaseId: target.dataset.phase });
    return;
  }
  if (action === 'phaseAction') {
    e.stopPropagation();
    post('phaseAction', {
      epicKey: target.dataset.epic,
      phaseId: target.dataset.phase,
      action: target.dataset.actionKind,
    });
    return;
  }
  if (action === 'phaseSession') {
    e.stopPropagation();
    post('openPhaseSession', { epicKey: target.dataset.epic, phaseId: target.dataset.phase });
    return;
  }
  if (action === 'openEpic') {
    post('openEpic', { epicKey: target.dataset.key });
    return;
  }
  if (action === 'openArtifact') {
    e.stopPropagation();
    post('openArtifact', { path: target.dataset.path, epicKey: target.dataset.epic });
    return;
  }
  if (action === 'advance') {
    e.stopPropagation();
    post('advanceEpic', { epicKey: target.dataset.key });
    return;
  }
  if (action === 'claude') { post('openClaude'); return; }
  if (action === 'refresh') { post('refresh'); return; }
  if (action === 'dashboard') { post('openDashboard'); return; }
  if (action === 'settings') { post('openSettings'); return; }
  if (action === 'folder') { post('selectEpicsFolder'); return; }
  if (action === 'loadExample') { post('loadExample'); return; }
});

post('ready');
`;
