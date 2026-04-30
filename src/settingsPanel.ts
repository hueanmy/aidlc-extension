import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EpicStatus } from './epicScanner';

export interface PipelineConfig {
  enabledPhases: string[];
}

interface SettingsPanelData {
  epics: EpicStatus[];
  epicsPath: string;
}

const ALL_PHASES = [
  { id: 'plan', name: 'Plan', agent: 'Product Owner', emoji: 'PO' },
  { id: 'design', name: 'Design', agent: 'Tech Lead', emoji: 'TL' },
  { id: 'test-plan', name: 'Test Plan', agent: 'QA Engineer', emoji: 'QA' },
  { id: 'implement', name: 'Implement', agent: 'Developer', emoji: 'Dev' },
  { id: 'review', name: 'Review', agent: 'Tech Lead', emoji: 'TL' },
  { id: 'execute-test', name: 'Execute Test', agent: 'QA Engineer', emoji: 'QA' },
  { id: 'release', name: 'Release', agent: 'Release Manager', emoji: 'RM' },
  { id: 'monitor', name: 'Monitor', agent: 'SRE', emoji: 'SRE' },
  { id: 'doc-sync', name: 'Doc Sync', agent: 'Archivist', emoji: 'Arc' },
];

const DEFAULT_ENABLED = ALL_PHASES.map(p => p.id);

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private epics: EpicStatus[] = [];
  private epicsPath = 'docs/sdlc/epics';

  private constructor(
    panel: vscode.WebviewPanel,
    private getData: () => SettingsPanelData,
    private onConfigChanged: () => void,
  ) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      msg => this.handleMessage(msg),
      null,
      this._disposables,
    );
  }

  public static show(
    extensionUri: vscode.Uri,
    getData: () => SettingsPanelData,
    onConfigChanged: () => void,
  ) {
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      SettingsPanel.currentPanel.getData = getData;
      SettingsPanel.currentPanel.onConfigChanged = onConfigChanged;
      SettingsPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'cfSettings',
      'Pipeline Settings',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, getData, onConfigChanged);
    SettingsPanel.currentPanel.update();
  }

  private update() {
    const { epics, epicsPath } = this.getData();
    this.epics = epics;
    this.epicsPath = epicsPath;
    const configs = this.epics.map(epic => ({
      key: epic.key,
      title: epic.title,
      enabledPhases: SettingsPanel.readConfig(epic.folderPath).enabledPhases,
    }));
    const cfg = vscode.workspace.getConfiguration('cfPipeline');
    const mcpSettings = {
      mcpPackage: cfg.get<string>('mcpPackage', ''),
      platform: cfg.get<string>('platform', 'generic'),
      mcpServerName: cfg.get<string>('mcpServerName', 'sdlc'),
      mcpCommand: cfg.get<string>('mcpCommand', 'npx'),
    };
    this._panel.webview.html = this.getHtml(configs, this.epicsPath, mcpSettings);
  }

  public static readConfig(epicDir: string): PipelineConfig {
    const configPath = path.join(epicDir, 'pipeline.json');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.enabledPhases)) {
          return { enabledPhases: parsed.enabledPhases };
        }
      } catch { /* ignore parse errors */ }
    }
    return { enabledPhases: DEFAULT_ENABLED };
  }

  private static writeConfig(epicDir: string, config: PipelineConfig): void {
    const configPath = path.join(epicDir, 'pipeline.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }

  private async handleMessage(msg: {
    type: string;
    epicKey?: string;
    epicDir?: string;
    phases?: string[];
    mcpPackage?: string;
    platform?: string;
  }): Promise<void> {
    if (msg.type === 'save' && msg.epicDir && msg.phases) {
      SettingsPanel.writeConfig(msg.epicDir, { enabledPhases: msg.phases });
      this.onConfigChanged();
      vscode.window.showInformationMessage(`Pipeline config saved for ${msg.epicKey}`);
    } else if (msg.type === 'saveAll' && msg.phases) {
      for (const epic of this.epics) {
        SettingsPanel.writeConfig(epic.folderPath, { enabledPhases: msg.phases });
      }
      this.onConfigChanged();
      this.update();
      vscode.window.showInformationMessage(`Pipeline config applied to all ${this.epics.length} epics`);
    } else if (msg.type === 'selectFolder') {
      await vscode.commands.executeCommand('cfPipeline.selectEpicsFolder');
      this.onConfigChanged();
      this.update();
    } else if (msg.type === 'saveMcp') {
      await this.handleSaveMcp(msg.mcpPackage, msg.platform);
    } else if (msg.type === 'resetMcp') {
      await this.handleResetMcp();
    } else if (msg.type === 'loadExampleProject') {
      await vscode.commands.executeCommand('cfPipeline.loadExampleProject');
    } else if (msg.type === 'clearExampleProject') {
      await vscode.commands.executeCommand('cfPipeline.clearExampleProject');
    }
  }

  private async handleResetMcp(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cfPipeline');
    const target = vscode.workspace.workspaceFolders?.[0]?.uri
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await cfg.update('mcpPackage', '', target);
    await cfg.update('platform', 'generic', target);
    await cfg.update('autoConfigureMcp', false, target);
    vscode.window.showInformationMessage(
      'MCP config cleared. No MCP server will be auto-installed until you set cfPipeline.mcpPackage and re-enable cfPipeline.autoConfigureMcp.',
    );
    this.update();
  }

  private async handleSaveMcp(mcpPackage: string | undefined, platform: string | undefined): Promise<void> {
    const pkg = (mcpPackage ?? '').trim();
    if (!pkg) {
      vscode.window.showErrorMessage('MCP package cannot be empty');
      return;
    }
    const plat = (platform ?? 'generic').trim() || 'generic';

    const cfg = vscode.workspace.getConfiguration('cfPipeline');
    const target = vscode.workspace.workspaceFolders?.[0]?.uri
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await cfg.update('mcpPackage', pkg, target);
    await cfg.update('platform', plat, target);
    await cfg.update('autoConfigureMcp', true, target);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const { ensureMcpConfig } = await import('./mcpConfigurator');
      const result = ensureMcpConfig(workspaceRoot, () => { /* silent from UI */ });
      if (result.status === 'written') {
        vscode.window.showInformationMessage(
          `MCP appended to .claude/settings.json: ${result.serverName} → ${pkg} (platform: ${plat}). Reload Claude Code for changes to take effect.`,
        );
      } else if (result.status === 'already-exists') {
        vscode.window.showWarningMessage(
          `MCP server "${result.serverName}" already exists in .claude/settings.json — left untouched (append-only). Edit that file manually if you want to change it.`,
        );
      } else {
        vscode.window.showWarningMessage(`MCP not written: ${result.reason}.`);
      }
    } else {
      vscode.window.showWarningMessage('MCP settings saved, but no workspace folder open — .claude/settings.json not written.');
    }
    this.update();
  }

  private dispose() {
    SettingsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  private getHtml(
    configs: { key: string; title: string; enabledPhases: string[] }[],
    epicsPath: string,
    mcp: { mcpPackage: string; platform: string; mcpServerName: string; mcpCommand: string },
  ): string {
    const phasesJson = JSON.stringify(ALL_PHASES);
    const configsJson = JSON.stringify(configs);
    const epicsJson = JSON.stringify(this.epics.map(e => ({ key: e.key, folderPath: e.folderPath })));
    const epicsPathJson = JSON.stringify(epicsPath);
    const mcpJson = JSON.stringify(mcp);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pipeline Settings</title>
<style>
  :root {
    --text: rgba(255,255,255,0.92);
    --text-muted: rgba(255,255,255,0.52);
    --accent: #5eead4;
    --accent-2: #2dd4bf;
    --accent-3: #eca4b8;
    --done: #86d4a8;
    --progress: #e8c872;
    --silver: #b8bcc8;
    --glass: rgba(255,255,255,0.06);
    --glass-strong: rgba(255,255,255,0.1);
    --glass-border: rgba(94,234,212,0.18);
    --glass-shadow:
      inset 0 1px 0 rgba(255,255,255,0.18),
      inset 0 -1px 0 rgba(0,0,0,0.28),
      0 20px 60px -20px rgba(0,0,0,0.55),
      0 2px 10px rgba(0,0,0,0.25);
    --radius: 22px;
    --radius-sm: 14px;
    --hover: rgba(255,255,255,0.05);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
    color: var(--text);
    padding: 32px 28px 80px;
    background:
      radial-gradient(1200px 700px at 85% -10%, rgba(45,212,191,0.20), transparent 60%),
      radial-gradient(900px 600px at -10% 110%, rgba(94,234,212,0.16), transparent 55%),
      radial-gradient(700px 500px at 50% 50%, rgba(236,164,184,0.08), transparent 70%),
      linear-gradient(180deg, #07090f 0%, #03050a 100%);
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
    background: radial-gradient(circle at 30% 30%, #5eead4, transparent 60%);
    animation: drift1 22s ease-in-out infinite alternate;
  }
  body::after {
    width: 680px; height: 680px;
    bottom: -220px; left: -180px;
    background: radial-gradient(circle at 60% 60%, #2dd4bf, transparent 60%);
    animation: drift2 28s ease-in-out infinite alternate;
  }
  @keyframes drift1 { to { transform: translate(-60px, 80px) scale(1.1); } }
  @keyframes drift2 { to { transform: translate(80px, -60px) scale(1.08); } }

  h1 {
    font-size: 28px; font-weight: 700; letter-spacing: -0.02em;
    margin-bottom: 6px;
    background: linear-gradient(135deg, #c084fc 0%, #e879f9 50%, #f472b6 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .subtitle { color: var(--text-muted); font-size: 13px; margin-bottom: 28px; }
  .section-header {
    font-size: 11px;
    font-weight: 700;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    margin: 36px 0 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(94,234,212,0.16);
  }
  .section-header:first-of-type { margin-top: 8px; }

  /* ---- Glass card base ---- */
  .path-card, .apply-all, .epic-card {
    position: relative;
    background: var(--glass);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
  }
  .path-card::before, .apply-all::before, .epic-card::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 45%);
    pointer-events: none;
    border-radius: inherit;
  }
  .path-card, .apply-all { padding: 22px 24px; margin-bottom: 16px; }
  .apply-all { margin-bottom: 28px; }
  .path-card h2, .apply-all h2 {
    font-size: 14px; color: #fff; margin-bottom: 12px; letter-spacing: 0.01em; font-weight: 600;
  }
  .path-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--accent);
    background: rgba(0,0,0,0.25);
    border: 1px solid rgba(94,234,212,0.2);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 14px;
    word-break: break-all;
  }

  .phase-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; position: relative; }
  .phase-chip {
    display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 999px;
    padding: 7px 14px;
    cursor: pointer; user-select: none; font-size: 12px;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    transition: transform 0.15s ease, border-color 0.2s ease, background 0.2s ease;
  }
  .phase-chip:hover { transform: translateY(-1px); border-color: rgba(94,234,212,0.4); }
  .phase-chip.selected {
    background: linear-gradient(135deg, rgba(94,234,212,0.22), rgba(45,212,191,0.22));
    border-color: rgba(94,234,212,0.5);
    box-shadow: 0 0 18px rgba(94,234,212,0.2);
  }
  .phase-chip .check {
    width: 16px; height: 16px; border-radius: 5px;
    border: 1.5px solid rgba(255,255,255,0.28);
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: transparent; transition: all 0.15s;
  }
  .phase-chip.selected .check {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    border-color: transparent; color: #0b0b12;
  }
  .agent { color: var(--text-muted); font-size: 10px; letter-spacing: 0.05em; }

  .btn {
    padding: 8px 18px; border-radius: 999px; border: 1px solid transparent;
    cursor: pointer; font-size: 12px; font-weight: 700;
    letter-spacing: 0.01em;
    transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #0b0b12;
    box-shadow: 0 8px 24px -8px rgba(94,234,212,0.55), inset 0 1px 0 rgba(255,255,255,0.4);
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 12px 30px -8px rgba(45,212,191,0.65), inset 0 1px 0 rgba(255,255,255,0.5); }
  .btn-secondary {
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.14);
    color: var(--text);
  }
  .btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: rgba(94,234,212,0.35); }
  .btn-row { display: flex; gap: 10px; flex-wrap: wrap; position: relative; }

  .epic-card { margin-bottom: 12px; }
  .epic-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 20px; cursor: pointer; user-select: none;
    transition: background 0.2s ease;
  }
  .epic-header:hover { background: var(--hover); }
  .epic-key {
    font-weight: 700; font-size: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .epic-title-text { color: var(--text-muted); font-size: 12px; margin-left: 10px; }
  .epic-badge {
    font-size: 11px; color: var(--text);
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    padding: 3px 10px; border-radius: 999px;
    backdrop-filter: blur(10px);
  }
  .epic-body { padding: 0 20px 20px; display: none; position: relative; }
  .epic-body.open { display: block; }

  .phase-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .phase-row:last-child { border-bottom: none; }
  .phase-row label { display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1; font-size: 13px; }
  .phase-row input[type="checkbox"] {
    width: 16px; height: 16px;
    accent-color: #5eead4; cursor: pointer;
  }
  .phase-name { font-weight: 600; color: #fff; min-width: 94px; }
  .phase-agent { color: var(--text-muted); font-size: 11px; }
  .phase-emoji {
    background: linear-gradient(135deg, rgba(94,234,212,0.22), rgba(45,212,191,0.22));
    border: 1px solid rgba(94,234,212,0.3);
    border-radius: 6px; padding: 2px 8px;
    font-size: 10px; font-weight: 700;
    color: #e9f6ff;
  }
  .save-btn-row { margin-top: 14px; display: flex; justify-content: flex-end; position: relative; }

  .hint { color: var(--text-muted); font-size: 12px; margin-bottom: 10px; line-height: 1.55; position: relative; }
  .hint code {
    background: rgba(0,0,0,0.25);
    border: 1px solid rgba(94,234,212,0.22);
    border-radius: 6px; padding: 1px 7px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
    color: var(--accent);
  }
  .field-label {
    display: block; font-size: 11px; font-weight: 700; color: var(--text);
    margin: 6px 0 8px; text-transform: uppercase; letter-spacing: 0.08em;
    position: relative;
  }
  .field-input {
    width: 100%;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 12px;
    padding: 10px 14px;
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    position: relative;
  }
  .field-input:focus {
    border-color: rgba(94,234,212,0.55);
    box-shadow: 0 0 0 4px rgba(94,234,212,0.12);
  }
  .preset-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; position: relative; }
  .preset-chip {
    background: rgba(255,255,255,0.05);
    color: var(--text);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 11px; cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    backdrop-filter: blur(12px);
    transition: all 0.15s;
  }
  .preset-chip:hover { border-color: rgba(94,234,212,0.5); color: var(--accent); transform: translateY(-1px); }
  .platform-row { display: flex; flex-wrap: wrap; gap: 10px; position: relative; }
  .platform-opt {
    display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    padding: 7px 14px;
    cursor: pointer; font-size: 12px; user-select: none;
    backdrop-filter: blur(12px);
    transition: all 0.15s;
  }
  .platform-opt:hover { border-color: rgba(94,234,212,0.45); transform: translateY(-1px); }
  .platform-opt input[type="radio"] { accent-color: #5eead4; cursor: pointer; }
  .platform-opt:has(input[type="radio"]:checked) {
    background: linear-gradient(135deg, rgba(94,234,212,0.22), rgba(45,212,191,0.22));
    border-color: rgba(94,234,212,0.5);
    box-shadow: 0 0 18px rgba(94,234,212,0.2);
  }
  .platform-opt input[type="radio"]:checked + span {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    font-weight: 700;
  }
</style>
</head>
<body>
<h1>Pipeline Settings</h1>
<p class="subtitle">Configure the SDLC MCP server and which phases each epic needs to go through</p>

<div class="section-header">Environment</div>

<div class="path-card">
  <h2>MCP Pipeline Source</h2>
  <p class="hint">Which pipeline package Claude Code loads. Use <code>github:owner/repo</code> for a custom fork (e.g. <code>github:hueanmy/aidlc-pipeline</code>) or an npm package name once published.</p>
  <label class="field-label">Package spec</label>
  <input type="text" class="field-input" id="mcpPackageInput" placeholder="e.g. github:hueanmy/aidlc-pipeline" />
  <label class="field-label" style="margin-top: 14px;">Platform</label>
  <div class="platform-row" id="platformRow">
    <label class="platform-opt"><input type="radio" name="platform" value="mobile" /><span>mobile</span></label>
    <label class="platform-opt"><input type="radio" name="platform" value="web" /><span>web</span></label>
    <label class="platform-opt"><input type="radio" name="platform" value="backend" /><span>backend</span></label>
    <label class="platform-opt"><input type="radio" name="platform" value="desktop" /><span>desktop</span></label>
    <label class="platform-opt"><input type="radio" name="platform" value="generic" /><span>generic</span></label>
  </div>
  <div class="hint" id="mcpCurrent" style="margin-top: 10px;"></div>
  <div class="btn-row" style="margin-top: 14px;">
    <button class="btn btn-primary" onclick="saveMcp()">Apply &amp; Reload MCP</button>
    <button class="btn btn-secondary" onclick="resetMcp()">Clear &amp; Disable Auto-Configure</button>
  </div>
</div>

<div class="path-card">
  <h2>Example Project</h2>
  <p class="hint">New to AIDLC? Generate a fully-bootstrapped example workspace (sample epic, sample core-business / ITS docs, plus auto-synced agents / skills / schemas from the MCP package). It opens in a separate folder so it never touches your real codebase. You can clear it any time and re-create it later.</p>
  <div class="btn-row">
    <button class="btn btn-primary" onclick="loadExampleProject()">Load Example Project</button>
    <button class="btn btn-secondary" onclick="clearExampleProject()">Clear Example Project</button>
  </div>
</div>

<div class="path-card">
  <h2>Epics Folder</h2>
  <div class="path-value" id="epicsPath"></div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="selectFolder()">Change Folder</button>
  </div>
</div>

<div class="section-header">Pipeline Phases</div>

<div class="apply-all">
  <h2>Apply to All Epics</h2>
  <div class="phase-grid" id="globalPhases"></div>
  <div class="btn-row">
    <button class="btn btn-primary" onclick="applyAll()">Apply to All</button>
    <button class="btn btn-secondary" onclick="selectAllGlobal()">Select All</button>
    <button class="btn btn-secondary" onclick="deselectAllGlobal()">Deselect All</button>
  </div>
</div>

<div id="epicsList"></div>

<script>
  const vscode = acquireVsCodeApi();
  const ALL_PHASES = ${phasesJson};
  const configs = ${configsJson};
  const epicMeta = ${epicsJson};
  const epicsPath = ${epicsPathJson};
  const mcp = ${mcpJson};

  function renderEpicsPath() {
    document.getElementById('epicsPath').textContent = epicsPath;
  }

  function selectFolder() {
    vscode.postMessage({ type: 'selectFolder' });
  }

  function renderGlobalPhases() {
    const el = document.getElementById('globalPhases');
    el.innerHTML = ALL_PHASES.map(function(p) {
      return '<div class="phase-chip selected" data-id="' + p.id + '" onclick="toggleGlobalChip(this)">'
        + '<div class="check">\\u2713</div>'
        + '<span>' + p.name + '</span>'
        + '<span class="agent">' + p.emoji + '</span>'
        + '</div>';
    }).join('');
  }

  function toggleGlobalChip(el) { el.classList.toggle('selected'); }
  function getGlobalSelected() {
    return Array.from(document.querySelectorAll('#globalPhases .phase-chip.selected')).map(function(el) { return el.dataset.id; });
  }
  function selectAllGlobal() { document.querySelectorAll('#globalPhases .phase-chip').forEach(function(el) { el.classList.add('selected'); }); }
  function deselectAllGlobal() { document.querySelectorAll('#globalPhases .phase-chip').forEach(function(el) { el.classList.remove('selected'); }); }

  function applyAll() {
    var phases = getGlobalSelected();
    if (phases.length === 0) return;
    vscode.postMessage({ type: 'saveAll', phases: phases });
  }

  function renderEpics() {
    var container = document.getElementById('epicsList');
    container.innerHTML = configs.map(function(cfg, i) {
      var rows = ALL_PHASES.map(function(p) {
        var checked = cfg.enabledPhases.indexOf(p.id) >= 0 ? 'checked' : '';
        return '<div class="phase-row"><label>'
          + '<input type="checkbox" ' + checked + ' data-epic="' + i + '" data-phase="' + p.id + '" onchange="markDirty(' + i + ')">'
          + '<span class="phase-emoji">' + p.emoji + '</span>'
          + '<span class="phase-name">' + p.name + '</span>'
          + '<span class="phase-agent">' + p.agent + '</span>'
          + '</label></div>';
      }).join('');

      var titlePart = cfg.title !== cfg.key ? cfg.title : '';
      return '<div class="epic-card">'
        + '<div class="epic-header" onclick="toggleEpic(' + i + ')">'
        + '<div><span class="epic-key">' + cfg.key + '</span><span class="epic-title-text">' + titlePart + '</span></div>'
        + '<span class="epic-badge">' + cfg.enabledPhases.length + '/' + ALL_PHASES.length + ' phases</span>'
        + '</div>'
        + '<div class="epic-body" id="epicBody' + i + '">' + rows
        + '<div class="save-btn-row"><button class="btn btn-primary" id="saveBtn' + i + '" onclick="saveEpic(' + i + ')">Save</button></div>'
        + '</div></div>';
    }).join('');
  }

  function toggleEpic(i) { document.getElementById('epicBody' + i).classList.toggle('open'); }

  function markDirty(i) {
    var btn = document.getElementById('saveBtn' + i);
    btn.textContent = 'Save \\u25cf';
    btn.style.background = '#ff9800';
  }

  function saveEpic(i) {
    var cbs = document.querySelectorAll('input[data-epic="' + i + '"]');
    var phases = [];
    cbs.forEach(function(cb) { if (cb.checked) phases.push(cb.dataset.phase); });
    if (phases.length === 0) return;
    vscode.postMessage({ type: 'save', epicKey: configs[i].key, epicDir: epicMeta[i].folderPath, phases: phases });
    configs[i].enabledPhases = phases;
    var btn = document.getElementById('saveBtn' + i);
    btn.textContent = 'Saved \\u2713';
    btn.style.background = '#4caf50';
    setTimeout(function() { btn.textContent = 'Save'; btn.style.background = ''; }, 1500);
  }

  function renderMcp() {
    document.getElementById('mcpPackageInput').value = mcp.mcpPackage || '';
    const radios = document.querySelectorAll('input[name="platform"]');
    radios.forEach(function(r) { r.checked = r.value === (mcp.platform || 'generic'); });
    const pkg = (mcp.mcpPackage || '').trim();
    document.getElementById('mcpCurrent').innerHTML = pkg
      ? 'Currently active: <code>' + (mcp.mcpCommand || 'npx') + ' -y ' + escapeHtml(pkg) + '</code>' +
        ' · server key <code>' + escapeHtml(mcp.mcpServerName) + '</code>'
      : 'No MCP package configured — extension will not install anything until you set one.';
    document.querySelectorAll('.preset-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        document.getElementById('mcpPackageInput').value = chip.dataset.value;
      });
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>\"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function saveMcp() {
    var pkg = document.getElementById('mcpPackageInput').value.trim();
    var platform = (document.querySelector('input[name="platform"]:checked') || {}).value || 'generic';
    if (!pkg) return;
    vscode.postMessage({ type: 'saveMcp', mcpPackage: pkg, platform: platform });
  }

  function resetMcp() {
    if (!confirm('Clear MCP package and disable auto-configure? Extension will not install any MCP until you set one explicitly.')) return;
    vscode.postMessage({ type: 'resetMcp' });
  }

  function loadExampleProject() {
    vscode.postMessage({ type: 'loadExampleProject' });
  }

  function clearExampleProject() {
    vscode.postMessage({ type: 'clearExampleProject' });
  }

  renderEpicsPath();
  renderGlobalPhases();
  renderEpics();
  renderMcp();
</script>
</body>
</html>`;
  }
}
