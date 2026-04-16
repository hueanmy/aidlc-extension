import * as vscode from 'vscode';
import { EpicStatus, PhaseStatus } from './epicScanner';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, private extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static show(extensionUri: vscode.Uri, epics: EpicStatus[]) {
    const column = vscode.ViewColumn.One;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      DashboardPanel.currentPanel.update(epics);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'cfDashboard',
      'SDLC Pipeline Dashboard',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
    DashboardPanel.currentPanel.update(epics);
  }

  public update(epics: EpicStatus[]) {
    this._panel.webview.html = this.getHtml(epics);
  }

  private dispose() {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  private getHtml(epics: EpicStatus[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SDLC Pipeline Dashboard</title>
<style>
  :root {
    --bg: #1e1e1e;
    --card-bg: #252526;
    --border: #333;
    --text: #ccc;
    --text-muted: #888;
    --accent: #4fc3f7;
    --done: #4caf50;
    --progress: #ff9800;
    --pending: #555;
    --blocked: #f44336;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #fff;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: 13px;
    margin-bottom: 24px;
  }
  .epic-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .epic-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .epic-title {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
  }
  .epic-title span {
    color: var(--accent);
    font-weight: 700;
  }
  .progress-badge {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 12px;
    color: #fff;
  }
  .progress-badge.done { background: var(--done); }
  .progress-badge.active { background: var(--progress); }
  .progress-badge.new { background: var(--pending); }

  /* Progress bar */
  .progress-bar-container {
    width: 100%;
    height: 4px;
    background: var(--pending);
    border-radius: 2px;
    margin-bottom: 20px;
    overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  /* Pipeline flow */
  .pipeline {
    display: flex;
    gap: 0;
    overflow-x: auto;
    padding-bottom: 8px;
  }
  .phase {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 100px;
    flex: 1;
    position: relative;
  }
  .phase-connector {
    position: absolute;
    top: 16px;
    left: 50%;
    width: 100%;
    height: 2px;
    z-index: 0;
  }
  .phase:last-child .phase-connector { display: none; }

  .phase-dot {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    z-index: 1;
    position: relative;
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .phase-dot:hover { transform: scale(1.15); }
  .phase-dot.done { background: var(--done); }
  .phase-dot.in-progress { background: var(--progress); animation: pulse 2s infinite; }
  .phase-dot.pending { background: var(--pending); color: #999; }
  .phase-dot.blocked { background: var(--blocked); }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.4); }
    50% { box-shadow: 0 0 0 8px rgba(255, 152, 0, 0); }
  }

  .phase-label {
    font-size: 10px;
    font-weight: 600;
    margin-top: 6px;
    text-align: center;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .phase-agent {
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 2px;
    opacity: 0.7;
  }
  .phase.active .phase-label { color: var(--progress); }
  .phase.done .phase-label { color: var(--done); }

  /* Phase detail tooltip */
  .phase-detail {
    display: none;
    position: absolute;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 12px;
    width: 240px;
    z-index: 10;
    font-size: 11px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .phase:hover .phase-detail { display: block; }
  .phase-detail h4 { color: #fff; margin-bottom: 8px; font-size: 12px; }
  .phase-detail .row { margin-bottom: 6px; }
  .phase-detail .row-label { color: var(--accent); font-weight: 600; font-size: 10px; text-transform: uppercase; }
  .phase-detail .row-value { color: var(--text); margin-top: 2px; line-height: 1.4; }
  .phase-detail .cmd { font-family: monospace; color: var(--progress); background: #333; padding: 2px 6px; border-radius: 3px; font-size: 10px; }

  /* Summary stats */
  .stats {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
  }
  .stat-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    flex: 1;
    text-align: center;
  }
  .stat-value { font-size: 28px; font-weight: 700; color: #fff; }
  .stat-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>

<h1>SDLC Pipeline Dashboard</h1>
<p class="subtitle">SDLC pipeline tracker for all active epics</p>

${this.renderStats(epics)}

${epics.length === 0 ? '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No epics found in <code>docs/sdlc/epics/</code></p>' : ''}

${epics.map(epic => this.renderEpicCard(epic)).join('\n')}

</body>
</html>`;
  }

  private renderStats(epics: EpicStatus[]): string {
    const total = epics.length;
    const complete = epics.filter(e => e.progress === 100).length;
    const active = epics.filter(e => e.progress > 0 && e.progress < 100).length;
    const pending = epics.filter(e => e.progress === 0).length;

    return `
    <div class="stats">
      <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Epics</div></div>
      <div class="stat-card"><div class="stat-value" style="color: var(--done)">${complete}</div><div class="stat-label">Complete</div></div>
      <div class="stat-card"><div class="stat-value" style="color: var(--progress)">${active}</div><div class="stat-label">In Progress</div></div>
      <div class="stat-card"><div class="stat-value" style="color: var(--pending)">${pending}</div><div class="stat-label">Pending</div></div>
    </div>`;
  }

  private renderEpicCard(epic: EpicStatus): string {
    const badgeClass = epic.progress === 100 ? 'done' : epic.progress > 0 ? 'active' : 'new';
    const badgeText = epic.progress === 100 ? 'Complete' : epic.progress > 0 ? `${epic.progress}%` : 'New';
    const barColor = epic.progress === 100 ? 'var(--done)' : 'var(--progress)';

    return `
    <div class="epic-card">
      <div class="epic-header">
        <div class="epic-title"><span>${epic.key}</span> ${epic.title !== epic.key ? '— ' + epic.title : ''}</div>
        <div class="progress-badge ${badgeClass}">${badgeText}</div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${epic.progress}%; background: ${barColor}"></div>
      </div>
      <div class="pipeline">
        ${epic.phases.map((phase, i) => this.renderPhase(phase, i, epic.phases.length)).join('\n')}
      </div>
    </div>`;
  }

  private renderPhase(phase: PhaseStatus, index: number, total: number): string {
    const statusClass = phase.status;
    const phaseClass = phase.status === 'in-progress' ? 'active' : phase.status === 'done' ? 'done' : '';
    const connectorColor = phase.status === 'done' ? 'var(--done)' : 'var(--pending)';
    const dotLabel = (index + 1).toString();

    return `
    <div class="phase ${phaseClass}">
      ${index < total - 1 ? `<div class="phase-connector" style="background: ${connectorColor}"></div>` : ''}
      <div class="phase-dot ${statusClass}">${phase.status === 'done' ? '&#10003;' : dotLabel}</div>
      <div class="phase-label">${phase.name}</div>
      <div class="phase-agent">${phase.agentEmoji}</div>
      <div class="phase-detail">
        <h4>${phase.name} — ${phase.agent}</h4>
        <div class="row"><div class="row-label">Status</div><div class="row-value">${phase.status.toUpperCase()}</div></div>
        <div class="row"><div class="row-label">Command</div><div class="row-value"><span class="cmd">${phase.command}</span></div></div>
        <div class="row"><div class="row-label">Input</div><div class="row-value">${phase.input}</div></div>
        <div class="row"><div class="row-label">Output</div><div class="row-value">${phase.output}</div></div>
        ${phase.artifact ? `<div class="row"><div class="row-label">Artifact</div><div class="row-value">${phase.artifact}</div></div>` : ''}
      </div>
    </div>`;
  }
}
