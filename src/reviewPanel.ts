import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EpicStatus, PhaseStatus, approvePhase, rejectPhase, REJECT_TO } from '@aidlc/core';

export class ReviewPanel {
  private static currentPanel: ReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static show(
    extensionUri: vscode.Uri,
    workspaceRoot: string,
    phase: PhaseStatus,
    epic: EpicStatus,
    reviewer: string,
    onAfterAction: () => void,
  ) {
    const column = vscode.ViewColumn.One;
    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      'cfReviewGate',
      `Review: ${epic.key} / ${phase.name}`,
      column,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    ReviewPanel.currentPanel = new ReviewPanel(panel, extensionUri, workspaceRoot, phase, epic, reviewer, onAfterAction);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    private workspaceRoot: string,
    private phase: PhaseStatus,
    private epic: EpicStatus,
    private reviewer: string,
    private onAfterAction: () => void,
  ) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this.getHtml();
    this._panel.webview.onDidReceiveMessage(this.handleMessage.bind(this), null, this._disposables);
  }

  private dispose() {
    ReviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }

  private async handleMessage(msg: { type: string; reason?: string; rejectTo?: string; path?: string }): Promise<void> {
    if (msg.type === 'openArtifact' && typeof msg.path === 'string') {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
      return;
    }
    if (msg.type === 'approve') {
      this.approve(msg.reason ?? '');
      return;
    }
    if (msg.type === 'reject') {
      if (!msg.rejectTo) {
        void vscode.window.showWarningMessage('Pick a target phase before rejecting.');
        return;
      }
      if (!msg.reason || msg.reason.trim().length < 5) {
        void vscode.window.showWarningMessage('Provide a reason (≥ 5 chars) before rejecting.');
        return;
      }
      await this.reject(msg.rejectTo, msg.reason);
      return;
    }
  }

  private approve(comment: string) {
    try {
      approvePhase({
        phaseId: this.phase.id,
        epicFolderPath: this.epic.folderPath,
        reviewer: this.reviewer,
        comment,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    void this.showAdvancePrompt(`✅ Approved ${this.epic.key} / ${this.phase.name}.`);
    this.onAfterAction();
    this.dispose();
  }

  private async showAdvancePrompt(prefix: string): Promise<void> {
    const pick = await vscode.window.showInformationMessage(
      `${prefix} Advance epic to the next phase?`,
      'Advance now',
      'Later',
    );
    if (pick === 'Advance now') {
      await vscode.commands.executeCommand('cfPipeline.advanceEpic', this.epic.key);
    }
  }

  private async reject(rejectTo: string, reason: string): Promise<void> {
    try {
      rejectPhase({
        fromPhaseId: this.phase.id,
        rejectTo,
        epicFolderPath: this.epic.folderPath,
        reviewer: this.reviewer,
        reason,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Reject cascade failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    void this.showAdvancePrompt(`❌ Rejected ${this.epic.key} / ${this.phase.name} → ${rejectTo}.`);
    this.onAfterAction();
    this.dispose();
  }

  private getHtml(): string {
    const artifacts = collectArtifactPaths(this.epic.folderPath, this.phase);
    const checklist = this.phase.lastReview?.checklist_results ?? {};
    const rejectOptions = REJECT_TO[this.phase.id] ?? [];
    const nonce = Math.random().toString(36).slice(2, 12);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Review Gate</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px 24px; color: var(--vscode-foreground); }
    h1 { margin-top: 0; font-size: 1.3em; }
    h2 { font-size: 1.0em; margin-top: 1.5em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 8px; }
    .artifacts a { display: block; padding: 4px 0; color: var(--vscode-textLink-foreground); cursor: pointer; }
    .checklist { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    .checklist td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .pass { color: var(--vscode-testing-iconPassed); }
    .fail { color: var(--vscode-testing-iconFailed); }
    .actions { margin-top: 24px; display: flex; gap: 24px; }
    .box { flex: 1; padding: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    label { display: block; font-size: 0.9em; margin: 8px 0 4px; }
    textarea, select { width: 100%; padding: 4px 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-font-family); }
    textarea { min-height: 72px; resize: vertical; }
    button { margin-top: 12px; padding: 6px 16px; cursor: pointer; border: none; color: white; border-radius: 2px; }
    button.approve { background: var(--vscode-testing-iconPassed, #388e3c); }
    button.reject { background: var(--vscode-testing-iconFailed, #d32f2f); }
    .reason-row { margin-top: 8px; color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>🔔 Review Gate: ${escapeHtml(this.epic.key)} / ${escapeHtml(this.phase.name)}</h1>
  <div class="meta">
    Revision ${this.phase.revision ?? 1} · ${escapeHtml(this.phase.agent)} ·
    auto-review by ${escapeHtml(this.phase.lastReview?.reviewer ?? 'n/a')}
  </div>
  ${this.phase.lastReview?.reason
    ? `<div class="reason-row">Auto-reviewer: ${escapeHtml(this.phase.lastReview.reason)}</div>`
    : ''}

  <h2>Artifacts</h2>
  <div class="artifacts">
    ${artifacts.length === 0
      ? '<em>No artifacts found for this phase.</em>'
      : artifacts.map(a => `<a data-path="${escapeAttr(a.path)}">${escapeHtml(a.label)}</a>`).join('')}
  </div>

  <h2>Auto-reviewer Checklist</h2>
  ${Object.keys(checklist).length === 0
    ? '<em>No checklist results recorded.</em>'
    : `<table class="checklist">${
        Object.entries(checklist)
          .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="${v === 'pass' ? 'pass' : 'fail'}">${v}</td></tr>`)
          .join('')
      }</table>`
  }

  <div class="actions">
    <div class="box">
      <h2 style="margin-top:0;border:none;padding:0;">✅ Approve</h2>
      <label for="approveComment">Optional comment</label>
      <textarea id="approveComment" placeholder="e.g. LGTM, minor nits in the file."></textarea>
      <button class="approve" id="approveBtn">Approve phase</button>
    </div>

    <div class="box">
      <h2 style="margin-top:0;border:none;padding:0;">❌ Reject to upstream</h2>
      <label for="rejectTo">Target phase</label>
      <select id="rejectTo">
        <option value="">— pick one —</option>
        ${rejectOptions.map((o: string) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join('')}
      </select>
      <label for="rejectReason">Reason (required)</label>
      <textarea id="rejectReason" placeholder="What needs to change upstream?"></textarea>
      <button class="reject" id="rejectBtn">Reject + cascade</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.artifacts a').forEach(a => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'openArtifact', path: a.dataset.path });
      });
    });
    document.getElementById('approveBtn').addEventListener('click', () => {
      const reason = document.getElementById('approveComment').value || '';
      vscode.postMessage({ type: 'approve', reason });
    });
    document.getElementById('rejectBtn').addEventListener('click', () => {
      const rejectTo = document.getElementById('rejectTo').value || '';
      const reason = document.getElementById('rejectReason').value || '';
      vscode.postMessage({ type: 'reject', rejectTo, reason });
    });
  </script>
</body>
</html>`;
  }
}

interface ArtifactLink {
  label: string;
  path: string;
}

function collectArtifactPaths(epicDir: string, phase: PhaseStatus): ArtifactLink[] {
  const candidates: ArtifactLink[] = [];
  if (phase.artifactPath) {
    candidates.push({ label: phase.artifact ?? path.basename(phase.artifactPath), path: phase.artifactPath });
  }
  // Also surface the phase folder's own files (excluding status.json + archive/)
  const phaseDir = path.join(epicDir, 'phases', phase.id);
  if (fs.existsSync(phaseDir)) {
    for (const entry of fs.readdirSync(phaseDir, { withFileTypes: true })) {
      if (entry.isDirectory()) { continue; }
      if (entry.name === 'status.json') { continue; }
      const full = path.join(phaseDir, entry.name);
      if (!candidates.some(c => c.path === full)) {
        candidates.push({ label: `phases/${phase.id}/${entry.name}`, path: full });
      }
    }
  }
  return candidates;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
