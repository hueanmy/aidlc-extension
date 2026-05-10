/**
 * AST Graph report panel — opens when the user clicks the status bar
 * `$(type-hierarchy) AST` item. Scope is intentionally small: it shows
 * the structural snapshot (files / nodes / edges / kinds), the top
 * hotspots, any extracted HTTP routes, and the buttons that drive the
 * rest of the integration (Rescan, Re-register MCP, Reveal db).
 *
 * Full graph visualization (D3 / Cytoscape) is left for a v2 — see
 * mention in the integration plan.
 */

import * as vscode from 'vscode';
import * as path from 'path';

import { lookupSymbol, runReadCommand, type ScanSummary, type SymbolDetail } from './scanner';
import { themeManager } from '../themeManager';

export interface AstGraphRuntime {
  /** Resolved on activation — may be null while the binary is still downloading. */
  binPath: () => string | null;
  /** Latest scan summary, or null if no scan has finished yet. */
  lastScan: () => ScanSummary | null;
  /** Whether a scan is currently in flight. */
  isScanning: () => boolean;
  /** Whether the MCP server registration succeeded for this session. */
  mcpStatus: () => { ok: boolean; reason: string };
  /** Active workspace folder we attribute the graph to. */
  primaryFolder: () => vscode.WorkspaceFolder | undefined;
  /** Trigger an immediate full rescan. Returns when scan finishes (or fails). */
  rescan(clean: boolean): Promise<void>;
  /** Try to re-register the MCP server. */
  reregisterMcp(): Promise<void>;
}

interface PanelState {
  scan: ScanSummary | null;
  scanning: boolean;
  mcp: { ok: boolean; reason: string };
  binReady: boolean;
  hotspots: HotspotRow[];
  routes: RouteRow[];
  stats: KindCount[];
  error: string | null;
  workspaceName: string | null;
}

interface HotspotRow { name: string; kind: string; out: number; inc: number; total: number; }
interface RouteRow { line: string; }
interface KindCount { kind: string; count: number; }

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const TRACE_LINE_RE = /^\d{4}-\d{2}-\d{2}T.*?(INFO|WARN|ERROR|DEBUG)/;

function stripNoise(text: string): string {
  return text
    .replace(ANSI_RE, '')
    .split(/\r?\n/)
    .filter((l) => !TRACE_LINE_RE.test(l))
    .join('\n');
}

export class AstGraphReportWebview {
  public static readonly viewType = 'aidlcAstGraphReport';
  private static current: AstGraphReportWebview | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private loading = false;

  static show(runtime: AstGraphRuntime): void {
    if (AstGraphReportWebview.current) {
      AstGraphReportWebview.current.panel.reveal(vscode.ViewColumn.Active);
      void AstGraphReportWebview.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      AstGraphReportWebview.viewType,
      'AST Graph',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    AstGraphReportWebview.current = new AstGraphReportWebview(panel, runtime);
  }

  /** Called by the orchestrator after each successful scan / mcp update. */
  static notifyUpdate(): void {
    if (AstGraphReportWebview.current) {
      void AstGraphReportWebview.current.refresh();
    }
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly runtime: AstGraphRuntime,
  ) {
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handle(msg),
      null,
      this.disposables,
    );
    // Mirror the AIDLC theme override into this webview so the user's
    // auto/light/dark toggle (driven from other AIDLC views) reaches us.
    this.disposables.push(themeManager.register(this.panel.webview));
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const state = await this.collect();
    this.loading = false;
    void this.panel.webview.postMessage({ type: 'state', state });
  }

  private async collect(): Promise<PanelState> {
    const folder = this.runtime.primaryFolder();
    const scan = this.runtime.lastScan();
    const bin = this.runtime.binPath();
    const state: PanelState = {
      scan,
      scanning: this.runtime.isScanning(),
      mcp: this.runtime.mcpStatus(),
      binReady: !!bin,
      hotspots: [],
      routes: [],
      stats: [],
      error: null,
      workspaceName: folder?.name ?? null,
    };

    if (!bin || !scan || !folder) return state;

    try {
      const [hot, routes, stats] = await Promise.all([
        runReadCommand(bin, scan.dbPath, ['hotspots', '--limit', '20'], folder.uri.fsPath).catch(() => ''),
        runReadCommand(bin, scan.dbPath, ['routes'], folder.uri.fsPath).catch(() => ''),
        runReadCommand(bin, scan.dbPath, ['stats'], folder.uri.fsPath).catch(() => ''),
      ]);
      state.hotspots = parseHotspots(hot);
      state.routes = parseRoutes(routes);
      state.stats = parseStatsKinds(stats);
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    return state;
  }

  private async handle(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        void this.refresh();
        return;
      case 'setTheme': {
        const mode = String(msg.mode ?? '');
        if (mode === 'auto' || mode === 'light' || mode === 'dark') {
          await themeManager.set(mode);
        }
        return;
      }
      case 'rescan':
        await this.runtime.rescan(true);
        void this.refresh();
        return;
      case 'reregisterMcp':
        await this.runtime.reregisterMcp();
        void this.refresh();
        return;
      case 'revealDb': {
        const scan = this.runtime.lastScan();
        if (scan) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(scan.dbPath));
        }
        return;
      }
      case 'lookupSymbol': {
        const name = String(msg.name ?? '').trim();
        const requestId = msg.requestId;
        if (!name) {
          void this.panel.webview.postMessage({ type: 'symbol', requestId, ok: false, error: 'empty name' });
          return;
        }
        const bin = this.runtime.binPath();
        const scan = this.runtime.lastScan();
        const folder = this.runtime.primaryFolder();
        if (!bin || !scan || !folder) {
          void this.panel.webview.postMessage({ type: 'symbol', requestId, ok: false, error: 'graph not ready' });
          return;
        }
        try {
          const detail: SymbolDetail | null = await lookupSymbol(bin, scan.dbPath, name, folder.uri.fsPath);
          void this.panel.webview.postMessage({ type: 'symbol', requestId, ok: true, detail });
        } catch (err) {
          void this.panel.webview.postMessage({
            type: 'symbol', requestId, ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'openFile': {
        const file = String(msg.file ?? '');
        const folder = this.runtime.primaryFolder();
        if (!file || !folder) return;
        const abs = path.isAbsolute(file) ? file : path.join(folder.uri.fsPath, file);
        const uri = vscode.Uri.file(abs);
        const line = Number(msg.line ?? 0);
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const pos = line > 0 ? new vscode.Position(line - 1, 0) : new vscode.Position(0, 0);
          await vscode.window.showTextDocument(doc, {
            preview: true,
            selection: new vscode.Range(pos, pos),
          });
        } catch (err) {
          void vscode.window.showWarningMessage(`Could not open ${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
    }
  }

  private dispose(): void {
    AstGraphReportWebview.current = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private html(): string {
    const nonce = makeNonce();
    const initialTheme = themeManager.current;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>AST Graph</title>
<style>
  /*
   * Theme palette
   * ─────────────
   * Auto mode (default): every --ast-* token falls through to a
   *   --vscode-* variable so we inherit whatever VS Code currently shows.
   * Forced light/dark (data-theme attribute set by JS): the tokens flip
   *   to a hardcoded palette so AIDLC's theme toggle wins over VS Code.
   * Only the *neutral* surface colours are forced; semantic accents
   *   (charts, symbolIcon-*) keep using VS Code's variables since they
   *   already contrast well in both themes.
   */
  :root {
    --gap: 14px;
    --radius: 6px;
    --mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);

    --ast-bg:           var(--vscode-editor-background);
    --ast-fg:           var(--vscode-foreground);
    --ast-muted:        var(--vscode-descriptionForeground);
    --ast-surface:      var(--vscode-editorWidget-background, rgba(127,127,127,.06));
    --ast-border:       var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(127,127,127,.25)));
    --ast-input-bg:     var(--vscode-input-background, var(--ast-surface));
    --ast-input-fg:     var(--vscode-input-foreground, var(--ast-fg));
    --ast-input-border: var(--vscode-input-border, var(--ast-border));
    --ast-hover:        var(--vscode-list-hoverBackground, rgba(127,127,127,.08));
    --ast-selection:    var(--vscode-list-activeSelectionBackground, var(--vscode-charts-blue, #4a90e2));
    --ast-code-bg:      var(--vscode-textCodeBlock-background, rgba(127,127,127,.12));
    --ast-link:         var(--vscode-textLink-foreground, var(--vscode-charts-blue, #4a90e2));
    --ast-focus:        var(--vscode-focusBorder, var(--vscode-charts-blue, #4a90e2));

    /* Local aliases kept for the rest of the stylesheet */
    --border: var(--ast-border);
    --muted: var(--ast-muted);
    --surface: var(--ast-surface);
  }

  /* Forced dark — overrides regardless of VS Code's own theme. */
  :root[data-theme="dark"] {
    --ast-bg:           #1e1e1e;
    --ast-fg:           #d4d4d4;
    --ast-muted:        #9b9b9b;
    --ast-surface:      #252526;
    --ast-border:       #3c3c3c;
    --ast-input-bg:     #2d2d2d;
    --ast-input-fg:     #d4d4d4;
    --ast-input-border: #3c3c3c;
    --ast-hover:        rgba(255,255,255,0.05);
    --ast-selection:    rgba(74,144,226,0.22);
    --ast-code-bg:      rgba(255,255,255,0.06);
  }
  /* Forced light. */
  :root[data-theme="light"] {
    --ast-bg:           #ffffff;
    --ast-fg:           #1f1f1f;
    --ast-muted:        #6a6a6a;
    --ast-surface:      #f6f6f6;
    --ast-border:       #e0e0e0;
    --ast-input-bg:     #ffffff;
    --ast-input-fg:     #1f1f1f;
    --ast-input-border: #d4d4d4;
    --ast-hover:        rgba(0,0,0,0.04);
    --ast-selection:    rgba(74,144,226,0.16);
    --ast-code-bg:      rgba(0,0,0,0.05);
  }

  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--ast-fg);
    background: var(--ast-bg);
    padding: 18px 22px 40px;
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
  }

  /* Header */
  .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .head h1 { font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .head .meta { color: var(--muted); font-size: 12px; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 18px; }

  /* Status pills — outline-only, only fill on warn/err */
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 9px; border-radius: 999px; font-size: 11px;
    line-height: 18px;
    border: 1px solid var(--border);
    color: var(--muted);
    background: transparent;
  }
  .pill .dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; opacity: 0.9; }
  .pill.ok    { color: var(--vscode-charts-green, #2ea043); border-color: color-mix(in srgb, var(--vscode-charts-green, #2ea043) 40%, transparent); }
  .pill.warn  { color: var(--vscode-charts-yellow, #d29922); border-color: color-mix(in srgb, var(--vscode-charts-yellow, #d29922) 40%, transparent); }
  .pill.err   { color: var(--vscode-charts-red, #cf222e); border-color: color-mix(in srgb, var(--vscode-charts-red, #cf222e) 40%, transparent); }

  /* KPI strip — single card with vertical separators, tighter */
  .kpi {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    margin-bottom: var(--gap);
  }
  .kpi .cell { padding: 10px 14px; border-right: 1px solid var(--border); }
  .kpi .cell:last-child { border-right: none; }
  .kpi .label { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; }
  .kpi .value { font-size: 19px; font-weight: 600; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .kpi .value .sub { font-size: 12px; font-weight: 500; color: var(--muted); margin-left: 4px; }

  /* Toolbar */
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
    font-family: inherit;
  }
  button:hover:not([disabled]) { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: transparent;
    color: var(--ast-fg);
    border: 1px solid var(--border);
  }
  button.secondary:hover:not([disabled]) { background: var(--surface); }
  button[disabled] { opacity: 0.5; cursor: default; }

  /* Sections */
  section { margin-top: 22px; }
  section .section-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; }
  section h2 { font-size: 13px; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
  section .section-head .count { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  section .section-head input.filter {
    margin-left: auto;
    background: var(--ast-input-bg);
    color: var(--ast-input-fg);
    border: 1px solid var(--ast-input-border);
    border-radius: 4px; padding: 3px 8px; font-size: 12px; min-width: 180px;
    font-family: inherit;
  }
  section .section-head input.filter:focus { outline: 1px solid var(--ast-focus); outline-offset: -1px; }

  /* Hotspots table */
  table.hot { border-collapse: collapse; width: 100%; table-layout: fixed; }
  table.hot th, table.hot td { padding: 5px 8px; font-size: 12px; vertical-align: middle; }
  table.hot th {
    text-align: left; font-weight: 500;
    color: var(--muted); border-bottom: 1px solid var(--border);
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  table.hot tr + tr td { border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
  table.hot td.name { font-family: var(--mono); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.hot td.num { text-align: right; font-variant-numeric: tabular-nums; width: 56px; }
  table.hot td.kind-cell { width: 110px; }
  table.hot td.bar-cell { width: 110px; }
  table.hot col.name { width: auto; }

  /* Kind badge — color-coded subtle */
  .kind {
    display: inline-block; padding: 1px 7px; border-radius: 3px;
    font-size: 11px; line-height: 16px;
    background: var(--kind-bg, color-mix(in srgb, var(--muted) 15%, transparent));
    color: var(--kind-fg, var(--ast-fg));
    border: 1px solid color-mix(in srgb, var(--kind-fg, var(--muted)) 30%, transparent);
  }
  .kind[data-kind="Method"]      { --kind-fg: var(--vscode-symbolIcon-methodForeground, #6cb6ff); }
  .kind[data-kind="Constructor"] { --kind-fg: var(--vscode-symbolIcon-constructorForeground, #b083f0); }
  .kind[data-kind="Function"]    { --kind-fg: var(--vscode-symbolIcon-functionForeground, #6cb6ff); }
  .kind[data-kind="Class"]       { --kind-fg: var(--vscode-symbolIcon-classForeground, #f69d50); }
  .kind[data-kind="Interface"]   { --kind-fg: var(--vscode-symbolIcon-interfaceForeground, #8ddb8c); }
  .kind[data-kind="Property"]    { --kind-fg: var(--vscode-symbolIcon-propertyForeground, #d29922); }
  .kind[data-kind="Constant"]    { --kind-fg: var(--vscode-symbolIcon-constantForeground, #f69d50); }
  .kind[data-kind="TypeAlias"]   { --kind-fg: var(--vscode-symbolIcon-typeParameterForeground, #f47067); }
  .kind[data-kind="Import"]      { --kind-fg: var(--muted); }
  .kind[data-kind="File"]        { --kind-fg: var(--muted); }

  /* Mini bar visual — In + Out stacked */
  .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--muted) 12%, transparent); }
  .bar > span { display: block; height: 100%; }
  .bar > span.in  { background: color-mix(in srgb, var(--vscode-charts-blue, #4a90e2) 80%, transparent); }
  .bar > span.out { background: color-mix(in srgb, var(--vscode-charts-purple, #b083f0) 80%, transparent); }

  /* Kinds chips section */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: baseline; gap: 6px;
    padding: 3px 8px; border-radius: 4px; font-size: 11.5px;
    background: var(--surface); border: 1px solid var(--border);
  }
  .chip .name { font-weight: 500; }
  .chip .n { color: var(--muted); font-variant-numeric: tabular-nums; }

  .empty { color: var(--muted); font-style: italic; padding: 8px 0; font-size: 12.5px; }
  .legend { display: inline-flex; gap: 10px; font-size: 11px; color: var(--muted); align-items: center; }
  .legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 4px; }
  .swatch.in  { background: var(--vscode-charts-blue, #4a90e2); }
  .swatch.out { background: var(--vscode-charts-purple, #b083f0); }

  /* Hotspot rows clickable */
  table.hot tbody tr { cursor: pointer; }
  table.hot tbody tr:hover { background: var(--ast-hover); }
  table.hot tbody tr.selected { background: color-mix(in srgb, var(--ast-selection) 35%, transparent); }

  /* Symbol detail tree */
  .symbol-detail {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); padding: 12px 14px; margin-top: 12px;
  }
  .symbol-detail.loading { opacity: 0.6; }
  .symbol-detail .header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .symbol-detail .header .sym-name { font-family: var(--mono); font-size: 13.5px; font-weight: 600; }
  .symbol-detail .header .sym-loc { color: var(--muted); font-size: 11.5px; font-family: var(--mono); cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
  .symbol-detail .header .sym-loc:hover { color: var(--ast-link); }
  .symbol-detail .sig {
    margin-top: 6px; padding: 6px 8px; border-radius: 4px;
    background: var(--ast-code-bg);
    font-family: var(--mono); font-size: 12px;
    white-space: pre-wrap; word-break: break-word;
  }
  .symbol-detail .tree { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .symbol-detail .tree-col h3 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--muted); font-weight: 600; margin: 0 0 6px;
  }
  .symbol-detail .tree-col ul {
    list-style: none; margin: 0; padding: 0;
    border-left: 1px solid var(--border);
    max-height: 360px; overflow-y: auto;
  }
  .symbol-detail .tree-col li {
    position: relative;
    padding: 3px 8px 3px 18px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    cursor: pointer;
    display: flex; align-items: baseline; gap: 8px;
    font-size: 12px;
  }
  .symbol-detail .tree-col li:hover { background: var(--ast-hover); }
  .symbol-detail .tree-col li:last-child { border-bottom: none; }
  .symbol-detail .tree-col li::before {
    content: ''; position: absolute; left: 0; top: 50%;
    width: 10px; height: 1px;
    background: var(--border);
  }
  .symbol-detail .tree-col .ref-name {
    font-family: var(--mono); flex: 1 1 auto;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .symbol-detail .tree-col .ref-loc {
    color: var(--muted); font-family: var(--mono); font-size: 11px;
    white-space: nowrap;
  }
  .symbol-detail .arrow { color: var(--muted); font-family: var(--mono); flex: 0 0 auto; }
  .symbol-detail .arrow.in { color: var(--vscode-charts-blue, #4a90e2); }
  .symbol-detail .arrow.out { color: var(--vscode-charts-purple, #b083f0); }

  .symbol-detail .close {
    margin-left: auto; background: transparent; border: 1px solid var(--border);
    color: var(--muted); padding: 2px 8px; border-radius: 3px; font-size: 11px; cursor: pointer;
  }
  .symbol-detail .close:hover { background: var(--surface); color: var(--ast-fg); }
  .symbol-detail .err { color: var(--vscode-charts-red, #cf222e); font-size: 12px; }

  /* Theme toggle segmented control */
  .theme-toggle {
    margin-left: auto;
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    font-size: 11px;
  }
  .theme-toggle button {
    background: transparent;
    color: var(--muted);
    border: none;
    padding: 3px 10px;
    cursor: pointer;
    font-family: inherit;
    border-radius: 0;
  }
  .theme-toggle button:hover { background: var(--ast-hover); color: var(--ast-fg); }
  .theme-toggle button[aria-pressed="true"] {
    background: color-mix(in srgb, var(--ast-selection) 40%, transparent);
    color: var(--ast-fg);
  }

  @media (max-width: 720px) {
    .symbol-detail .tree { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="head">
  <h1>AST Graph</h1>
  <div class="meta" id="header">Loading…</div>
  <div class="theme-toggle" role="group" aria-label="Theme">
    <button data-theme-mode="auto" aria-pressed="false" title="Follow VS Code theme">Auto</button>
    <button data-theme-mode="light" aria-pressed="false" title="Force light">Light</button>
    <button data-theme-mode="dark" aria-pressed="false" title="Force dark">Dark</button>
  </div>
</div>

<div class="pill-row" id="status"></div>

<div class="kpi" id="kpis"></div>

<div class="toolbar">
  <button id="rescan">Rescan</button>
  <button id="reregister" class="secondary">Re-register MCP</button>
  <button id="reveal" class="secondary">Reveal .db</button>
</div>

<section id="symbol-section">
  <div class="section-head">
    <h2>Symbol explorer</h2>
    <span class="count" id="symbol-hint">Click a hotspot or type a name</span>
    <input id="sym-search" class="filter" placeholder="Look up symbol (e.g. UserService.login)…" />
  </div>
  <div id="symbol-detail"></div>
</section>

<section id="hotspots-section">
  <div class="section-head">
    <h2>Hotspots</h2>
    <span class="count" id="hotspots-count"></span>
    <span class="legend"><span><span class="swatch in"></span>incoming</span><span><span class="swatch out"></span>outgoing</span></span>
    <input id="hot-filter" class="filter" placeholder="Filter by name or kind…" />
  </div>
  <div id="hotspots"></div>
</section>

<section id="kinds-section">
  <div class="section-head"><h2>By kind</h2></div>
  <div id="kinds"></div>
</section>

<section id="routes-section">
  <div class="section-head"><h2>HTTP routes</h2><span class="count" id="routes-count"></span></div>
  <div id="routes"></div>
</section>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let currentState = null;
let filterQuery = '';
let selectedSymbol = null;
let symbolRequestId = 0;
let symbolLoading = false;

// Theme management ---------------------------------------------------------
let themeMode = ${JSON.stringify(initialTheme)};
let themeObserver = null;

function detectVsCodeMode() {
  const cls = (document.body && document.body.className) || '';
  return (cls.indexOf('vscode-dark') >= 0 || cls.indexOf('vscode-high-contrast') >= 0)
    ? 'dark'
    : 'light';
}

function applyTheme(mode) {
  themeMode = (mode === 'light' || mode === 'dark') ? mode : 'auto';
  if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
  if (themeMode === 'auto') {
    // Mirror VS Code's body class onto our root data-theme so charts/etc.
    // that read from --ast-* also flip correctly. Body class can change
    // without a reload when the user swaps themes inside VS Code.
    const resolve = () => { document.documentElement.dataset.theme = detectVsCodeMode(); };
    resolve();
    themeObserver = new MutationObserver(resolve);
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } else {
    document.documentElement.dataset.theme = themeMode;
  }
  // Reflect on the toggle pills.
  for (const btn of document.querySelectorAll('.theme-toggle button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeMode === themeMode));
  }
}
applyTheme(themeMode);
for (const btn of document.querySelectorAll('.theme-toggle button')) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.themeMode;
    applyTheme(next);
    vscode.postMessage({ type: 'setTheme', mode: next });
  });
}

function fmt(n) {
  if (typeof n !== 'number') return n;
  return n.toLocaleString();
}
function fmtCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
}
function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'className') node.className = attrs[k];
    else if (k === 'dataset') for (const dk in attrs.dataset) node.dataset[dk] = attrs.dataset[dk];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') node[k] = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  }
  return node;
}

function renderHeader(state) {
  const header = document.getElementById('header');
  if (state.scan) {
    const ago = state.scan.finishedAt ? Math.round((Date.now() - state.scan.finishedAt) / 1000) : 0;
    const agoText = ago < 60 ? ago + 's' : ago < 3600 ? Math.round(ago/60) + 'm' : Math.round(ago/3600) + 'h';
    const dur = (state.scan.durationMs / 1000).toFixed(1) + 's';
    header.textContent = (state.workspaceName ? state.workspaceName + ' · ' : '') + 'scanned ' + agoText + ' ago in ' + dur;
  } else if (state.scanning) {
    header.textContent = (state.workspaceName ? state.workspaceName + ' · ' : '') + 'scanning…';
  } else if (!state.binReady) {
    header.textContent = 'Downloading ast-graph binary…';
  } else {
    header.textContent = (state.workspaceName ? state.workspaceName + ' · ' : '') + 'no scan yet';
  }
}

function renderStatus(state) {
  const status = document.getElementById('status');
  status.innerHTML = '';
  function pill(cls, text) {
    return el('span', { className: 'pill ' + cls }, el('span', { className: 'dot' }), text);
  }
  status.appendChild(pill(state.binReady ? 'ok' : 'warn', state.binReady ? 'Binary ready' : 'Binary missing'));
  status.appendChild(pill(state.scanning ? 'warn' : (state.scan ? 'ok' : ''), state.scanning ? 'Scanning' : (state.scan ? 'Indexed' : 'Idle')));
  status.appendChild(pill(state.mcp.ok ? 'ok' : 'err', state.mcp.ok ? 'MCP registered' : 'MCP off'));
  if (!state.mcp.ok && state.mcp.reason) {
    const meta = el('span', { className: 'pill' }, state.mcp.reason);
    status.appendChild(meta);
  }
}

function renderKpis(state) {
  const kpis = document.getElementById('kpis');
  kpis.innerHTML = '';
  if (!state.scan) return;
  const cards = [
    { label: 'Files', value: state.scan.files },
    { label: 'Nodes', value: state.scan.nodes, compact: true },
    { label: 'Edges', value: state.scan.edges, compact: true },
    { label: 'Languages', value: state.scan.languages.length ? state.scan.languages.join(', ') : '—', isText: true },
  ];
  for (const c of cards) {
    let valueNode;
    if (c.isText) {
      valueNode = el('div', { className: 'value' }, c.value);
    } else if (c.compact) {
      valueNode = el('div', { className: 'value' }, fmtCompact(c.value), el('span', { className: 'sub' }, '(' + fmt(c.value) + ')'));
    } else {
      valueNode = el('div', { className: 'value' }, fmt(c.value));
    }
    kpis.appendChild(el('div', { className: 'cell' },
      el('div', { className: 'label' }, c.label),
      valueNode,
    ));
  }
}

function renderHotspots(state) {
  const hot = document.getElementById('hotspots');
  const countNode = document.getElementById('hotspots-count');
  hot.innerHTML = '';
  const all = state.hotspots || [];
  const q = filterQuery.trim().toLowerCase();
  const rows = q
    ? all.filter((h) => h.name.toLowerCase().includes(q) || h.kind.toLowerCase().includes(q))
    : all;
  countNode.textContent = q ? rows.length + ' / ' + all.length : (all.length ? all.length + ' total' : '');

  if (rows.length === 0) {
    hot.appendChild(el('div', { className: 'empty' },
      !state.scan ? 'Run a scan first.' :
      q ? 'No matches for "' + q + '".' : 'No hotspots yet.'));
    return;
  }

  const maxTotal = Math.max(...rows.map((h) => h.total), 1);
  const table = el('table', { className: 'hot' });
  const colgroup = el('colgroup', null,
    el('col', { className: 'name' }),
    el('col'),
    el('col'),
    el('col'),
    el('col'),
    el('col'),
  );
  table.appendChild(colgroup);
  const thead = el('thead', null, el('tr', null,
    el('th', null, 'Name'),
    el('th', null, 'Kind'),
    el('th', { style: 'text-align:right' }, 'Out'),
    el('th', { style: 'text-align:right' }, 'In'),
    el('th', { style: 'text-align:right' }, 'Total'),
    el('th', null, ''),
  ));
  table.appendChild(thead);

  const tbody = el('tbody', null,
    ...rows.map((h) => {
      const inPct  = Math.round((h.inc / maxTotal) * 100);
      const outPct = Math.round((h.out / maxTotal) * 100);
      const bar = el('div', { className: 'bar' },
        el('span', { className: 'in',  style: 'width:' + inPct  + '%' }),
        el('span', { className: 'out', style: 'width:' + outPct + '%' }),
      );
      const tr = el('tr', { title: 'Click to inspect callers/callees' },
        el('td', { className: 'name' }, h.name),
        el('td', { className: 'kind-cell' }, el('span', { className: 'kind', dataset: { kind: h.kind } }, h.kind)),
        el('td', { className: 'num' }, fmt(h.out)),
        el('td', { className: 'num' }, fmt(h.inc)),
        el('td', { className: 'num' }, fmt(h.total)),
        el('td', { className: 'bar-cell' }, bar),
      );
      tr.dataset.name = h.name;
      tr.onclick = () => requestSymbol(h.name);
      if (selectedSymbol && selectedSymbol === h.name) tr.classList.add('selected');
      return tr;
    }),
  );
  table.appendChild(tbody);
  hot.appendChild(table);
}

function renderKinds(state) {
  const kinds = document.getElementById('kinds');
  kinds.innerHTML = '';
  if (!state.stats || state.stats.length === 0) {
    kinds.appendChild(el('div', { className: 'empty' }, '—'));
    return;
  }
  const chips = el('div', { className: 'chips' });
  for (const k of state.stats) {
    chips.appendChild(el('span', { className: 'chip' },
      el('span', { className: 'kind', dataset: { kind: k.kind } }, k.kind),
      el('span', { className: 'n' }, fmt(k.count)),
    ));
  }
  kinds.appendChild(chips);
}

function renderRoutes(state) {
  const routes = document.getElementById('routes');
  const count = document.getElementById('routes-count');
  routes.innerHTML = '';
  if (!state.routes || state.routes.length === 0) {
    count.textContent = '';
    routes.appendChild(el('div', { className: 'empty' }, 'No HTTP routes detected.'));
    return;
  }
  count.textContent = state.routes.length + ' total';
  const wrap = el('div', { className: 'chips' });
  for (const r of state.routes) {
    wrap.appendChild(el('span', { className: 'chip' }, el('span', { className: 'name', style: 'font-family:var(--mono);font-size:11.5px' }, r.line)));
  }
  routes.appendChild(wrap);
}

function render(state) {
  currentState = state;
  renderHeader(state);
  renderStatus(state);
  renderKpis(state);
  renderHotspots(state);
  renderKinds(state);
  renderRoutes(state);
  document.getElementById('rescan').disabled = !state.binReady || state.scanning;
  document.getElementById('reregister').disabled = !state.binReady || !state.scan;
  document.getElementById('reveal').disabled = !state.scan;
}

document.getElementById('rescan').onclick = () => vscode.postMessage({ type: 'rescan' });
document.getElementById('reregister').onclick = () => vscode.postMessage({ type: 'reregisterMcp' });
document.getElementById('reveal').onclick = () => vscode.postMessage({ type: 'revealDb' });
document.getElementById('hot-filter').addEventListener('input', (e) => {
  filterQuery = e.target.value || '';
  if (currentState) renderHotspots(currentState);
});

// Symbol explorer ---------------------------------------------------------
function requestSymbol(name) {
  if (!name) return;
  selectedSymbol = name;
  symbolLoading = true;
  symbolRequestId++;
  const id = symbolRequestId;
  // Mark loading state immediately so the user sees feedback.
  renderSymbolDetail({ pending: true, name });
  if (currentState) renderHotspots(currentState);
  vscode.postMessage({ type: 'lookupSymbol', name, requestId: id });
}

function clearSymbol() {
  selectedSymbol = null;
  symbolLoading = false;
  renderSymbolDetail(null);
  if (currentState) renderHotspots(currentState);
}

function refLi(arrowCls, arrowChar, ref) {
  const li = el('li', null,
    el('span', { className: 'arrow ' + arrowCls }, arrowChar),
    el('span', { className: 'ref-name' },
      ref.name,
      ref.kind ? el('span', { className: 'kind', dataset: { kind: ref.kind }, style: 'margin-left:6px;font-size:10px' }, ref.kind) : null,
    ),
    ref.file ? el('span', { className: 'ref-loc' }, ref.file + (ref.line ? ':' + ref.line : '')) : null,
  );
  // Two-tier click: file part opens file, name part navigates to symbol.
  li.onclick = (ev) => {
    ev.stopPropagation();
    if (ref.file) {
      vscode.postMessage({ type: 'openFile', file: ref.file, line: ref.line || 0 });
    } else {
      requestSymbol(ref.name);
    }
  };
  li.oncontextmenu = (ev) => {
    ev.preventDefault();
    requestSymbol(ref.name);
  };
  return li;
}

function renderSymbolDetail(payload) {
  const root = document.getElementById('symbol-detail');
  const hint = document.getElementById('symbol-hint');
  root.innerHTML = '';
  if (!payload) {
    hint.textContent = 'Click a hotspot or type a name';
    return;
  }
  if (payload.pending) {
    hint.textContent = 'Loading "' + payload.name + '"…';
    const wrap = el('div', { className: 'symbol-detail loading' },
      el('div', { className: 'header' },
        el('span', { className: 'sym-name' }, payload.name),
        el('span', { className: 'sym-loc' }, 'looking up…'),
      ));
    root.appendChild(wrap);
    return;
  }
  if (payload.error) {
    hint.textContent = '';
    root.appendChild(el('div', { className: 'symbol-detail' },
      el('div', { className: 'err' }, 'Could not load "' + payload.name + '": ' + payload.error),
    ));
    return;
  }
  const d = payload.detail;
  if (!d) {
    hint.textContent = '';
    root.appendChild(el('div', { className: 'symbol-detail' },
      el('div', { className: 'err' }, 'No symbol matched "' + payload.name + '".'),
    ));
    return;
  }
  hint.textContent = d.callers.length + ' callers · ' + d.callees.length + ' callees' + (d.members && d.members.length ? ' · ' + d.members.length + ' members' : '');

  const close = el('button', { className: 'close' }, 'Close');
  close.onclick = clearSymbol;

  const locText = d.file ? d.file + (d.lineStart ? ':' + d.lineStart + (d.lineEnd ? '-' + d.lineEnd : '') : '') : '';
  const locNode = d.file
    ? el('span', { className: 'sym-loc' }, locText)
    : null;
  if (locNode) {
    locNode.onclick = () => vscode.postMessage({ type: 'openFile', file: d.file, line: d.lineStart || 0 });
    locNode.title = 'Open in editor';
  }

  const wrap = el('div', { className: 'symbol-detail' });
  wrap.appendChild(el('div', { className: 'header' },
    el('span', { className: 'kind', dataset: { kind: d.kind } }, d.kind),
    el('span', { className: 'sym-name' }, d.name),
    locNode,
    close,
  ));
  if (d.signature) {
    wrap.appendChild(el('div', { className: 'sig' }, d.signature));
  }

  const tree = el('div', { className: 'tree' });
  tree.appendChild(buildTreeCol('Callers (' + d.callers.length + ')', d.callers, 'in', '←'));
  tree.appendChild(buildTreeCol('Calls (' + d.callees.length + ')', d.callees, 'out', '→'));
  wrap.appendChild(tree);

  if (d.members && d.members.length) {
    const memWrap = el('div', { style: 'margin-top:14px' });
    memWrap.appendChild(buildTreeCol('Members (' + d.members.length + ')', d.members, 'in', '·'));
    wrap.appendChild(memWrap);
  }

  root.appendChild(wrap);
}

function buildTreeCol(title, refs, arrowCls, arrowChar) {
  const col = el('div', { className: 'tree-col' });
  col.appendChild(el('h3', null, title));
  if (refs.length === 0) {
    col.appendChild(el('div', { className: 'empty' }, '—'));
    return col;
  }
  const ul = el('ul', null,
    ...refs.map((r) => refLi(arrowCls, arrowChar, r)),
  );
  col.appendChild(ul);
  return col;
}

// Symbol search input ----------------------------------------------------
let searchDebounce = null;
const searchInput = document.getElementById('sym-search');
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (searchDebounce) clearTimeout(searchDebounce);
    requestSymbol(searchInput.value.trim());
  } else if (e.key === 'Escape') {
    searchInput.value = '';
    clearSymbol();
  }
});
searchInput.addEventListener('input', () => {
  // Light debounce — only auto-lookup when user pauses 500ms AND has 3+ chars.
  if (searchDebounce) clearTimeout(searchDebounce);
  const v = searchInput.value.trim();
  if (v.length < 3) return;
  searchDebounce = setTimeout(() => {
    requestSymbol(v);
  }, 500);
});

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'state') {
    render(msg.state);
    return;
  }
  if (msg.type === 'themeOverride') {
    // Broadcast from themeManager when another AIDLC panel toggles.
    if (msg.mode === 'auto' || msg.mode === 'light' || msg.mode === 'dark') {
      applyTheme(msg.mode);
    }
    return;
  }
  if (msg.type === 'symbol') {
    if (msg.requestId !== symbolRequestId) return; // outdated reply
    symbolLoading = false;
    if (msg.ok) {
      renderSymbolDetail({ name: selectedSymbol, detail: msg.detail });
    } else {
      renderSymbolDetail({ name: selectedSymbol, error: msg.error });
    }
    if (currentState) renderHotspots(currentState);
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

/**
 * Parse the fixed-width "hotspots" table. Header row is:
 *   Name                           Kind                 Out       In    Total
 * followed by a separator and then data rows. Whitespace between
 * columns varies, so we split on 2+ spaces — except `Method` names
 * can contain dots (e.g. `Foo.bar`) which is fine, no spaces there.
 */
export function parseHotspots(text: string): HotspotRow[] {
  const rows: HotspotRow[] = [];
  const cleaned = stripNoise(text).split(/\r?\n/);
  let started = false;
  for (const raw of cleaned) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (!started) {
      if (/^Name\s+Kind/.test(line)) started = true;
      continue;
    }
    if (/^[-=\s]+$/.test(line)) continue;
    // Take last three integers, rest is name+kind, kind is the last
    // word before the integers.
    const m = /^(.*?)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    rows.push({
      name: m[1].trim(),
      kind: m[2],
      out: parseInt(m[3], 10),
      inc: parseInt(m[4], 10),
      total: parseInt(m[5], 10),
    });
  }
  return rows;
}

export function parseRoutes(text: string): RouteRow[] {
  const cleaned = stripNoise(text).split(/\r?\n/);
  const rows: RouteRow[] = [];
  for (const raw of cleaned) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Routes\s*\(/.test(line)) continue;
    if (/^No routes/i.test(line)) return [];
    // Lines look like:  GET /users   1 handler(s)  src/api/users.ts:14
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\s+/.test(line)) {
      rows.push({ line });
    }
  }
  return rows;
}

export function parseStatsKinds(text: string): KindCount[] {
  const cleaned = stripNoise(text).split(/\r?\n/);
  const rows: KindCount[] = [];
  let inKind = false;
  for (const raw of cleaned) {
    const line = raw.trimEnd();
    if (/^\s*By Kind:/.test(line)) { inKind = true; continue; }
    if (!inKind) continue;
    if (/^\s*By\s+/.test(line)) break; // next section, if any
    const m = /^\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    rows.push({ kind: m[1], count: parseInt(m[2], 10) });
  }
  return rows;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
