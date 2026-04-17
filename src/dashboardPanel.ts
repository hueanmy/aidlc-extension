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
    --text: rgba(255,255,255,0.92);
    --text-muted: rgba(255,255,255,0.52);
    --accent: #8cb8e0;
    --accent-2: #a796d4;
    --accent-3: #eca4b8;
    --done: #86d4a8;
    --progress: #e8c872;
    --blocked: #eca4b8;
    --silver: #b8bcc8;
    --pending: rgba(255,255,255,0.4);
    --glass: rgba(255,255,255,0.06);
    --glass-strong: rgba(255,255,255,0.1);
    --glass-border: rgba(255,255,255,0.14);
    --glass-shadow:
      0 1px 0 rgba(255,255,255,0.18) inset,
      0 -1px 0 rgba(0,0,0,0.28) inset,
      0 20px 60px -20px rgba(0,0,0,0.55),
      0 2px 10px rgba(0,0,0,0.25);
    --radius: 22px;
    --radius-sm: 14px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
    color: var(--text);
    padding: 32px 28px 80px;
    background:
      radial-gradient(1200px 700px at 85% -10%, rgba(167,150,212,0.20), transparent 60%),
      radial-gradient(900px 600px at -10% 110%, rgba(140,184,224,0.16), transparent 55%),
      radial-gradient(700px 500px at 50% 50%, rgba(236,164,184,0.08), transparent 70%),
      linear-gradient(180deg, #101425 0%, #0a0d18 100%);
    background-attachment: fixed;
    position: relative;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }
  body::before,
  body::after {
    content: '';
    position: fixed;
    border-radius: 50%;
    filter: blur(90px);
    opacity: 0.38;
    pointer-events: none;
    z-index: -1;
  }
  body::before {
    width: 560px; height: 560px;
    top: -120px; right: -120px;
    background: radial-gradient(circle at 30% 30%, #8cb8e0, transparent 60%);
    animation: drift1 22s ease-in-out infinite alternate;
  }
  body::after {
    width: 680px; height: 680px;
    bottom: -220px; left: -180px;
    background: radial-gradient(circle at 60% 60%, #a796d4, transparent 60%);
    animation: drift2 28s ease-in-out infinite alternate;
  }
  @keyframes drift1 { to { transform: translate(-60px, 80px) scale(1.1); } }
  @keyframes drift2 { to { transform: translate(80px, -60px) scale(1.08); } }

  h1 {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
    background: linear-gradient(135deg, #ffffff 0%, #cfddee 40%, #d4cbe6 75%, #eccdd6 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: 13px;
    margin-bottom: 28px;
    letter-spacing: 0.01em;
  }

  /* ---- Glass card base ---- */
  .epic-card, .stat-card {
    position: relative;
    background: var(--glass);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
  }
  .epic-card::before, .stat-card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 45%);
    pointer-events: none;
    border-radius: inherit;
  }

  .epic-card {
    padding: 24px 26px;
    margin-bottom: 18px;
    transition: transform 0.25s ease, box-shadow 0.25s ease;
  }
  .epic-card:hover {
    transform: translateY(-2px);
    box-shadow:
      0 1px 0 rgba(255,255,255,0.22) inset,
      0 -1px 0 rgba(0,0,0,0.3) inset,
      0 30px 70px -20px rgba(140,184,224,0.2),
      0 2px 10px rgba(0,0,0,0.3);
  }
  .epic-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 18px;
  }
  .epic-title {
    font-size: 15px; font-weight: 600; color: #fff; letter-spacing: 0.01em;
  }
  .epic-title span {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    font-weight: 700;
  }
  .progress-badge {
    font-size: 11px; font-weight: 700;
    padding: 5px 12px; border-radius: 999px;
    color: #0b0b12;
    letter-spacing: 0.03em;
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.18);
  }
  .progress-badge.done { background: linear-gradient(135deg, #86d4a8, #8cb8e0); }
  .progress-badge.active { background: linear-gradient(135deg, #e8c872, #eca4b8); }
  .progress-badge.new {
    background: rgba(255,255,255,0.08); color: var(--text);
    border-color: rgba(255,255,255,0.14);
  }

  /* ---- Progress bar ---- */
  .progress-bar-container {
    width: 100%;
    height: 4px;
    background: rgba(255,255,255,0.08);
    border-radius: 999px;
    margin-bottom: 22px;
    overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3)) !important;
    box-shadow: 0 0 12px rgba(167,150,212,0.55);
    transition: width 0.5s cubic-bezier(.2,.9,.2,1);
  }

  /* ---- Pipeline ---- */
  .pipeline {
    display: flex;
    gap: 0;
    overflow-x: auto;
    padding-bottom: 8px;
  }
  .phase {
    display: flex; flex-direction: column; align-items: center;
    min-width: 100px; flex: 1; position: relative;
  }
  .phase-connector {
    position: absolute;
    top: 18px;
    left: 50%;
    width: 100%;
    height: 2px;
    z-index: 0;
    background: rgba(255,255,255,0.08) !important;
    border-radius: 999px;
  }
  .phase.done + .phase .phase-connector,
  .phase.done .phase-connector {
    background: linear-gradient(90deg, #86d4a8, #8cb8e0) !important;
    box-shadow: 0 0 8px rgba(134,212,168,0.38);
  }
  .phase:last-child .phase-connector { display: none; }

  .phase-dot {
    width: 36px; height: 36px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700;
    color: #fff;
    z-index: 1; position: relative;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.2);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    background: rgba(255,255,255,0.06);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.28),
      inset 0 -1px 0 rgba(0,0,0,0.35),
      0 4px 14px rgba(0,0,0,0.3);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .phase-dot:hover { transform: scale(1.12); }
  .phase-dot.done {
    background: radial-gradient(circle at 30% 25%, #b5e5cc, #86d4a8 60%, #5fb889);
    color: #0d2e1e;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.45),
      0 0 20px rgba(134,212,168,0.38),
      0 4px 16px rgba(0,0,0,0.35);
  }
  .phase-dot.in-progress {
    background: radial-gradient(circle at 30% 25%, #f2dea0, #e8c872 60%, #ccac58);
    color: #3a2a08;
    animation: pulseGlow 2.2s ease-in-out infinite;
  }
  .phase-dot.pending { color: rgba(255,255,255,0.5); }
  .phase-dot.blocked {
    background: radial-gradient(circle at 30% 25%, #f3c3cf, #eca4b8 60%, #d1859a);
    color: #3a1823;
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 0 rgba(232,200,114,0.45), 0 4px 14px rgba(0,0,0,0.3); }
    50% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 12px rgba(232,200,114,0), 0 4px 14px rgba(0,0,0,0.3); }
  }

  .phase-label {
    font-size: 10px; font-weight: 700;
    margin-top: 10px; text-align: center;
    color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .phase-agent {
    font-size: 9px; color: var(--text-muted);
    margin-top: 3px; opacity: 0.7; letter-spacing: 0.05em;
  }
  .phase.active .phase-label {
    background: linear-gradient(135deg, var(--progress), var(--accent-3));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .phase.done .phase-label {
    background: linear-gradient(135deg, var(--done), var(--accent));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }

  /* ---- Phase detail tooltip (glass popover) ---- */
  .phase-detail {
    display: none;
    position: absolute;
    top: 82px; left: 50%;
    transform: translateX(-50%);
    background: rgba(18,18,28,0.72);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(32px) saturate(180%);
    -webkit-backdrop-filter: blur(32px) saturate(180%);
    padding: 14px;
    width: 260px; z-index: 10;
    font-size: 11px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14);
  }
  .phase:hover .phase-detail { display: block; }
  .phase-detail h4 { color: #fff; margin-bottom: 10px; font-size: 12px; letter-spacing: 0.01em; }
  .phase-detail .row { margin-bottom: 8px; }
  .phase-detail .row-label {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  }
  .phase-detail .row-value { color: var(--text); margin-top: 3px; line-height: 1.45; }
  .phase-detail .cmd {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--accent);
    background: rgba(140,184,224,0.1);
    border: 1px solid rgba(140,184,224,0.22);
    padding: 2px 8px; border-radius: 6px; font-size: 10px;
  }

  /* ---- Stats ---- */
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 28px;
  }
  .stat-card {
    padding: 20px 22px;
    text-align: left;
    transition: transform 0.25s ease;
  }
  .stat-card:hover { transform: translateY(-2px); }
  .stat-value {
    font-size: 34px; font-weight: 700; letter-spacing: -0.02em;
    background: linear-gradient(135deg, #ffffff, #c9e8ff);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .stat-label {
    font-size: 10px; color: var(--text-muted);
    margin-top: 6px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;
  }
  @media (max-width: 860px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
  }
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
