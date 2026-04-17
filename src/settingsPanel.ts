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
  { id: 'uat', name: 'UAT', agent: 'QA Engineer', emoji: 'QA' },
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
      mcpPackage: cfg.get<string>('mcpPackage', 'github:hueanmy/aidlc-pipeline'),
      platform: cfg.get<string>('platform', 'mobile'),
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
  }) {
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
      await this.handleSaveMcp('github:hueanmy/aidlc-pipeline', 'mobile');
    }
  }

  private async handleSaveMcp(mcpPackage: string | undefined, platform: string | undefined): Promise<void> {
    const pkg = (mcpPackage ?? '').trim();
    if (!pkg) {
      vscode.window.showErrorMessage('MCP package cannot be empty');
      return;
    }
    const plat = (platform ?? 'mobile').trim() || 'mobile';

    const cfg = vscode.workspace.getConfiguration('cfPipeline');
    const target = vscode.workspace.workspaceFolders?.[0]?.uri
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await cfg.update('mcpPackage', pkg, target);
    await cfg.update('platform', plat, target);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const { ensureMcpConfig } = await import('./mcpConfigurator');
      ensureMcpConfig(workspaceRoot, () => { /* silent from UI */ }, true);
      vscode.window.showInformationMessage(
        `MCP updated: ${pkg} (platform: ${plat}). Reload Claude Code for changes to take effect.`,
      );
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
    --bg: #1e1e1e; --card-bg: #252526; --border: #333;
    --text: #ccc; --text-muted: #888; --accent: #4fc3f7;
    --done: #4caf50; --progress: #ff9800; --hover: #2a2d2e;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 4px; }
  .subtitle { color: var(--text-muted); font-size: 13px; margin-bottom: 24px; }

  .path-card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px; margin-bottom: 16px;
  }
  .path-card h2 { font-size: 14px; color: #fff; margin-bottom: 8px; }
  .path-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: var(--accent); background: #1b1b1c;
    border: 1px solid #2f2f31; border-radius: 6px; padding: 10px 12px;
    margin-bottom: 12px; word-break: break-all;
  }

  .apply-all {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;
  }
  .apply-all h2 { font-size: 14px; color: #fff; margin-bottom: 12px; }
  .phase-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .phase-chip {
    display: flex; align-items: center; gap: 6px;
    background: #333; border-radius: 6px; padding: 6px 12px;
    cursor: pointer; user-select: none; font-size: 12px;
    border: 1px solid transparent; transition: all 0.15s;
  }
  .phase-chip:hover { border-color: var(--accent); }
  .phase-chip.selected { background: #1a3a4a; border-color: var(--accent); }
  .phase-chip .check {
    width: 16px; height: 16px; border-radius: 4px; border: 2px solid #555;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #fff; transition: all 0.15s;
  }
  .phase-chip.selected .check { background: var(--accent); border-color: var(--accent); }
  .agent { color: var(--text-muted); font-size: 10px; }

  .btn { padding: 6px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.15s; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-primary:hover { opacity: 0.85; }
  .btn-secondary { background: #333; color: var(--text); }
  .btn-secondary:hover { background: #444; }
  .btn-row { display: flex; gap: 8px; }

  .epic-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .epic-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; user-select: none; }
  .epic-header:hover { background: var(--hover); }
  .epic-key { color: var(--accent); font-weight: 700; font-size: 14px; }
  .epic-title-text { color: var(--text-muted); font-size: 12px; margin-left: 8px; }
  .epic-badge { font-size: 11px; color: var(--text-muted); background: #333; padding: 2px 8px; border-radius: 10px; }
  .epic-body { padding: 0 16px 16px; display: none; }
  .epic-body.open { display: block; }

  .phase-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #2a2a2a; }
  .phase-row:last-child { border-bottom: none; }
  .phase-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; font-size: 13px; }
  .phase-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  .phase-name { font-weight: 600; color: #fff; min-width: 90px; }
  .phase-agent { color: var(--text-muted); font-size: 11px; }
  .phase-emoji { background: #333; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 700; color: var(--accent); }
  .save-btn-row { margin-top: 12px; display: flex; justify-content: flex-end; }

  .hint { color: var(--text-muted); font-size: 12px; margin-bottom: 10px; line-height: 1.5; }
  .hint code { background: #1b1b1c; border: 1px solid #2f2f31; border-radius: 4px; padding: 1px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--accent); }
  .field-label { display: block; font-size: 12px; font-weight: 600; color: #fff; margin: 4px 0 6px; }
  .field-input {
    width: 100%; background: #1b1b1c; border: 1px solid #2f2f31; border-radius: 6px;
    padding: 8px 10px; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; outline: none;
  }
  .field-input:focus { border-color: var(--accent); }
  .preset-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .preset-chip {
    background: #2a2a2a; color: var(--text); border: 1px solid transparent;
    border-radius: 12px; padding: 4px 10px; font-size: 11px; cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; transition: all 0.15s;
  }
  .preset-chip:hover { border-color: var(--accent); color: var(--accent); }
  .platform-row { display: flex; flex-wrap: wrap; gap: 10px; }
  .platform-opt {
    display: flex; align-items: center; gap: 6px; background: #2a2a2a;
    border: 1px solid transparent; border-radius: 6px; padding: 6px 12px;
    cursor: pointer; font-size: 12px; user-select: none;
  }
  .platform-opt:hover { border-color: var(--accent); }
  .platform-opt input[type="radio"] { accent-color: var(--accent); cursor: pointer; }
  .platform-opt input[type="radio"]:checked + span { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<h1>Pipeline Settings</h1>
<p class="subtitle">Configure the SDLC MCP server and which phases each epic needs to go through</p>

<div class="path-card">
  <h2>MCP Pipeline Source</h2>
  <p class="hint">Which pipeline package Claude Code loads. Use <code>github:owner/repo</code> for a custom fork (e.g. <code>github:yourcompany/cf-sdlc-pipeline</code>) or an npm package name once published.</p>
  <label class="field-label">Package spec</label>
  <input type="text" class="field-input" id="mcpPackageInput" placeholder="github:hueanmy/aidlc-pipeline" />
  <div class="preset-row" id="mcpPresets">
    <button type="button" class="preset-chip" data-value="github:hueanmy/aidlc-pipeline">aidlc-pipeline (default)</button>
  </div>
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
    <button class="btn btn-secondary" onclick="resetMcp()">Reset to Default</button>
  </div>
</div>

<div class="path-card">
  <h2>Epics Folder</h2>
  <div class="path-value" id="epicsPath"></div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="selectFolder()">Change Folder</button>
  </div>
</div>

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
    radios.forEach(function(r) { r.checked = r.value === (mcp.platform || 'mobile'); });
    document.getElementById('mcpCurrent').innerHTML =
      'Currently active: <code>' + (mcp.mcpCommand || 'npx') + ' -y ' + escapeHtml(mcp.mcpPackage) + '</code>' +
      ' · server key <code>' + escapeHtml(mcp.mcpServerName) + '</code>';
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
    var platform = (document.querySelector('input[name="platform"]:checked') || {}).value || 'mobile';
    if (!pkg) return;
    vscode.postMessage({ type: 'saveMcp', mcpPackage: pkg, platform: platform });
  }

  function resetMcp() {
    if (!confirm('Reset MCP package and platform to default (aidlc-pipeline, mobile)?')) return;
    vscode.postMessage({ type: 'resetMcp' });
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
