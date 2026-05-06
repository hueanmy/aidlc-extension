/**
 * AIDLC Workspace Builder — main-area webview panel.
 *
 * Phase B Lite: visual surface for the workspace.yaml-driven workflow
 * (agents / skills / pipelines). Reuses the QuickPick wizards from
 * `wizards.ts` for "+ Add" actions — clicking a button in the panel just
 * triggers the existing command; the wizard appears at the top of VS Code,
 * the panel re-renders when YAML changes.
 *
 * What this is NOT:
 * - No drag-drop. Reorder is via ↑↓ buttons on each step.
 * - No CodeMirror skill editor. Clicking a skill opens the .md file in
 *   VS Code's regular editor.
 * - No react-flow canvas. Workflows render as vertical step lists.
 *
 * Full visual builder (drag-drop, canvas, inline editors) is M3 / Phase C —
 * out of scope here. The state model + message protocol below are
 * forward-compatible: M3 will swap the renderer (HTML → React), keep the
 * provider + protocol unchanged.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { readYaml, writeYaml, type YamlDocument } from './yamlIO';
import {
  WORKSPACE_DIR,
  WORKSPACE_FILENAME,
  stepAgentId,
  normalizeStep,
  discoverAssets,
} from '@aidlc/core';
import type { PipelineStepConfig, AssetScope, DiscoveredAsset } from '@aidlc/core';
import { promptStepConfig } from './wizards';
import { listEpics, type EpicSummary } from './epicsList';

// ── State shape sent to webview ────────────────────────────────────────

/**
 * One catalog row for the Skills / Agents tabs. Both AIDLC-declared items
 * (sourced from workspace.yaml) and Claude-Code-native items (discovered
 * on disk under `.claude/` or `~/.claude/`) flatten into this same shape so
 * the UI can render a single grouped list. Scope-specific extras hang off
 * `aidlcMeta` (skill ref / model / capabilities), which is undefined for
 * project + global rows.
 */
interface AssetRow {
  id: string;
  scope: AssetScope;
  /** Absolute file path, or null when an AIDLC skill row has no `path` (builtin). */
  filePath: string | null;
  /** True only for AIDLC skills referencing a `path:` whose file is missing on disk. */
  fileMissing?: boolean;
  /** True when a higher-precedence scope shadows this row. */
  overridden?: boolean;
  overriddenBy?: AssetScope;
  /** AIDLC-only metadata. Project + global agents have no skill/model concept. */
  aidlcMeta?: {
    name?: string;
    skill?: string;
    model?: string;
    runner?: 'default' | 'custom';
    envCount?: number;
    capabilities?: string[];
    /** True for AIDLC-bundled `builtin: true` skills with no on-disk path. */
    builtin?: boolean;
  };
}

interface BuilderState {
  workspaceRoot: string | null;
  workspaceName: string;
  configExists: boolean;
  agents: AssetRow[];
  skills: AssetRow[];
  pipelines: Array<{
    id: string;
    steps: Array<{
      agent: string;
      enabled: boolean;
      humanReview: boolean;
      autoReview: boolean;
      autoReviewRunner?: string;
      requiresCount: number;
      producesCount: number;
    }>;
    on_failure: 'stop' | 'continue';
  }>;
  epics: EpicSummary[];
}

function buildState(): BuilderState {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  if (!root) {
    return {
      workspaceRoot: null,
      workspaceName: '(no folder open)',
      configExists: false,
      agents: [], skills: [], pipelines: [],
      epics: [],
    };
  }

  const doc = readYaml(root);
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? path.basename(root);

  // Epics are independent of workspace.yaml — they live on disk regardless.
  // List them even when there's no config so the user can still see prior runs.
  const epics = listEpics(root, doc);

  // Discovered assets exist regardless of workspace.yaml presence — they're
  // just files on disk. Build them once and reuse for both the no-config
  // and configured branches.
  const discovered = discoverAssets(root);

  if (!doc) {
    return {
      workspaceRoot: root,
      workspaceName,
      configExists: false,
      agents: claudeAssetsToRows(discovered.agents),
      skills: claudeAssetsToRows(discovered.skills),
      pipelines: [],
      epics,
    };
  }

  return {
    // Always show the folder name — it's the project identity the user
    // navigates by in VS Code. The `name:` field in workspace.yaml is just
    // free-form metadata; using it here led to confusion when the sample
    // template's "My AIDLC Workspace" leaked into projects called something
    // very different.
    workspaceRoot: root,
    workspaceName,
    configExists: true,
    agents: mergeAgentRows(doc, discovered.agents),
    skills: mergeSkillRows(doc, root, discovered.skills),
    pipelines: doc.pipelines.map((p) => ({
      id: String(p.id),
      steps: Array.isArray(p.steps)
        ? (p.steps as PipelineStepConfig[]).map((raw) => {
            const norm = normalizeStep(raw);
            return {
              agent: norm.agent,
              enabled: norm.enabled,
              humanReview: norm.human_review,
              autoReview: norm.auto_review,
              autoReviewRunner: norm.auto_review_runner,
              requiresCount: norm.requires.length,
              producesCount: norm.produces.length,
            };
          })
        : [],
      on_failure: p.on_failure === 'continue' ? 'continue' : 'stop',
    })),
    epics,
  };
}

/**
 * Convert Claude-Code-native discovered assets (project + global scope) to
 * unified AssetRow form. AIDLC-scope items are NOT touched here — those
 * have richer metadata pulled from workspace.yaml in `mergeAgentRows` /
 * `mergeSkillRows`.
 */
function claudeAssetsToRows(items: DiscoveredAsset[]): AssetRow[] {
  return items
    .filter((a) => a.scope !== 'aidlc')
    .map((a) => ({
      id: a.id,
      scope: a.scope,
      filePath: a.filePath,
      overridden: a.overridden,
      overriddenBy: a.overriddenBy,
    }));
}

/**
 * Merge AIDLC agents (declared in workspace.yaml) with project + global
 * agents (discovered on disk). Output preserves precedence ordering —
 * project items are flagged `overridden` only when they collide with an
 * AIDLC agent of the same id (project > aidlc > global).
 *
 * Workspace.yaml agents always render as scope: 'aidlc' even though their
 * .md (if any) might live elsewhere — the workspace.yaml entry is the
 * authoritative declaration for AIDLC pipeline runs.
 */
function mergeAgentRows(doc: YamlDocument, discovered: DiscoveredAsset[]): AssetRow[] {
  const winnerById = new Map<string, AssetScope>();
  for (const a of discovered) {
    if (a.scope === 'project' && !winnerById.has(a.id)) {
      winnerById.set(a.id, 'project');
    }
  }
  for (const a of doc.agents) {
    const id = String(a.id);
    if (!winnerById.has(id)) { winnerById.set(id, 'aidlc'); }
  }
  for (const a of discovered) {
    if (a.scope === 'global' && !winnerById.has(a.id)) {
      winnerById.set(a.id, 'global');
    }
  }

  const rows: AssetRow[] = [];

  for (const a of discovered.filter((x) => x.scope === 'project')) {
    const winner = winnerById.get(a.id);
    rows.push({
      id: a.id,
      scope: 'project',
      filePath: a.filePath,
      overridden: winner !== undefined && winner !== 'project',
      overriddenBy: winner !== 'project' ? winner : undefined,
    });
  }

  for (const a of doc.agents) {
    const id = String(a.id);
    const winner = winnerById.get(id);
    rows.push({
      id,
      scope: 'aidlc',
      filePath: null,
      overridden: winner !== undefined && winner !== 'aidlc',
      overriddenBy: winner !== 'aidlc' ? winner : undefined,
      aidlcMeta: {
        name: typeof a.name === 'string' ? a.name : id,
        skill: typeof a.skill === 'string' ? a.skill : '',
        model: typeof a.model === 'string' ? a.model : '',
        runner: a.runner === 'custom' ? 'custom' : 'default',
        envCount: a.env && typeof a.env === 'object'
          ? Object.keys(a.env as object).length
          : 0,
        capabilities: Array.isArray(a.capabilities)
          ? (a.capabilities as unknown[]).map(String)
          : [],
      },
    });
  }

  for (const a of discovered.filter((x) => x.scope === 'global')) {
    const winner = winnerById.get(a.id);
    rows.push({
      id: a.id,
      scope: 'global',
      filePath: a.filePath,
      overridden: winner !== undefined && winner !== 'global',
      overriddenBy: winner !== 'global' ? winner : undefined,
    });
  }

  return rows;
}

/**
 * Merge AIDLC skills (workspace.yaml) with project + global skills
 * (discovered). AIDLC skills can be `builtin: true` (no on-disk path) or
 * point at a `path:` (resolved relative to workspace root). Both forms
 * surface as scope: 'aidlc' rows.
 */
function mergeSkillRows(
  doc: YamlDocument,
  root: string,
  discovered: DiscoveredAsset[],
): AssetRow[] {
  const winnerById = new Map<string, AssetScope>();
  for (const s of discovered) {
    if (s.scope === 'project' && !winnerById.has(s.id)) {
      winnerById.set(s.id, 'project');
    }
  }
  for (const s of doc.skills) {
    const id = String(s.id);
    if (!winnerById.has(id)) { winnerById.set(id, 'aidlc'); }
  }
  for (const s of discovered) {
    if (s.scope === 'global' && !winnerById.has(s.id)) {
      winnerById.set(s.id, 'global');
    }
  }

  const rows: AssetRow[] = [];

  for (const s of discovered.filter((x) => x.scope === 'project')) {
    const winner = winnerById.get(s.id);
    rows.push({
      id: s.id,
      scope: 'project',
      filePath: s.filePath,
      overridden: winner !== undefined && winner !== 'project',
      overriddenBy: winner !== 'project' ? winner : undefined,
    });
  }

  for (const s of doc.skills) {
    const id = String(s.id);
    const winner = winnerById.get(id);
    if (s.builtin) {
      rows.push({
        id,
        scope: 'aidlc',
        filePath: null,
        overridden: winner !== undefined && winner !== 'aidlc',
        overriddenBy: winner !== 'aidlc' ? winner : undefined,
        aidlcMeta: { builtin: true },
      });
      continue;
    }
    const skillPath = typeof s.path === 'string' ? s.path : undefined;
    const abs = skillPath
      ? (path.isAbsolute(skillPath) ? skillPath : path.resolve(root, skillPath))
      : null;
    rows.push({
      id,
      scope: 'aidlc',
      filePath: abs,
      fileMissing: abs ? !fs.existsSync(abs) : true,
      overridden: winner !== undefined && winner !== 'aidlc',
      overriddenBy: winner !== 'aidlc' ? winner : undefined,
    });
  }

  for (const s of discovered.filter((x) => x.scope === 'global')) {
    const winner = winnerById.get(s.id);
    rows.push({
      id: s.id,
      scope: 'global',
      filePath: s.filePath,
      overridden: winner !== undefined && winner !== 'global',
      overriddenBy: winner !== 'global' ? winner : undefined,
    });
  }

  return rows;
}

// ── Provider / panel lifecycle ─────────────────────────────────────────

export class BuilderPanel {
  static current: BuilderPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;

  static show(extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.One;
    if (BuilderPanel.current) {
      BuilderPanel.current.panel.reveal(column);
      BuilderPanel.current.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aidlc.builder',
      'AIDLC Builder',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');

    BuilderPanel.current = new BuilderPanel(panel, extensionUri);
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

    // Re-render when workspace.yaml or any epic state.json changes externally.
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
      const refresh = () => this.refresh();

      const yamlPattern = new vscode.RelativePattern(
        vscode.Uri.file(path.join(root, WORKSPACE_DIR)),
        WORKSPACE_FILENAME,
      );
      this.watcher = vscode.workspace.createFileSystemWatcher(yamlPattern);
      this.watcher.onDidChange(refresh, null, this.disposables);
      this.watcher.onDidCreate(refresh, null, this.disposables);
      this.watcher.onDidDelete(refresh, null, this.disposables);
      this.disposables.push(this.watcher);

      // Broad watcher for epic state files. We don't know state.root in
      // advance (it lives in workspace.yaml), so watch any state.json under
      // the workspace — cheap and refreshes only when relevant files move.
      const epicPattern = new vscode.RelativePattern(vscode.Uri.file(root), '**/state.json');
      const epicWatcher = vscode.workspace.createFileSystemWatcher(epicPattern);
      epicWatcher.onDidChange(refresh, null, this.disposables);
      epicWatcher.onDidCreate(refresh, null, this.disposables);
      epicWatcher.onDidDelete(refresh, null, this.disposables);
      this.disposables.push(epicWatcher);
    }

    this.refresh();
  }

  refresh(): void {
    void this.panel.webview.postMessage({ type: 'state', state: buildState() });
  }

  private dispose(): void {
    BuilderPanel.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  // ── Message handlers ────────────────────────────────────────────────

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.refresh();
        return;

      case 'init':
        await vscode.commands.executeCommand('aidlc.initWorkspace');
        return;

      case 'applyPreset':
        await vscode.commands.executeCommand('aidlc.applyPreset');
        return;

      case 'savePreset':
        await vscode.commands.executeCommand('aidlc.savePreset');
        return;

      case 'startEpic':
        await vscode.commands.executeCommand('aidlc.startEpic');
        return;

      case 'openEpicState': {
        const statePath = String(msg.path ?? '');
        if (!statePath || !fs.existsSync(statePath)) { return; }
        const docOpen = await vscode.workspace.openTextDocument(statePath);
        await vscode.window.showTextDocument(docOpen, { preview: false });
        return;
      }

      case 'openEpicsList':
        await vscode.commands.executeCommand('aidlc.openEpicsList');
        return;

      case 'addAgent':
        await vscode.commands.executeCommand('aidlc.addAgent');
        return;

      case 'addSkill':
        await vscode.commands.executeCommand('aidlc.addSkill');
        return;

      case 'addPipeline':
        await vscode.commands.executeCommand('aidlc.addPipeline');
        return;

      case 'switchProject': {
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

      case 'openClaude':
        await vscode.commands.executeCommand('aidlc.openClaudeTerminal');
        return;

      case 'openSkill':
      case 'openAgent': {
        // Both actions open a discovered .md file. We accept absolute or
        // workspace-relative paths so the caller doesn't need to know
        // which scope the asset lives in (project + aidlc are workspace-
        // relative; global lives in the home dir, always absolute).
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const targetPathArg = String(msg.path ?? '');
        if (!targetPathArg) { return; }
        const abs = path.isAbsolute(targetPathArg)
          ? targetPathArg
          : (root ? path.resolve(root, targetPathArg) : targetPathArg);
        if (!fs.existsSync(abs)) {
          void vscode.window.showWarningMessage(`File not found: ${targetPathArg}`);
          return;
        }
        const doc = await vscode.workspace.openTextDocument(abs);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }

      case 'openYaml': {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return; }
        const yp = path.join(root, WORKSPACE_DIR, WORKSPACE_FILENAME);
        if (fs.existsSync(yp)) {
          const doc = await vscode.workspace.openTextDocument(yp);
          await vscode.window.showTextDocument(doc, { preview: false });
        }
        return;
      }

      case 'reorderStep':
        await this.reorderStep(
          String(msg.pipelineId ?? ''),
          Number(msg.fromIdx ?? -1),
          Number(msg.toIdx ?? -1),
        );
        return;

      case 'addStepToPipeline':
        await this.addStepToPipeline(String(msg.pipelineId ?? ''));
        return;

      case 'deleteStep':
        await this.deleteStep(
          String(msg.pipelineId ?? ''),
          Number(msg.idx ?? -1),
        );
        return;

      case 'editStepConfig':
        await this.editStepConfig(
          String(msg.pipelineId ?? ''),
          Number(msg.idx ?? -1),
        );
        return;

      case 'deleteAgent':
        await this.deleteItem('agents', String(msg.id ?? ''));
        return;

      case 'deleteSkill':
        await this.deleteItem('skills', String(msg.id ?? ''));
        return;

      case 'deletePipeline':
        await this.deleteItem('pipelines', String(msg.id ?? ''));
        return;

      case 'togglePipelineFailure':
        await this.togglePipelineFailure(String(msg.pipelineId ?? ''));
        return;

      case 'runPipeline':
        await vscode.commands.executeCommand(
          'aidlc.startPipelineRun',
          String(msg.pipelineId ?? ''),
        );
        return;
    }
  }

  // ── Mutations ───────────────────────────────────────────────────────

  private getRootOrWarn(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void vscode.window.showWarningMessage('AIDLC: no folder open.');
      return undefined;
    }
    return root;
  }

  private mutateYaml(fn: (doc: YamlDocument) => boolean | void): void {
    const root = this.getRootOrWarn();
    if (!root) { return; }
    const doc = readYaml(root);
    if (!doc) {
      void vscode.window.showWarningMessage('AIDLC: no workspace.yaml — initialize first.');
      return;
    }
    const dirty = fn(doc);
    if (dirty !== false) {
      writeYaml(root, doc);
      this.refresh();
    }
  }

  private async reorderStep(pipelineId: string, fromIdx: number, toIdx: number): Promise<void> {
    if (!pipelineId || fromIdx < 0 || toIdx < 0) { return; }
    this.mutateYaml((doc) => {
      const p = doc.pipelines.find((x) => x.id === pipelineId);
      if (!p || !Array.isArray(p.steps)) { return false; }
      const steps = p.steps as string[];
      if (fromIdx >= steps.length || toIdx >= steps.length) { return false; }
      const [moved] = steps.splice(fromIdx, 1);
      steps.splice(toIdx, 0, moved);
    });
  }

  private async deleteStep(pipelineId: string, idx: number): Promise<void> {
    if (!pipelineId || idx < 0) { return; }
    this.mutateYaml((doc) => {
      const p = doc.pipelines.find((x) => x.id === pipelineId);
      if (!p || !Array.isArray(p.steps)) { return false; }
      (p.steps as string[]).splice(idx, 1);
    });
  }

  /**
   * Append a step to an existing pipeline. QuickPick from declared agents
   * (already-in-pipeline ones are flagged in the detail line, but still
   * pickable so the user can intentionally add a duplicate).
   */
  /**
   * Open the step-config wizard for an existing step. Pre-fills each prompt
   * with the step's current values. Writes back as object form so all the
   * gates (human_review / auto_review / requires / produces / enabled) are
   * persisted — even if the step was originally a bare string.
   */
  private async editStepConfig(pipelineId: string, idx: number): Promise<void> {
    if (!pipelineId || idx < 0) { return; }
    const root = this.getRootOrWarn();
    if (!root) { return; }
    const doc = readYaml(root);
    if (!doc) { return; }

    const pipeline = doc.pipelines.find((x) => x.id === pipelineId);
    if (!pipeline || !Array.isArray(pipeline.steps) || idx >= pipeline.steps.length) {
      void vscode.window.showWarningMessage(`Step #${idx + 1} not found in \`${pipelineId}\`.`);
      return;
    }

    const raw = pipeline.steps[idx] as PipelineStepConfig;
    const norm = normalizeStep(raw);
    const draft = await promptStepConfig(norm.agent, {
      enabled: norm.enabled,
      requires: norm.requires,
      produces: norm.produces,
      human_review: norm.human_review,
      auto_review: norm.auto_review,
      auto_review_runner: norm.auto_review_runner,
    });
    if (!draft) { return; }

    this.mutateYaml((d) => {
      const p = d.pipelines.find((x) => x.id === pipelineId);
      if (!p || !Array.isArray(p.steps) || idx >= p.steps.length) { return false; }
      // Always persist as object form. Stripping `name` (we don't prompt for
      // it) is intentional — the schema treats it as optional display-only.
      const obj: Record<string, unknown> = {
        agent: draft.agent,
        enabled: draft.enabled,
        requires: draft.requires,
        produces: draft.produces,
        human_review: draft.human_review,
        auto_review: draft.auto_review,
      };
      if (draft.auto_review && draft.auto_review_runner) {
        obj.auto_review_runner = draft.auto_review_runner;
      }
      p.steps[idx] = obj;
    });
  }

  private async addStepToPipeline(pipelineId: string): Promise<void> {
    if (!pipelineId) { return; }
    const root = this.getRootOrWarn();
    if (!root) { return; }
    const doc = readYaml(root);
    if (!doc) { return; }

    if (doc.agents.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'No agents declared yet — add one before chaining steps.',
        'Add Agent',
      );
      if (choice === 'Add Agent') {
        await vscode.commands.executeCommand('aidlc.addAgent');
      }
      return;
    }

    const pipeline = doc.pipelines.find((x) => x.id === pipelineId);
    if (!pipeline) { return; }
    const currentSteps = Array.isArray(pipeline.steps)
      ? pipeline.steps.map(stepAgentId)
      : [];

    const picked = await vscode.window.showQuickPick(
      doc.agents.map((a) => {
        const id = String(a.id);
        const name = typeof a.name === 'string' ? a.name : id;
        const inPipeline = currentSteps.includes(id);
        return {
          label: id,
          description: name,
          detail: inPipeline ? '· already in pipeline (will duplicate)' : '',
          id,
        };
      }),
      { placeHolder: `Append a step to \`${pipelineId}\``, ignoreFocusOut: true, matchOnDetail: true },
    );
    if (!picked) { return; }

    this.mutateYaml((d) => {
      const p = d.pipelines.find((x) => x.id === pipelineId);
      if (!p) { return false; }
      const steps = Array.isArray(p.steps) ? (p.steps as string[]) : [];
      steps.push(picked.id);
      p.steps = steps;
    });
  }

  private async deleteItem(field: 'agents' | 'skills' | 'pipelines', id: string): Promise<void> {
    if (!id) { return; }
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${field.replace(/s$/, '')} \`${id}\`?`,
      { modal: false },
      'Delete', 'Cancel',
    );
    if (confirm !== 'Delete') { return; }
    this.mutateYaml((doc) => {
      const arr = doc[field];
      if (!Array.isArray(arr)) { return false; }
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) { return false; }
      arr.splice(idx, 1);
    });
  }

  private async togglePipelineFailure(pipelineId: string): Promise<void> {
    if (!pipelineId) { return; }
    this.mutateYaml((doc) => {
      const p = doc.pipelines.find((x) => x.id === pipelineId);
      if (!p) { return false; }
      p.on_failure = p.on_failure === 'continue' ? 'stop' : 'continue';
    });
  }

  // ── HTML ────────────────────────────────────────────────────────────

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
<title>AIDLC Builder</title>
<style>${BUILDER_CSS}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">
window.BRAND_ICON_URI = ${JSON.stringify(iconUri)};
${BUILDER_JS}
</script>
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

const BUILDER_CSS = `
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
  padding: 20px 24px 40px;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; }
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
.btn-ghost { background: transparent; }
.btn-icon {
  width: 24px; height: 24px;
  display: grid; place-items: center;
  font-size: 11px;
  padding: 0;
  border-radius: 6px;
  text-transform: none;
}

.tabs {
  display: flex; gap: 2px;
  border-bottom: 1px solid var(--hairline);
  margin-bottom: 16px;
}
.tab {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all .12s ease;
  margin-bottom: -1px;
}
.tab:hover { color: var(--accent); }
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.tab-count {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--glass);
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0;
}
.tab.active .tab-count {
  background: rgba(94,234,212,0.16);
  border-color: rgba(94,234,212,0.34);
  color: var(--accent);
}

.section { margin-bottom: 20px; }
.section-head {
  display: flex; align-items: center; gap: 10px;
  padding-bottom: 6px; margin-bottom: 8px;
  border-bottom: 1px solid var(--hairline);
}
.section-head h2 {
  font-size: 10.5px; font-weight: 700; letter-spacing: 1.3px;
  text-transform: uppercase; color: var(--text-faint);
}
.section-count {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 9.5px;
  color: var(--text-muted);
  padding: 1px 7px;
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: 999px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}
.card {
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 9px 12px;
  display: flex; flex-direction: column; gap: 4px;
  cursor: pointer;
  transition: all .12s ease;
  position: relative;
}
.card:hover { border-color: var(--glass-border); background: var(--glass-strong); }
.card-head { display: flex; align-items: baseline; gap: 6px; }
.card-id {
  font-size: 11.5px; font-weight: 700;
  color: var(--accent); letter-spacing: 0.3px;
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-meta {
  font-size: 10px; color: var(--text-soft);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 1px; }
.tag {
  font-size: 8.5px; font-weight: 700; letter-spacing: 0.4px;
  padding: 1.5px 6px; border-radius: 999px; text-transform: uppercase;
  border: 1px solid transparent;
}
.tag-skill { background: rgba(94,234,212,0.12); color: var(--accent); border-color: rgba(94,234,212,0.24); }
.tag-model { background: rgba(255,255,255,0.06); color: var(--text-soft); border-color: rgba(255,255,255,0.10); }
.tag-runner-custom { background: rgba(236,164,184,0.14); color: var(--accent-3); border-color: rgba(236,164,184,0.30); }
.tag-builtin { background: rgba(155,109,255,0.14); color: #c4a4d4; border-color: rgba(155,109,255,0.30); }
.tag-missing { background: rgba(248,113,113,0.14); color: var(--rejected); border-color: rgba(248,113,113,0.30); }
.tag-env { background: rgba(251,191,36,0.12); color: var(--warn); border-color: rgba(251,191,36,0.28); }

/* ── Scope groups (skills + agents tabs) ─────────────────────────── */

.scope-group {
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: rgba(255,255,255,0.015);
}
.scope-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--hairline);
  cursor: pointer;
  user-select: none;
}
.scope-head:hover { border-bottom-color: var(--glass-border); }
.scope-chevron {
  display: inline-block;
  font-size: 10px;
  color: var(--text-soft);
  width: 12px; text-align: center;
  transition: transform .15s ease;
  transform: rotate(0deg);
}
.scope-group.is-collapsed .scope-head {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}
.scope-group.is-collapsed .scope-chevron { transform: rotate(-90deg); }
.scope-group.is-collapsed { padding-bottom: 4px; }
.scope-icon { font-size: 14px; }
.scope-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text);
}
.scope-count {
  font-size: 9.5px; font-weight: 700;
  padding: 1px 7px; border-radius: 999px;
  background: var(--glass);
  color: var(--text-soft);
  font-variant-numeric: tabular-nums;
}
.scope-sub {
  margin-left: auto;
  font-size: 10px; color: var(--text-faint);
  font-style: italic;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0;
}
.scope-empty {
  font-size: 10.5px; color: var(--text-faint);
  padding: 8px 4px;
  font-style: italic;
}
.scope-project .scope-icon { color: #5eead4; }
.scope-aidlc   .scope-icon { color: #c4a4d4; }
.scope-global  .scope-icon { color: #fbbf24; }

/* Per-card scope badge — sits next to the id in the card head. */
.scope-badge {
  margin-left: auto;
  font-size: 8.5px; font-weight: 700; letter-spacing: 0.5px;
  padding: 1.5px 6px; border-radius: 999px;
  text-transform: uppercase;
  border: 1px solid transparent;
}
.scope-badge-project  { background: rgba(94,234,212,0.10); color: var(--accent);   border-color: rgba(94,234,212,0.24); }
.scope-badge-aidlc    { background: rgba(155,109,255,0.10); color: #c4a4d4;        border-color: rgba(155,109,255,0.26); }
.scope-badge-global   { background: rgba(251,191,36,0.10); color: var(--warn);    border-color: rgba(251,191,36,0.26); }
.scope-badge-overridden {
  background: rgba(248,113,113,0.10);
  color: var(--rejected);
  border-color: rgba(248,113,113,0.30);
}
.card-overridden { opacity: 0.55; }
.card-overridden:hover { opacity: 0.85; }

.card-caps {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  display: flex; flex-wrap: wrap; gap: 3px;
}
.cap {
  font-size: 9px;
  padding: 1.5px 6px;
  border-radius: 999px;
  background: rgba(155,109,255,0.10);
  color: #c4a4d4;
  border: 1px solid rgba(155,109,255,0.22);
  letter-spacing: 0.1px;
}

/* Epics */
.epic-card {
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all .12s ease;
}
.epic-card:hover {
  border-color: var(--glass-border);
  background: var(--glass-strong);
}
.epic-card-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 6px;
}
.epic-id {
  font-size: 12px; font-weight: 700;
  color: var(--accent);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.4px;
}
.epic-title {
  font-size: 12px; color: var(--text);
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.epic-pill {
  font-size: 9px; font-weight: 700;
  padding: 3px 9px; border-radius: 999px;
  letter-spacing: 0.5px; text-transform: uppercase;
  border: 1px solid transparent;
}
.pill-pending  { background: rgba(255,255,255,0.06); color: var(--text-soft); border-color: rgba(255,255,255,0.10); }
.pill-progress { background: rgba(251,191,36,0.14); color: var(--warn); border-color: rgba(251,191,36,0.30); }
.pill-done     { background: rgba(61,255,160,0.12); color: var(--done); border-color: rgba(61,255,160,0.28); }
.pill-failed   { background: rgba(248,113,113,0.14); color: var(--rejected); border-color: rgba(248,113,113,0.30); }

.epic-desc {
  font-size: 11px; color: var(--text-soft);
  margin-bottom: 8px;
  line-height: 1.45;
}
.epic-dots {
  display: flex; align-items: center; gap: 4px;
  margin-bottom: 6px;
}
.epic-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: rgba(255,255,255,0.12);
  transition: all .12s ease;
}
.dot-pending  { background: rgba(255,255,255,0.12); }
.dot-progress { background: var(--warn); box-shadow: 0 0 6px rgba(251,191,36,0.5); }
.dot-done     { background: var(--done); }
.dot-failed   { background: var(--rejected); }
.dot-current  { transform: scale(1.4); }

.epic-step-label {
  font-size: 10px; color: var(--text-faint);
  margin-left: 6px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.epic-meta {
  display: flex; gap: 4px; flex-wrap: wrap;
  font-size: 10px; color: var(--text-faint);
}
.epic-meta strong { color: var(--text-soft); font-weight: 600; }

.card-actions {
  position: absolute; top: 8px; right: 8px;
  display: none; gap: 4px;
}
.card:hover .card-actions { display: flex; }

.empty {
  padding: 22px 18px;
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(94,234,212,0.04), rgba(255,255,255,0.02));
  text-align: center;
  font-size: 12px;
  color: var(--text-soft);
}
.empty p { margin-bottom: 10px; }

.workflow {
  background: var(--glass);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
}
.workflow:hover { border-color: var(--glass-border); }
.workflow-head {
  display: flex; align-items: center; gap: 10px;
  padding-bottom: 7px; margin-bottom: 7px;
  border-bottom: 1px solid var(--hairline);
}
.workflow-id {
  font-size: 12px; font-weight: 700; color: var(--accent);
}
.workflow-meta { font-size: 10px; color: var(--text-faint); margin-left: 4px; }
.failure-toggle {
  font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
  padding: 3px 9px; border-radius: 999px; text-transform: uppercase;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  margin-left: 8px;
}
.failure-stop { color: var(--warn); border-color: rgba(251,191,36,0.30); background: rgba(251,191,36,0.10); }
.failure-continue { color: var(--text-soft); border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04); }
.workflow-run {
  font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
  padding: 3px 9px; border-radius: 999px; text-transform: uppercase;
  cursor: pointer;
  border: 1px solid rgba(94,234,212,0.35);
  background: rgba(94,234,212,0.10);
  color: var(--accent);
  font-family: inherit;
  margin-left: 8px;
}
.workflow-run:hover { background: rgba(94,234,212,0.18); border-color: rgba(94,234,212,0.55); }

/* Mermaid-style flowchart — horizontal LR layout, scroll-x when wide.
 * Horizontal saves vertical space for long pipelines (9+ steps fit
 * without becoming a tall scroll-wall). */
.flowchart {
  display: flex; flex-direction: row; align-items: center;
  padding: 14px 4px 6px;
  overflow-x: auto;
  gap: 0;
}
.flow-node {
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
  min-width: 150px;
  max-width: 240px;
  padding: 9px 12px;
  background: linear-gradient(135deg, rgba(94,234,212,0.06), rgba(255,255,255,0.02));
  border: 1.5px solid rgba(94,234,212,0.22);
  border-radius: 10px;
  position: relative;
  transition: all .15s ease;
  box-shadow: 0 2px 10px rgba(0,0,0,0.18);
}
.flow-node-row { display: flex; align-items: center; gap: 8px; }
.flow-node:hover {
  border-color: rgba(94,234,212,0.45);
  background: linear-gradient(135deg, rgba(94,234,212,0.10), rgba(255,255,255,0.04));
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(94,234,212,0.18);
  z-index: 2;
}
.flow-node-disabled {
  opacity: 0.55;
  border-style: dashed;
}
.flow-node-badges {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-top: 2px;
}
.step-badge {
  font-size: 9.5px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  letter-spacing: 0.2px;
  white-space: nowrap;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.step-badge-human    { color: #fbbf24; background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.30); }
.step-badge-auto     { color: #93c5fd; background: rgba(147,197,253,0.12); border-color: rgba(147,197,253,0.30); }
.step-badge-requires { color: var(--text-soft); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.10); }
.step-badge-produces { color: var(--text-soft); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.10); }
.step-badge-disabled { color: var(--text-faint); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15); }
.flow-num {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 9.5px;
  color: var(--text-faint);
  width: 14px;
  flex-shrink: 0;
}
.flow-id {
  flex: 1; min-width: 0;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flow-actions {
  display: flex; gap: 2px;
  opacity: 0;
  transition: opacity .12s ease;
  flex-shrink: 0;
}
.flow-node:hover .flow-actions { opacity: 1; }
.flow-actions .btn-icon {
  width: 20px; height: 20px;
  font-size: 9.5px;
  border-radius: 4px;
}

/* Horizontal arrow connector between nodes. */
.flow-edge {
  width: 24px;
  height: 2px;
  background: linear-gradient(90deg, rgba(94,234,212,0.55) 0%, rgba(94,234,212,0.20) 100%);
  position: relative;
  flex-shrink: 0;
  margin: 0 2px;
  border-radius: 2px;
}
.flow-edge::after {
  content: '';
  position: absolute;
  right: -1px;
  top: 50%;
  transform: translateY(-50%);
  width: 0; height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid rgba(94,234,212,0.45);
}

/* Trailing "+ add step" button. Sits at the end of the flow row;
 * dashed circle so it reads as an action target rather than a node. */
.flow-add-btn {
  flex-shrink: 0;
  display: grid; place-items: center;
  width: 32px; height: 32px;
  background: rgba(94,234,212,0.04);
  border: 1.5px dashed rgba(94,234,212,0.32);
  border-radius: 50%;
  color: var(--accent);
  font-size: 16px; font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all .15s ease;
  margin-left: 4px;
}
.flow-add-btn:hover {
  background: rgba(94,234,212,0.16);
  border-color: rgba(94,234,212,0.55);
  border-style: solid;
  transform: scale(1.10);
  box-shadow: 0 0 14px rgba(94,234,212,0.25);
}
.step-num {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px; color: var(--text-faint);
  width: 18px; flex-shrink: 0;
}
.step-id {
  flex: 1;
  font-size: 12px; color: var(--text);
  font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.step-arrow {
  font-size: 14px; color: var(--text-faint);
  margin-left: 4px; margin-right: -4px;
}
.step-actions { display: flex; gap: 4px; }

.footer-help {
  margin-top: 32px;
  padding: 14px 16px;
  font-size: 11px; color: var(--text-faint);
  text-align: center;
  border-top: 1px solid var(--hairline);
}
.footer-help a {
  color: var(--text-soft);
  cursor: pointer;
  text-decoration: none;
}
.footer-help a:hover { color: var(--accent); }
`;

const BUILDER_JS = `
const vscode = acquireVsCodeApi();
let state = null;
/** Persisted across panel hide/show + soft reloads via vscode.setState. */
const persisted = vscode.getState() || {};
let activeTab = persisted.activeTab || 'workflows';
/** Set of "kind:scope" keys (e.g. "agent:project") whose body is hidden. */
const collapsedScopes = new Set(Array.isArray(persisted.collapsedScopes) ? persisted.collapsedScopes : []);

function persistUiState() {
  vscode.setState({
    ...(vscode.getState() || {}),
    activeTab,
    collapsedScopes: Array.from(collapsedScopes),
  });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'state') {
    state = msg.state || {};
    // Defensive backfill so .length on undefined never throws and keeps
    // an old webview HTML alive when the extension adds new state fields.
    if (!Array.isArray(state.agents)) state.agents = [];
    if (!Array.isArray(state.skills)) state.skills = [];
    if (!Array.isArray(state.pipelines)) state.pipelines = [];
    if (!Array.isArray(state.epics)) state.epics = [];
    try {
      render();
    } catch (err) {
      console.error('[AIDLC Builder] render failed:', err);
    }
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
    root.innerHTML = '<div style="padding:60px 24px; text-align:center; color:rgba(255,255,255,0.45); font-size:13px;">Loading workspace…<br><span style="font-size:11px; opacity:0.7;">(if this stays for &gt;15s, another VS Code extension may be blocking activation — try disabling unused extensions and reload)</span></div>';
    return;
  }

  let html = '';
  html += renderHeader();

  if (!state.workspaceRoot) {
    html += renderNoFolder();
  } else if (!state.configExists) {
    html += renderNoConfig();
  } else {
    html += renderTabs();
    if (activeTab === 'workflows') { html += renderWorkflows(); }
    else if (activeTab === 'agents') { html += renderAgents(); }
    else if (activeTab === 'skills') { html += renderSkills(); }
    else if (activeTab === 'epics') { html += renderEpics(); }
    else { activeTab = 'workflows'; html += renderWorkflows(); }
  }

  html += renderFooter();
  root.innerHTML = html;
}

function renderHeader() {
  let html = '<div class="header">';
  html += '<div class="brand">';
  html += '<img class="brand-mark" src="' + escapeHtml(window.BRAND_ICON_URI || '') + '" alt="AIDLC" />';
  html += '<div class="brand-meta">';
  html += '<div class="brand-title">AIDLC Builder</div>';
  html += '<div class="brand-sub">Workspace · Agents · Skills · Pipelines</div>';
  html += '</div></div>';

  html += '<div class="project-pill">';
  html += '<span class="label">Project</span>';
  html += '<strong>' + escapeHtml(state.workspaceName) + '</strong>';
  html += '</div>';

  html += '<div class="spacer"></div>';

  if (state.workspaceRoot && state.configExists) {
    html += '<button class="btn btn-primary" data-action="startEpic" title="Start a new run of a pipeline (or single agent) bound to project-specific values">▶ Start Epic</button>';
    html += '<button class="btn btn-ghost" data-action="applyPreset" title="Replace this workspace with a saved or built-in template (e.g. SDLC Pipeline)">Load Template</button>';
    html += '<button class="btn btn-ghost" data-action="savePreset" title="Save current agents/skills/pipelines as a reusable template">Save Template</button>';
    html += '<button class="btn btn-ghost" data-action="openYaml">Open YAML</button>';
  }
  html += '<button class="btn btn-ghost" data-action="switchProject">Switch Project</button>';
  html += '<button class="btn btn-ghost" data-action="openClaude">Claude CLI</button>';
  html += '</div>';
  return html;
}

function renderNoFolder() {
  return '<div class="empty"><p><strong>No folder open.</strong></p>' +
    '<p>Pick a project to manage its AIDLC workspace.</p>' +
    '<button class="btn btn-primary" data-action="switchProject">Open Folder…</button></div>';
}

function renderNoConfig() {
  return '<div class="empty">' +
    '<p><strong>No .aidlc/workspace.yaml in this project yet.</strong></p>' +
    '<p>Start from a sample workspace, or load a template (built-in or saved earlier).</p>' +
    '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:6px;">' +
    '<button class="btn btn-primary" data-action="init">Init Sample Workspace</button>' +
    '<button class="btn btn-ghost" data-action="applyPreset">Load Template</button>' +
    '</div></div>';
}

function renderTabs() {
  const tabs = [
    { id: 'workflows', label: 'Workflows', count: state.pipelines.length },
    { id: 'agents',    label: 'Agents',    count: state.agents.length },
    { id: 'skills',    label: 'Skills',    count: state.skills.length },
    { id: 'epics',     label: 'Epics',     count: state.epics.length },
  ];
  let html = '<nav class="tabs">';
  for (const t of tabs) {
    const cls = activeTab === t.id ? 'tab active' : 'tab';
    html += '<button class="' + cls + '" data-action="setTab" data-tab="' + escapeHtml(t.id) + '">';
    html += '<span class="tab-label">' + escapeHtml(t.label) + '</span>';
    html += '<span class="tab-count">' + t.count + '</span>';
    html += '</button>';
  }
  html += '</nav>';
  return html;
}

// Per-scope display metadata, used by the section header to explain to
// the user what each scope means (mirrors the wizard's scope picker copy
// — keep them aligned when editing).
const SCOPE_INFO = {
  project: {
    label: 'Project',
    icon: '📂',
    sub: '.claude/ — committed to this repo, applies to this project only',
  },
  aidlc: {
    label: 'AIDLC',
    icon: '📦',
    sub: '.aidlc/ — committed to this repo, declared in workspace.yaml, shared with the team',
  },
  global: {
    label: 'Global',
    icon: '🏠',
    sub: '~/.claude/ — your personal assets, available on every project on this machine',
  },
};

const SCOPE_ORDER = ['project', 'aidlc', 'global'];

function renderAgents() {
  return renderAssetTab('agent', state.agents);
}

function renderSkills() {
  return renderAssetTab('skill', state.skills);
}

/**
 * Unified renderer for the Skills + Agents tabs. Splits rows into 3 scope
 * groups (project / aidlc / global) and emits a sub-section per scope so
 * the user can see at a glance which assets are shared via repo, AIDLC,
 * or their home dir. Empty scope groups still render with a hint
 * explaining how to fill them — discoverability matters more than
 * compactness here.
 */
function renderAssetTab(kind, rows) {
  const noun = kind === 'agent' ? 'Agents' : 'Skills';
  const addAction = kind === 'agent' ? 'addAgent' : 'addSkill';

  let html = '<section class="section">';
  html += '<div class="section-head">';
  html += '<h2>' + noun + '</h2>';
  html += '<span class="section-count">' + rows.length + '</span>';
  html += '<div class="spacer"></div>';
  html += '<button class="btn btn-primary" data-action="' + addAction + '">+ Add ' + (kind === 'agent' ? 'Agent' : 'Skill') + '</button>';
  html += '</div>';

  for (const scope of SCOPE_ORDER) {
    const scopeRows = rows.filter(function(r) { return r.scope === scope; });
    html += renderScopeGroup(kind, scope, scopeRows);
  }

  html += '</section>';
  return html;
}

function renderScopeGroup(kind, scope, rows) {
  const info = SCOPE_INFO[scope];
  const collapsed = isScopeCollapsed(kind, scope);
  const groupCls = 'scope-group scope-' + scope + (collapsed ? ' is-collapsed' : '');
  let html = '<div class="' + groupCls + '">';
  html += '<div class="scope-head" data-action="toggleScope" data-kind="' + kind + '" data-scope="' + scope + '" title="' + (collapsed ? 'Expand' : 'Collapse') + '">';
  html += '<span class="scope-chevron" aria-hidden="true">▾</span>';
  html += '<span class="scope-icon">' + info.icon + '</span>';
  html += '<span class="scope-label">' + info.label + '</span>';
  html += '<span class="scope-count">' + rows.length + '</span>';
  html += '<span class="scope-sub">' + escapeHtml(info.sub) + '</span>';
  html += '</div>';

  if (!collapsed) {
    if (rows.length === 0) {
      html += '<div class="scope-empty">No ' + (kind === 'agent' ? 'agents' : 'skills') + ' here yet.</div>';
    } else {
      html += '<div class="cards">';
      for (const r of rows) {
        html += kind === 'agent' ? renderAgentCard(r) : renderSkillCard(r);
      }
      html += '</div>';
    }
  }

  html += '</div>';
  return html;
}

function isScopeCollapsed(kind, scope) {
  return collapsedScopes.has(kind + ':' + scope);
}

// Map well-known capability ids to their display icon. Unknown ids fall
// back to a generic plug icon — keeps custom capabilities legible.
const CAPABILITY_ICON = {
  'jira': '🎫',
  'figma': '🎨',
  'core-business': '📚',
  'github': '🐙',
  'slack': '💬',
  'files': '📁',
  'web': '🌐',
};

function capabilityIcon(id) {
  return CAPABILITY_ICON[id] || '🔌';
}

function renderAgentCard(a) {
  // AIDLC agents have rich metadata (skill / model / capabilities) and
  // open the YAML; project + global agents are .md files we open
  // directly. The two card layouts share an outer shell + scope badge
  // but diverge on body content.
  const isAidlc = a.scope === 'aidlc';
  const clickAction = isAidlc
    ? ' data-action="openYaml"'
    : (a.filePath ? ' data-action="openAgent" data-path="' + escapeHtml(a.filePath) + '"' : '');
  const titleAttr = isAidlc
    ? ''
    : (a.filePath ? ' title="Click to open .md file"' : '');

  let html = '<div class="card' + (a.overridden ? ' card-overridden' : '') + '"' + clickAction + titleAttr + '>';
  html += '<div class="card-actions">';
  if (isAidlc) {
    // Only AIDLC agents are deletable from this UI today — they live in
    // workspace.yaml. Project + global agent files require explicit file
    // delete (do that from the explorer for now to avoid surprises).
    html += '<button class="btn btn-icon btn-ghost" data-action="deleteAgent" data-id="' + escapeHtml(a.id) + '" title="Delete from workspace.yaml">×</button>';
  }
  html += '</div>';
  html += '<div class="card-head"><span class="card-id">' + escapeHtml(a.id) + '</span>';
  html += renderScopeBadge(a);
  html += '</div>';

  if (isAidlc && a.aidlcMeta) {
    const m = a.aidlcMeta;
    html += '<div class="card-meta">' + escapeHtml(m.name || a.id) + '</div>';
    html += '<div class="card-tags">';
    if (m.skill) { html += '<span class="tag tag-skill">' + escapeHtml(m.skill) + '</span>'; }
    if (m.model) { html += '<span class="tag tag-model">' + escapeHtml(m.model) + '</span>'; }
    if (m.runner === 'custom') { html += '<span class="tag tag-runner-custom">custom runner</span>'; }
    if (m.envCount && m.envCount > 0) { html += '<span class="tag tag-env">env: ' + m.envCount + '</span>'; }
    html += '</div>';
    if (m.capabilities && m.capabilities.length > 0) {
      html += '<div class="card-caps">';
      for (const cap of m.capabilities) {
        html += '<span class="cap" title="capability: ' + escapeHtml(cap) + '">' + capabilityIcon(cap) + ' ' + escapeHtml(cap) + '</span>';
      }
      html += '</div>';
    }
  } else {
    // Claude Code native agents: just the file path. The .md is the agent.
    html += '<div class="card-meta">' + escapeHtml(a.filePath || '') + '</div>';
  }

  html += '</div>';
  return html;
}

function renderSkillCard(s) {
  const meta = s.aidlcMeta || {};
  const clickable = !!(s.filePath && !s.fileMissing);
  const action = clickable ? ' data-action="openSkill" data-path="' + escapeHtml(s.filePath) + '"' : '';
  let html = '<div class="card' + (s.overridden ? ' card-overridden' : '') + '"' + action + ' title="' + (clickable ? 'Click to open .md file' : '') + '">';
  html += '<div class="card-actions">';
  if (s.scope === 'aidlc') {
    html += '<button class="btn btn-icon btn-ghost" data-action="deleteSkill" data-id="' + escapeHtml(s.id) + '" title="Delete from workspace.yaml (file kept on disk)">×</button>';
  }
  html += '</div>';
  html += '<div class="card-head"><span class="card-id">' + escapeHtml(s.id) + '</span>';
  html += renderScopeBadge(s);
  html += '</div>';
  html += '<div class="card-meta">' + escapeHtml(s.filePath || '(builtin)') + '</div>';
  html += '<div class="card-tags">';
  if (meta.builtin) { html += '<span class="tag tag-builtin">builtin</span>'; }
  if (s.fileMissing) { html += '<span class="tag tag-missing">file missing</span>'; }
  html += '</div></div>';
  return html;
}

/**
 * Small badge that appears in the card header. For non-overridden rows
 * we show a discreet scope tag; for overridden rows we replace it with a
 * louder warning so the user knows another scope is shadowing this one.
 */
function renderScopeBadge(r) {
  if (r.overridden && r.overriddenBy) {
    return '<span class="scope-badge scope-badge-overridden" title="Overridden by ' + escapeHtml(r.overriddenBy) + ' scope — this entry is shadowed.">overridden by ' + escapeHtml(r.overriddenBy) + '</span>';
  }
  return '<span class="scope-badge scope-badge-' + escapeHtml(r.scope) + '">' + escapeHtml(r.scope) + '</span>';
}

function renderWorkflows() {
  let html = '<section class="section">';
  html += '<div class="section-head">';
  html += '<h2>Workflows</h2>';
  html += '<span class="section-count">' + state.pipelines.length + '</span>';
  html += '<div class="spacer"></div>';
  html += '<button class="btn btn-primary" data-action="addPipeline">+ New Workflow</button>';
  html += '</div>';

  if (state.pipelines.length === 0) {
    html += '<div class="empty"><p>No workflows yet — chain 2+ agents into a pipeline.</p>';
    html += '<button class="btn btn-primary" data-action="addPipeline">+ New Workflow</button></div>';
  } else {
    for (const p of state.pipelines) { html += renderWorkflow(p); }
  }
  html += '</section>';
  return html;
}

function renderWorkflow(p) {
  let html = '<div class="workflow">';
  html += '<div class="workflow-head">';
  html += '<div class="workflow-id">' + escapeHtml(p.id) + '</div>';
  html += '<div class="workflow-meta">' + p.steps.length + ' steps</div>';
  html += '<div class="spacer"></div>';
  const failureCls = p.on_failure === 'continue' ? 'failure-continue' : 'failure-stop';
  html += '<button class="workflow-run" data-action="runPipeline" data-pipeline-id="' + escapeHtml(p.id) + '" title="Start a pipeline run for this workflow">▶ Run</button>';
  html += '<button class="failure-toggle ' + failureCls + '" data-action="togglePipelineFailure" data-pipeline-id="' + escapeHtml(p.id) + '" title="Click to toggle">on_failure: ' + p.on_failure + '</button>';
  html += '<button class="btn btn-icon btn-ghost" data-action="deletePipeline" data-id="' + escapeHtml(p.id) + '" title="Delete workflow">×</button>';
  html += '</div>';

  html += '<div class="flowchart">';
  for (let i = 0; i < p.steps.length; i++) {
    html += renderFlowNode(p.id, p.steps[i], i, p.steps.length);
    if (i < p.steps.length - 1 || true) {
      html += '<div class="flow-edge"></div>';
    }
  }
  // Trailing "+ add step" button — sits at the end of the chain.
  html += '<button class="flow-add-btn" data-action="addStepToPipeline" data-pipeline-id="' + escapeHtml(p.id) + '" title="Append a step to this workflow">+</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderFlowNode(pipelineId, step, idx, total) {
  const disabledCls = step.enabled ? '' : ' flow-node-disabled';
  let html = '<div class="flow-node' + disabledCls + '">';

  // Top row: number + agent id + config/reorder/delete actions.
  html += '<div class="flow-node-row">';
  html += '<span class="flow-num">' + (idx + 1) + '</span>';
  html += '<span class="flow-id">' + escapeHtml(step.agent) + '</span>';
  html += '<div class="flow-actions">';
  html += '<button class="btn btn-icon btn-ghost" data-action="editStepConfig" data-pipeline-id="' + escapeHtml(pipelineId) + '" data-idx="' + idx + '" title="Configure step (human review, auto review, requires, produces)">⚙</button>';
  if (idx > 0) {
    html += '<button class="btn btn-icon btn-ghost" data-action="reorderStep" data-pipeline-id="' + escapeHtml(pipelineId) + '" data-from="' + idx + '" data-to="' + (idx - 1) + '" title="Move up">↑</button>';
  }
  if (idx < total - 1) {
    html += '<button class="btn btn-icon btn-ghost" data-action="reorderStep" data-pipeline-id="' + escapeHtml(pipelineId) + '" data-from="' + idx + '" data-to="' + (idx + 1) + '" title="Move down">↓</button>';
  }
  html += '<button class="btn btn-icon btn-ghost" data-action="deleteStep" data-pipeline-id="' + escapeHtml(pipelineId) + '" data-idx="' + idx + '" title="Remove from workflow">×</button>';
  html += '</div>';
  html += '</div>';

  // Gate badges — surface what the runner will do AFTER this step's
  // produces validate. Without these, the only way for a user to see the
  // step's gates is to open the YAML by hand.
  const badges = [];
  if (!step.enabled) {
    badges.push('<span class="step-badge step-badge-disabled" title="enabled: false — runner skips this step">disabled</span>');
  }
  if (step.requiresCount > 0) {
    badges.push('<span class="step-badge step-badge-requires" title="' + step.requiresCount + ' upstream artifact path(s) the step is gated on (requires)">⤴ ' + step.requiresCount + ' req</span>');
  }
  if (step.producesCount > 0) {
    badges.push('<span class="step-badge step-badge-produces" title="' + step.producesCount + ' artifact path(s) this step writes (produces)">⤵ ' + step.producesCount + ' out</span>');
  }
  if (step.autoReview) {
    const runner = step.autoReviewRunner ? ' — runs ' + step.autoReviewRunner : '';
    badges.push('<span class="step-badge step-badge-auto" title="auto_review: true' + escapeHtml(runner) + '">🤖 auto-review</span>');
  }
  if (step.humanReview) {
    badges.push('<span class="step-badge step-badge-human" title="human_review: true — pauses for approve/reject after the step is marked done (and after auto-review, if any)">👤 human review</span>');
  }
  if (badges.length > 0) {
    html += '<div class="flow-node-badges">' + badges.join('') + '</div>';
  }

  html += '</div>';
  return html;
}

function renderEpics() {
  let html = '<section class="section">';
  html += '<div class="section-head">';
  html += '<h2>Epics</h2>';
  html += '<span class="section-count">' + state.epics.length + '</span>';
  html += '<div class="spacer"></div>';
  if (state.epics.length > 0) {
    html += '<button class="btn btn-ghost" data-action="openEpicsList" title="Open the dedicated Epics panel">Open List →</button>';
  }
  html += '<button class="btn btn-primary" data-action="startEpic">+ Start Epic</button>';
  html += '</div>';

  if (state.epics.length === 0) {
    html += '<div class="empty">' +
      '<p>No epics started yet — start one to bind agents to a Jira ticket / Figma file / etc.</p>' +
      '<button class="btn btn-primary" data-action="startEpic">+ Start Epic</button>' +
      '</div>';
  } else {
    for (const e of state.epics) { html += renderEpicCard(e); }
  }
  html += '</section>';
  return html;
}

const STATUS_DOT_CLASS = {
  pending:     'dot-pending',
  in_progress: 'dot-progress',
  done:        'dot-done',
  failed:      'dot-failed',
};

const STATUS_PILL_CLASS = {
  pending:     'pill-pending',
  in_progress: 'pill-progress',
  done:        'pill-done',
  failed:      'pill-failed',
};

function renderEpicCard(e) {
  let html = '<div class="epic-card" data-action="openEpicState" data-path="' + escapeHtml(e.statePath) + '" title="Click to open state.json">';
  html += '<div class="epic-card-head">';
  html += '<span class="epic-id">' + escapeHtml(e.id) + '</span>';
  if (e.title) { html += '<span class="epic-title">' + escapeHtml(e.title) + '</span>'; }
  html += '<div class="spacer"></div>';
  html += '<span class="epic-pill ' + (STATUS_PILL_CLASS[e.status] || 'pill-pending') + '">' + escapeHtml(e.status.replace('_', ' ')) + '</span>';
  html += '</div>';

  if (e.description) {
    html += '<div class="epic-desc">' + escapeHtml(e.description) + '</div>';
  }

  // step dots
  if (e.stepStatuses && e.stepStatuses.length > 0) {
    html += '<div class="epic-dots">';
    for (let i = 0; i < e.stepStatuses.length; i++) {
      const cls = STATUS_DOT_CLASS[e.stepStatuses[i]] || 'dot-pending';
      const cur = (i === e.currentStep && e.status === 'in_progress') ? ' dot-current' : '';
      html += '<span class="epic-dot ' + cls + cur + '" title="' + escapeHtml(e.agents[i] || '') + ': ' + escapeHtml(e.stepStatuses[i]) + '"></span>';
    }
    html += '<span class="epic-step-label">' + (e.currentStep) + '/' + e.stepStatuses.length + ' steps</span>';
    html += '</div>';
  }

  html += '<div class="epic-meta">';
  if (e.pipeline) { html += '<span>pipeline: <strong>' + escapeHtml(e.pipeline) + '</strong></span>'; }
  else if (e.agent) { html += '<span>agent: <strong>' + escapeHtml(e.agent) + '</strong></span>'; }
  if (e.inputsCount > 0) { html += '<span>· ' + e.inputsCount + ' input' + (e.inputsCount === 1 ? '' : 's') + '</span>'; }
  if (e.createdAt) {
    const date = e.createdAt.slice(0, 10);
    html += '<span>· ' + escapeHtml(date) + '</span>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderFooter() {
  return '<div class="footer-help">' +
    'Edits sync to <strong>.aidlc/workspace.yaml</strong>. Comments may be reflowed by the YAML serializer when you use buttons here. ' +
    '<a data-action="openYaml">Open file →</a></div>';
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) { return; }
  const action = target.dataset.action;

  // Stop card click bubbling when an action button inside is clicked
  if (target.tagName === 'BUTTON' || target.classList.contains('failure-toggle')) {
    e.stopPropagation();
  }

  switch (action) {
    case 'setTab': {
      const t = target.dataset.tab;
      if (t && t !== activeTab) {
        activeTab = t;
        persistUiState();
        render();
      }
      return;
    }
    case 'toggleScope': {
      const k = target.dataset.kind;
      const s = target.dataset.scope;
      if (!k || !s) { return; }
      const key = k + ':' + s;
      if (collapsedScopes.has(key)) { collapsedScopes.delete(key); }
      else { collapsedScopes.add(key); }
      persistUiState();
      render();
      return;
    }
    case 'init':                    post('init'); return;
    case 'applyPreset':             post('applyPreset'); return;
    case 'savePreset':              post('savePreset'); return;
    case 'startEpic':               post('startEpic'); return;
    case 'addAgent':                post('addAgent'); return;
    case 'addSkill':                post('addSkill'); return;
    case 'addPipeline':             post('addPipeline'); return;
    case 'switchProject':           post('switchProject'); return;
    case 'openClaude':              post('openClaude'); return;
    case 'openYaml':                post('openYaml'); return;
    case 'openSkill':               post('openSkill', { path: target.dataset.path }); return;
    case 'openEpicState':           post('openEpicState', { path: target.dataset.path }); return;
    case 'openEpicsList':           post('openEpicsList'); return;
    case 'deleteAgent':             post('deleteAgent', { id: target.dataset.id }); return;
    case 'deleteSkill':             post('deleteSkill', { id: target.dataset.id }); return;
    case 'deletePipeline':          post('deletePipeline', { id: target.dataset.id }); return;
    case 'togglePipelineFailure':   post('togglePipelineFailure', { pipelineId: target.dataset.pipelineId }); return;
    case 'runPipeline':             post('runPipeline', { pipelineId: target.dataset.pipelineId }); return;
    case 'addStepToPipeline':
      post('addStepToPipeline', { pipelineId: target.dataset.pipelineId });
      return;
    case 'reorderStep':
      post('reorderStep', {
        pipelineId: target.dataset.pipelineId,
        fromIdx: Number(target.dataset.from),
        toIdx: Number(target.dataset.to),
      });
      return;
    case 'deleteStep':
      post('deleteStep', {
        pipelineId: target.dataset.pipelineId,
        idx: Number(target.dataset.idx),
      });
      return;
    case 'editStepConfig':
      post('editStepConfig', {
        pipelineId: target.dataset.pipelineId,
        idx: Number(target.dataset.idx),
      });
      return;
  }
});

post('ready');
`;
