/**
 * Token Usage Report panel — full dashboard rendered in a webview when
 * the user clicks the status bar item. Mirrors `monitor.py report`.
 *
 * Sections: Overview, By Model, Daily (last 30), Top Projects, Heatmap,
 * Efficiency Suggestions. The panel is single-instance per VS Code window
 * (showing a second time reveals the existing panel).
 */
import * as vscode from 'vscode';
import { themeManager } from './themeManager';
import { loadAllRecords } from './tokenRecords';
import { buildReport, type TokenReport } from './tokenReport';

interface ReportPanelState {
  report: TokenReport | null;
  loading: boolean;
  error: string | null;
  windowDays: number;
}

export class TokenReportWebview {
  public static readonly viewType = 'aidlcTokenReport';
  private static current: TokenReportWebview | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private state: ReportPanelState = {
    report: null,
    loading: false,
    error: null,
    windowDays: 30,
  };
  private loadPromise: Promise<void> | null = null;

  static show(extensionUri: vscode.Uri): void {
    if (TokenReportWebview.current) {
      TokenReportWebview.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      TokenReportWebview.viewType,
      'Claude Token Usage Report',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    TokenReportWebview.current = new TokenReportWebview(panel, extensionUri);
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
    this.disposables.push(themeManager.register(this.panel.webview));
    void this.loadReport();
  }

  private async loadReport(): Promise<void> {
    if (this.loadPromise) { return this.loadPromise; }
    const cfg = vscode.workspace.getConfiguration('aidlc.tokenMonitor');
    const windowDays = Math.max(1, cfg.get<number>('suggestionWindowDays', 30));
    this.state = { ...this.state, loading: true, error: null, windowDays };
    this.refresh();
    this.loadPromise = (async () => {
      try {
        const records = await loadAllRecords(windowDays);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const report = buildReport(records, windowDays, workspaceRoot);
        this.state = { report, loading: false, error: null, windowDays };
      } catch (e) {
        this.state = {
          ...this.state,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        this.refresh();
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  private refresh(): void {
    void this.panel.webview.postMessage({ type: 'state', state: this.state });
  }

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.refresh();
        return;
      case 'refresh':
        void this.loadReport();
        return;
      case 'setTheme': {
        const mode = String(msg.mode ?? '');
        if (mode === 'auto' || mode === 'light' || mode === 'dark') {
          await themeManager.set(mode);
        }
        return;
      }
    }
  }

  private dispose(): void {
    TokenReportWebview.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  private getHtml(): string {
    const nonce = makeNonce();
    const webview = this.panel.webview;
    const cspSource = webview.cspSource;
    const initialTheme = themeManager.current;
    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, 'out', 'webviews');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'styles.css')).toString();
    const entryUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'tokenReport.js')).toString();

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
<title>Claude Token Usage Report</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">
window.__AIDLC_INITIAL_STATE__ = ${JSON.stringify(this.state)};
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
