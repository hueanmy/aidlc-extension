/**
 * Unified Workspace webview — replaces the previous Builder + Epics panels
 * with a single React-rendered surface. The user navigates between Builder
 * and Epics views via the in-panel pill nav; the host treats both VS Code
 * commands (`aidlc.openBuilder`, `aidlc.openEpicsList`) as `show()` calls
 * with different `initialView` arguments.
 *
 * Visual rendering lives in `src/webview/workspace/main.tsx` (compiled to
 * `out/webviews/workspace.js` by vite). This file owns:
 *   - state aggregation (agents / skills / pipelines / epics)
 *   - message routing (mutation helpers + delegation to commands)
 *   - HTML shell that loads the React bundle with CSP nonce
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { readYaml, writeYaml, type YamlDocument } from './yamlIO';
import {
  WORKSPACE_DIR,
  WORKSPACE_FILENAME,
  stepAgentId,
  normalizeStep,
  discoverAssets,
  RunStateStore,
  startRun,
} from '@aidlc/core';
import type {
  PipelineStepConfig,
  AssetScope,
  DiscoveredAsset,
  PipelineConfig,
  StepStatus,
  AutoReviewVerdict,
} from '@aidlc/core';
import { promptStepConfig } from './wizards';
import { listEpics, type EpicSummary as CoreEpicSummary } from './epicsList';
import { themeManager } from './themeManager';
import { rejectStepInlineCommand, startPipelineRunInlineCommand } from './runCommands';

// ── Webview-side type shapes (must mirror src/webview/lib/types.ts) ───────

type WorkspaceView = 'builder' | 'epics';

interface AgentSummary {
  id: string;
  scope: AssetScope;
  filePath: string;
  description?: string;
  skill?: string;
  model?: string;
  integrations?: string[];
}

interface SkillSummary {
  id: string;
  scope: AssetScope;
  filePath: string;
  description?: string;
}

interface PipelineStepSummary {
  agent: string;
  name?: string;
  enabled: boolean;
  produces: string[];
  requires: string[];
  human_review: boolean;
  auto_review: boolean;
  auto_review_runner?: string;
}

interface PipelineSummary {
  id: string;
  steps: PipelineStepSummary[];
  on_failure: 'stop' | 'continue';
}

interface AgentMeta {
  name: string;
  description: string;
  inputs: string;
  outputs: string;
  artifact: string;
}

interface EpicStepDetailFull {
  agent: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  runStatus: StepStatus | null;
  isCurrentRunStep: boolean;
  rejectReason?: string;
  autoReviewVerdict?: AutoReviewVerdict;
  stepHasAutoReview: boolean;
  stepHasHumanReview: boolean;
  startedAt?: string;
  finishedAt?: string;
}

interface EpicSummaryUi {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  progress: number;
  statePath: string;
  stepDetails: EpicStepDetailFull[];
  currentStep: number;
  pipeline: string | null;
  agent: string | null;
  runId: string | null;
  inputs: Record<string, string>;
  epicDir: string;
  existingArtifacts: string[];
  createdAt: string;
}

interface WorkspaceState {
  hasFolder: boolean;
  workspaceName: string;
  configExists: boolean;
  agents: AgentSummary[];
  skills: SkillSummary[];
  pipelines: PipelineSummary[];
  epics: EpicSummaryUi[];
  agentMeta: Record<string, AgentMeta>;
  slashCommandsByAgent: Record<string, string>;
  agentsCount: number;
  skillsCount: number;
  pipelinesCount: number;
  epicsCount: number;
  /** All existing run ids (any status) — for inline Start-Run modal uniqueness check. */
  runIds: string[];
  initialView?: WorkspaceView;
}

// ── State builders ────────────────────────────────────────────────────────

function buildState(initialView: WorkspaceView): WorkspaceState {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {
      hasFolder: false,
      workspaceName: '',
      configExists: false,
      agents: [], skills: [], pipelines: [], epics: [],
      agentMeta: {}, slashCommandsByAgent: {},
      agentsCount: 0, skillsCount: 0, pipelinesCount: 0, epicsCount: 0,
      runIds: [],
      initialView,
    };
  }

  const root = folder.uri.fsPath;
  const doc = readYaml(root);
  const discovered = discoverAssets(root);

  // agent display metadata + slash commands — only AIDLC agents have these
  // since they're declared in workspace.yaml.
  const agentMeta: Record<string, AgentMeta> = {};
  const slashCommandsByAgent: Record<string, string> = {};
  if (doc) {
    for (const a of doc.agents) {
      const id = String(a.id);
      agentMeta[id] = {
        name: typeof a.name === 'string' ? a.name : id,
        description: typeof a.description === 'string' ? a.description : '',
        inputs: typeof a.inputs === 'string' ? a.inputs : '',
        outputs: typeof a.outputs === 'string' ? a.outputs : '',
        artifact: typeof a.artifact === 'string' ? a.artifact : '',
      };
    }
    for (const c of doc.slash_commands) {
      const agent = (c as { agent?: unknown }).agent;
      if (typeof c.name === 'string' && typeof agent === 'string' && !slashCommandsByAgent[agent]) {
        slashCommandsByAgent[agent] = c.name;
      }
    }
  }

  const epics = listEpics(root, doc).map((e) => toEpicSummaryUi(e));

  if (!doc) {
    const agents = mergeAgents(null, discovered.agents);
    const skills = mergeSkills(null, root, discovered.skills);
    return {
      hasFolder: true,
      workspaceName: folder.name,
      configExists: false,
      agents, skills,
      pipelines: [],
      epics,
      agentMeta, slashCommandsByAgent,
      agentsCount: agents.length,
      skillsCount: skills.length,
      pipelinesCount: 0,
      epicsCount: epics.length,
      runIds: listRunIds(root),
      initialView,
    };
  }

  const agents = mergeAgents(doc, discovered.agents);
  const skills = mergeSkills(doc, root, discovered.skills);
  const pipelines: PipelineSummary[] = doc.pipelines.map((p) => ({
    id: String(p.id),
    on_failure: p.on_failure === 'continue' ? 'continue' : 'stop',
    steps: Array.isArray(p.steps)
      ? (p.steps as PipelineStepConfig[]).map((raw) => {
          const norm = normalizeStep(raw);
          return {
            agent: norm.agent,
            name: norm.name,
            enabled: norm.enabled,
            produces: norm.produces,
            requires: norm.requires,
            human_review: norm.human_review,
            auto_review: norm.auto_review,
            auto_review_runner: norm.auto_review_runner,
          };
        })
      : [],
  }));

  return {
    hasFolder: true,
    workspaceName: folder.name,
    configExists: true,
    agents, skills, pipelines, epics,
    agentMeta, slashCommandsByAgent,
    agentsCount: agents.length,
    skillsCount: skills.length,
    pipelinesCount: pipelines.length,
    epicsCount: epics.length,
    runIds: listRunIds(root),
    initialView,
  };
}

function listRunIds(root: string): string[] {
  try {
    return RunStateStore.list(root).map((r) => r.runId);
  } catch {
    return [];
  }
}

function toEpicSummaryUi(e: CoreEpicSummary): EpicSummaryUi {
  const total = e.stepDetails.length || 1;
  const done = e.stepDetails.filter((s) => s.status === 'done').length;
  const progress = Math.round((done / total) * 100);
  const epicDir = e.epicDir;
  const artifactsDir = path.join(epicDir, 'artifacts');
  let existingArtifacts: string[] = [];
  if (fs.existsSync(artifactsDir)) {
    try {
      existingArtifacts = fs.readdirSync(artifactsDir).filter((n) => !n.startsWith('.'));
    } catch { /* ignore */ }
  }
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status,
    progress,
    statePath: e.statePath,
    stepDetails: e.stepDetails.map((s) => ({
      agent: s.agent,
      status: s.status,
      runStatus: s.runStatus,
      isCurrentRunStep: s.isCurrentRunStep,
      rejectReason: s.rejectReason,
      autoReviewVerdict: s.autoReviewVerdict,
      stepHasAutoReview: s.stepHasAutoReview,
      stepHasHumanReview: s.stepHasHumanReview,
      startedAt: s.startedAt ?? undefined,
      finishedAt: s.finishedAt ?? undefined,
    })),
    currentStep: e.currentStep,
    pipeline: e.pipeline,
    agent: e.agent,
    runId: e.runId,
    inputs: e.inputs,
    epicDir,
    existingArtifacts,
    createdAt: e.createdAt,
  };
}

function extractSkillIds(a: Record<string, unknown>): string[] {
  if (Array.isArray(a.skills)) {
    return (a.skills as unknown[]).map(String).filter(Boolean);
  }
  if (typeof a.skill === 'string' && a.skill.length > 0) { return [a.skill]; }
  return [];
}

function mergeAgents(doc: YamlDocument | null, discovered: DiscoveredAsset[]): AgentSummary[] {
  const out: AgentSummary[] = [];
  for (const a of discovered.filter((x) => x.scope === 'project')) {
    out.push({ id: a.id, scope: 'project', filePath: a.filePath });
  }
  if (doc) {
    for (const a of doc.agents) {
      const id = String(a.id);
      const skills = extractSkillIds(a);
      out.push({
        id,
        scope: 'aidlc',
        filePath: '',
        description: typeof a.description === 'string' ? a.description : (typeof a.name === 'string' ? a.name : undefined),
        skill: skills[0],
        model: typeof a.model === 'string' ? a.model : undefined,
        integrations: Array.isArray(a.capabilities)
          ? (a.capabilities as unknown[]).map(String)
          : undefined,
      });
    }
  }
  for (const a of discovered.filter((x) => x.scope === 'global')) {
    out.push({ id: a.id, scope: 'global', filePath: a.filePath });
  }
  return out;
}

function mergeSkills(
  doc: YamlDocument | null,
  root: string,
  discovered: DiscoveredAsset[],
): SkillSummary[] {
  const out: SkillSummary[] = [];
  for (const s of discovered.filter((x) => x.scope === 'project')) {
    out.push({ id: s.id, scope: 'project', filePath: s.filePath });
  }
  if (doc) {
    for (const s of doc.skills) {
      const id = String(s.id);
      if (s.builtin) {
        out.push({ id, scope: 'aidlc', filePath: '', description: 'builtin' });
        continue;
      }
      const skillPath = typeof s.path === 'string' ? s.path : undefined;
      const abs = skillPath
        ? (path.isAbsolute(skillPath) ? skillPath : path.resolve(root, skillPath))
        : '';
      out.push({ id, scope: 'aidlc', filePath: abs });
    }
  }
  for (const s of discovered.filter((x) => x.scope === 'global')) {
    out.push({ id: s.id, scope: 'global', filePath: s.filePath });
  }
  return out;
}

// ── Singleton panel ───────────────────────────────────────────────────────

export class WorkspaceWebview {
  static current: WorkspaceWebview | undefined;
  private disposables: vscode.Disposable[] = [];
  private currentView: WorkspaceView;

  static show(extensionUri: vscode.Uri, initialView: WorkspaceView = 'builder'): void {
    const column = vscode.ViewColumn.One;
    if (WorkspaceWebview.current) {
      WorkspaceWebview.current.panel.reveal(column);
      WorkspaceWebview.current.setView(initialView);
      WorkspaceWebview.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'aidlc.workspace',
      'AIDLC Workspace',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    WorkspaceWebview.current = new WorkspaceWebview(panel, extensionUri, initialView);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    initialView: WorkspaceView,
  ) {
    this.currentView = initialView;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );
    this.disposables.push(themeManager.register(this.panel.webview));

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
      const refresh = () => this.refresh();

      const yamlPattern = new vscode.RelativePattern(
        vscode.Uri.file(path.join(root, WORKSPACE_DIR)),
        WORKSPACE_FILENAME,
      );
      const yamlWatcher = vscode.workspace.createFileSystemWatcher(yamlPattern);
      yamlWatcher.onDidChange(refresh, null, this.disposables);
      yamlWatcher.onDidCreate(refresh, null, this.disposables);
      yamlWatcher.onDidDelete(refresh, null, this.disposables);
      this.disposables.push(yamlWatcher);

      const statePattern = new vscode.RelativePattern(vscode.Uri.file(root), '**/state.json');
      const stateWatcher = vscode.workspace.createFileSystemWatcher(statePattern);
      stateWatcher.onDidChange(refresh, null, this.disposables);
      stateWatcher.onDidCreate(refresh, null, this.disposables);
      stateWatcher.onDidDelete(refresh, null, this.disposables);
      this.disposables.push(stateWatcher);

      const runsPattern = new vscode.RelativePattern(vscode.Uri.file(root), '.aidlc/runs/*.json');
      const runsWatcher = vscode.workspace.createFileSystemWatcher(runsPattern);
      runsWatcher.onDidChange(refresh, null, this.disposables);
      runsWatcher.onDidCreate(refresh, null, this.disposables);
      runsWatcher.onDidDelete(refresh, null, this.disposables);
      this.disposables.push(runsWatcher);
    }

    this.refresh();
  }

  refresh(): void {
    void this.panel.webview.postMessage({ type: 'state', state: buildState(this.currentView) });
  }

  setView(view: WorkspaceView): void {
    this.currentView = view;
    void this.panel.webview.postMessage({ type: 'setView', view });
  }

  private dispose(): void {
    WorkspaceWebview.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  // ── Message routing ─────────────────────────────────────────────────────

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.refresh();
        return;

      case 'setTheme': {
        const mode = String(msg.mode ?? '');
        if (mode === 'auto' || mode === 'light' || mode === 'dark') {
          await themeManager.set(mode);
        }
        return;
      }

      case 'setView': {
        const v = msg.view;
        if (v === 'builder' || v === 'epics') { this.currentView = v; }
        return;
      }

      // Delegations
      case 'init':         await vscode.commands.executeCommand('aidlc.initWorkspace'); return;
      case 'applyPreset':  await vscode.commands.executeCommand('aidlc.applyPreset');   return;
      case 'savePreset':   await vscode.commands.executeCommand('aidlc.savePreset');    return;
      case 'startEpic':    await vscode.commands.executeCommand('aidlc.startEpic');     return;
      case 'addAgent':     await vscode.commands.executeCommand('aidlc.addAgent');      return;
      case 'addSkill':     await vscode.commands.executeCommand('aidlc.addSkill');      return;
      case 'addPipeline':  await vscode.commands.executeCommand('aidlc.addPipeline');   return;
      case 'openClaude':   await vscode.commands.executeCommand('aidlc.openClaudeTerminal'); return;
      case 'openEpicsList':
        // Same-panel switch — don't re-execute the command (avoid recursion).
        this.setView('epics');
        return;
      case 'openBuilder':
        this.setView('builder');
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
      case 'loadDemoProject':
        await vscode.commands.executeCommand('aidlc.loadDemoProject');
        return;
      case 'startPipelineRun':
        await vscode.commands.executeCommand('aidlc.startPipelineRun');
        return;

      // File-opening
      case 'openYaml': {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return; }
        const yp = path.join(root, WORKSPACE_DIR, WORKSPACE_FILENAME);
        if (!fs.existsSync(yp)) { return; }
        const doc = await vscode.workspace.openTextDocument(yp);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      case 'openSkill':
      case 'openAgent': {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const targetPathArg = String(msg.filePath ?? msg.path ?? '');
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
      case 'openEpicState': {
        const statePath = String(msg.path ?? '');
        if (!statePath || !fs.existsSync(statePath)) { return; }
        const doc = await vscode.workspace.openTextDocument(statePath);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      case 'openInputsJson': {
        const epicDir = String(msg.epicDir ?? '');
        if (!epicDir) { return; }
        const p = path.join(epicDir, 'inputs.json');
        if (!fs.existsSync(p)) { return; }
        const doc = await vscode.workspace.openTextDocument(p);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      case 'revealArtifacts': {
        const epicDir = String(msg.epicDir ?? '');
        if (!epicDir) { return; }
        const artifactsDir = path.join(epicDir, 'artifacts');
        if (!fs.existsSync(artifactsDir)) { return; }
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(artifactsDir));
        return;
      }
      case 'openArtifactFile': {
        const epicDir = String(msg.epicDir ?? '');
        const filename = String(msg.filename ?? '');
        if (!epicDir || !filename) { return; }
        const filePath = path.join(epicDir, 'artifacts', filename);
        if (!fs.existsSync(filePath)) { return; }
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      case 'copyCommand': {
        const cmd = String(msg.command ?? '');
        if (!cmd) { return; }
        await vscode.env.clipboard.writeText(cmd);
        void vscode.window.setStatusBarMessage(`Copied ${cmd} to clipboard`, 2000);
        return;
      }

      // Pipeline-run state machine
      case 'markStepDone':
      case 'runAutoReview':
      case 'approveStep':
      case 'rejectStep':
      case 'rerunStep':
      case 'openRunState': {
        const runId = String(msg.runId ?? '');
        const cmd = `aidlc.${msg.type}`;
        await vscode.commands.executeCommand(cmd, runId || undefined);
        return;
      }
      case 'deleteRun': {
        const runId = String(msg.runId ?? '');
        // confirmed: webview already showed an inline ConfirmModal, skip the
        // VS Code warning dialog. Falsy for command-palette invocations.
        await vscode.commands.executeCommand(
          'aidlc.deleteRun',
          runId || undefined,
          msg.confirmed === true,
        );
        return;
      }
      case 'rejectStepInline': {
        const runId = String(msg.runId ?? '');
        const reason = String(msg.reason ?? '');
        const targetIdx = Number(msg.targetIdx);
        if (!runId || !Number.isInteger(targetIdx)) { return; }
        await rejectStepInlineCommand(runId, reason, targetIdx);
        return;
      }
      case 'startRunInline': {
        const pipelineId = String(msg.pipelineId ?? '');
        const runId = String(msg.runId ?? '');
        if (!pipelineId || !runId) { return; }
        await startPipelineRunInlineCommand(pipelineId, runId);
        return;
      }
      case 'addPipelineInline': {
        const draft = msg.draft;
        if (!draft || typeof draft !== 'object') { return; }
        await this.addPipelineInline(draft as Record<string, unknown>);
        return;
      }
      case 'editPipelineInline': {
        const id = String(msg.id ?? '');
        const draft = msg.draft;
        if (!id || !draft || typeof draft !== 'object') { return; }
        await this.editPipelineInline(id, draft as Record<string, unknown>);
        return;
      }
      case 'startPipelineRunForEpic': {
        const epicId = String(msg.epicId ?? '').trim();
        const pipelineId = String(msg.pipelineId ?? '').trim();
        if (!epicId || !pipelineId) { return; }
        await this.startPipelineRunForEpic(epicId, pipelineId);
        return;
      }

      // Pipeline / asset mutations
      case 'reorderStep':
        await this.reorderStep(
          String(msg.pipelineId ?? ''),
          Number(msg.fromIdx ?? -1),
          Number(msg.toIdx ?? -1),
        );
        return;
      case 'addStepToPipeline': {
        const pipelineId = String(msg.pipelineId ?? '');
        const agentId = typeof msg.agentId === 'string' ? msg.agentId : undefined;
        await this.addStepToPipeline(pipelineId, agentId);
        return;
      }
      case 'deleteStep':
        await this.deleteStep(String(msg.pipelineId ?? ''), Number(msg.idx ?? -1));
        return;
      case 'editStepConfig': {
        const inlineConfig =
          msg.config && typeof msg.config === 'object'
            ? (msg.config as Record<string, unknown>)
            : undefined;
        await this.editStepConfig(
          String(msg.pipelineId ?? ''),
          Number(msg.idx ?? -1),
          inlineConfig,
        );
        return;
      }
      case 'deleteAgent':
        await this.deleteItem('agents', String(msg.id ?? ''), msg.confirmed === true);
        return;
      case 'deleteSkill':
        await this.deleteItem('skills', String(msg.id ?? ''), msg.confirmed === true);
        return;
      case 'deletePipeline':
        await this.deleteItem('pipelines', String(msg.id ?? ''), msg.confirmed === true);
        return;
      case 'renameAgent':
        await this.renameItem(
          'agents',
          String(msg.id ?? ''),
          typeof msg.newId === 'string' ? msg.newId : undefined,
        );
        return;
      case 'renameSkill':
        await this.renameItem(
          'skills',
          String(msg.id ?? ''),
          typeof msg.newId === 'string' ? msg.newId : undefined,
        );
        return;
      case 'duplicateAgent': await this.duplicateItem('agents', String(msg.id ?? '')); return;
      case 'duplicateSkill': await this.duplicateItem('skills', String(msg.id ?? '')); return;
      case 'togglePipelineFailure':
        await this.togglePipelineFailure(String(msg.pipelineId ?? ''));
        return;
      case 'runPipeline':
        await vscode.commands.executeCommand(
          'aidlc.startPipelineRun',
          String(msg.pipelineId ?? ''),
        );
        return;
      case 'agentMenu': {
        // Simple action picker — replaces the kebab menu in the React card.
        const id = String(msg.id ?? '');
        const filePath = String(msg.filePath ?? '');
        if (!id) { return; }
        const pick = await vscode.window.showQuickPick(
          [
            { label: 'Open file', value: 'open', detail: filePath },
            { label: 'Rename', value: 'rename' },
            { label: 'Duplicate', value: 'duplicate' },
            { label: 'Delete', value: 'delete' },
          ],
          { placeHolder: `Agent ${id}` },
        );
        if (!pick) { return; }
        if (pick.value === 'open' && filePath) {
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, { preview: false });
        } else if (pick.value === 'rename') {
          await this.renameItem('agents', id);
        } else if (pick.value === 'duplicate') {
          await this.duplicateItem('agents', id);
        } else if (pick.value === 'delete') {
          await this.deleteItem('agents', id);
        }
        return;
      }
    }
  }

  // ── Mutation helpers ────────────────────────────────────────────────────

  private getRootOrWarn(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { void vscode.window.showWarningMessage('AIDLC: no folder open.'); }
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
      const steps = p.steps as PipelineStepConfig[];
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
      (p.steps as PipelineStepConfig[]).splice(idx, 1);
    });
  }

  private async editStepConfig(
    pipelineId: string,
    idx: number,
    /** Webview already collected the new config via inline StepConfigModal —
     * apply it directly and skip promptStepConfig's QuickPick chain. */
    inlineConfig?: Record<string, unknown>,
  ): Promise<void> {
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
    let draft;
    if (inlineConfig) {
      const requires = Array.isArray(inlineConfig.requires)
        ? (inlineConfig.requires as unknown[]).map(String)
        : [];
      const produces = Array.isArray(inlineConfig.produces)
        ? (inlineConfig.produces as unknown[]).map(String)
        : [];
      const runnerRaw = inlineConfig.auto_review_runner;
      draft = {
        agent: norm.agent,
        enabled: inlineConfig.enabled === true,
        requires,
        produces,
        human_review: inlineConfig.human_review === true,
        auto_review: inlineConfig.auto_review === true,
        auto_review_runner:
          inlineConfig.auto_review === true && typeof runnerRaw === 'string' && runnerRaw.trim()
            ? runnerRaw.trim()
            : undefined,
      };
    } else {
      const result = await promptStepConfig(norm.agent, {
        enabled: norm.enabled,
        requires: norm.requires,
        produces: norm.produces,
        human_review: norm.human_review,
        auto_review: norm.auto_review,
        auto_review_runner: norm.auto_review_runner,
      });
      if (!result) { return; }
      draft = result;
    }
    this.mutateYaml((d) => {
      const p = d.pipelines.find((x) => x.id === pipelineId);
      if (!p || !Array.isArray(p.steps) || idx >= p.steps.length) { return false; }
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

  /**
   * Build a pipeline from the React `AddPipelineModal` payload — bypasses
   * the legacy QuickPick wizard chain. Validates id, agents, and runner
   * paths server-side; surfaces issues as a warning and aborts.
   */
  private async addPipelineInline(draft: Record<string, unknown>): Promise<void> {
    const root = this.getRootOrWarn();
    if (!root) { return; }
    const doc = readYaml(root);
    if (!doc) {
      void vscode.window.showWarningMessage('AIDLC: no workspace.yaml — initialize first.');
      return;
    }

    const id = String(draft.id ?? '').trim();
    const onFailure: 'stop' | 'continue' =
      draft.on_failure === 'continue' ? 'continue' : 'stop';
    const stepsRaw = Array.isArray(draft.steps) ? (draft.steps as unknown[]) : [];

    if (!id) {
      void vscode.window.showWarningMessage('Pipeline id is required.');
      return;
    }
    if (doc.pipelines.some((p) => p.id === id)) {
      void vscode.window.showWarningMessage(`Pipeline "${id}" already exists.`);
      return;
    }
    if (stepsRaw.length === 0) {
      void vscode.window.showWarningMessage('Pipeline needs at least one step.');
      return;
    }

    const agentIds = new Set(doc.agents.map((a) => String(a.id)));
    const steps: unknown[] = [];
    for (const raw of stepsRaw) {
      if (!raw || typeof raw !== 'object') { continue; }
      const r = raw as Record<string, unknown>;
      const agent = String(r.agent ?? '').trim();
      if (!agent || !agentIds.has(agent)) {
        void vscode.window.showWarningMessage(
          `Step references unknown agent "${agent}". Aborting.`,
        );
        return;
      }
      const human_review = r.human_review === true;
      const auto_review = r.auto_review === true;
      const runner = typeof r.auto_review_runner === 'string' ? r.auto_review_runner.trim() : '';
      if (auto_review && !runner) {
        void vscode.window.showWarningMessage(
          `Step "${agent}": auto_review is on but runner path is empty.`,
        );
        return;
      }
      const step: Record<string, unknown> = {
        agent,
        enabled: true,
        requires: [],
        produces: [],
        human_review,
        auto_review,
      };
      if (auto_review) { step.auto_review_runner = runner; }
      steps.push(step);
    }

    this.mutateYaml((d) => {
      d.pipelines.push({ id, steps, on_failure: onFailure });
    });

    void vscode.window.showInformationMessage(
      `Pipeline "${id}" added: ${steps
        .map((s) => (s as { agent: string }).agent)
        .join(' → ')}`,
    );
  }

  /**
   * Apply edits from the React `PipelineModal` (edit mode). Replaces the
   * pipeline's `steps` and `on_failure` while preserving each existing step's
   * `requires` / `produces` (which the modal does not expose — those still
   * live on the per-step gear-icon flow). Matching is by agent id, first
   * occurrence — good enough for typical reorder + toggle workflows.
   */
  private async editPipelineInline(
    id: string,
    draft: Record<string, unknown>,
  ): Promise<void> {
    const root = this.getRootOrWarn();
    if (!root) { return; }
    const doc = readYaml(root);
    if (!doc) { return; }

    const pipeline = doc.pipelines.find((p) => p.id === id);
    if (!pipeline) {
      void vscode.window.showWarningMessage(`Pipeline "${id}" not found.`);
      return;
    }

    const onFailure: 'stop' | 'continue' =
      draft.on_failure === 'continue' ? 'continue' : 'stop';
    const stepsRaw = Array.isArray(draft.steps) ? (draft.steps as unknown[]) : [];
    if (stepsRaw.length === 0) {
      void vscode.window.showWarningMessage('Pipeline needs at least one step.');
      return;
    }

    const agentIds = new Set(doc.agents.map((a) => String(a.id)));

    // Preserve requires/produces from the existing pipeline by agent id —
    // first occurrence consumed per match so duplicate-agent steps still
    // pair up with their original entries in order.
    const oldByAgent = new Map<string, Array<{ requires: string[]; produces: string[] }>>();
    if (Array.isArray(pipeline.steps)) {
      for (const raw of pipeline.steps as PipelineStepConfig[]) {
        const norm = normalizeStep(raw);
        const arr = oldByAgent.get(norm.agent) ?? [];
        arr.push({ requires: norm.requires, produces: norm.produces });
        oldByAgent.set(norm.agent, arr);
      }
    }

    const newSteps: unknown[] = [];
    for (const raw of stepsRaw) {
      if (!raw || typeof raw !== 'object') { continue; }
      const r = raw as Record<string, unknown>;
      const agent = String(r.agent ?? '').trim();
      if (!agent || !agentIds.has(agent)) {
        void vscode.window.showWarningMessage(
          `Step references unknown agent "${agent}". Aborting.`,
        );
        return;
      }
      const human_review = r.human_review === true;
      const auto_review = r.auto_review === true;
      const runner = typeof r.auto_review_runner === 'string' ? r.auto_review_runner.trim() : '';
      if (auto_review && !runner) {
        void vscode.window.showWarningMessage(
          `Step "${agent}": auto_review is on but runner path is empty.`,
        );
        return;
      }

      const carry = oldByAgent.get(agent)?.shift();
      const step: Record<string, unknown> = {
        agent,
        enabled: true,
        requires: carry?.requires ?? [],
        produces: carry?.produces ?? [],
        human_review,
        auto_review,
      };
      if (auto_review) { step.auto_review_runner = runner; }
      newSteps.push(step);
    }

    this.mutateYaml((d) => {
      const p = d.pipelines.find((x) => x.id === id);
      if (!p) { return false; }
      p.steps = newSteps;
      p.on_failure = onFailure;
    });

    void vscode.window.showInformationMessage(
      `Pipeline "${id}" updated: ${newSteps
        .map((s) => (s as { agent: string }).agent)
        .join(' → ')}`,
    );
  }

  private async addStepToPipeline(pipelineId: string, agentIdArg?: string): Promise<void> {
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

    let chosenId: string | undefined;
    if (agentIdArg) {
      // Webview already showed an inline StepPickerModal — trust the choice
      // but verify the agent still exists in workspace.yaml.
      if (doc.agents.some((a) => String(a.id) === agentIdArg)) {
        chosenId = agentIdArg;
      }
    } else {
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
      chosenId = picked?.id;
    }
    if (!chosenId) { return; }
    this.mutateYaml((d) => {
      const p = d.pipelines.find((x) => x.id === pipelineId);
      if (!p) { return false; }
      const steps = Array.isArray(p.steps) ? (p.steps as PipelineStepConfig[]) : [];
      steps.push(chosenId!);
      p.steps = steps;
    });
  }

  private async deleteItem(
    field: 'agents' | 'skills' | 'pipelines',
    id: string,
    /** Webview already confirmed via inline modal — skip the VS Code dialog. */
    skipConfirm = false,
  ): Promise<void> {
    if (!id) { return; }
    if (!skipConfirm) {
      const confirm = await vscode.window.showWarningMessage(
        `Delete ${field.replace(/s$/, '')} \`${id}\`?`,
        { modal: true }, 'Delete', 'Cancel',
      );
      if (confirm !== 'Delete') { return; }
    }
    this.mutateYaml((doc) => {
      const arr = doc[field];
      if (!Array.isArray(arr)) { return false; }
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) { return false; }
      arr.splice(idx, 1);
    });
  }

  private async renameItem(
    field: 'agents' | 'skills',
    id: string,
    /** Webview already prompted via inline RenameModal — use this directly
     * and skip the VS Code input box. Falsy for command-palette flows. */
    newIdArg?: string,
  ): Promise<void> {
    if (!id) { return; }
    let newId = newIdArg;
    if (!newId) {
      newId = await vscode.window.showInputBox({
        prompt: `New ID for ${field.replace(/s$/, '')} \`${id}\``,
        value: id,
        validateInput: (v) => v && v.trim() ? null : 'ID cannot be empty',
      });
    }
    const trimmed = newId?.trim();
    if (!trimmed || trimmed === id) { return; }
    this.mutateYaml((doc) => {
      const arr = doc[field];
      if (!Array.isArray(arr)) { return false; }
      const item = arr.find((x) => x.id === id);
      if (!item) { return false; }
      if (arr.some((x) => x.id === trimmed)) { return false; }
      item.id = trimmed;
    });
  }

  private async duplicateItem(field: 'agents' | 'skills', id: string): Promise<void> {
    if (!id) { return; }
    this.mutateYaml((doc) => {
      const arr = doc[field];
      if (!Array.isArray(arr)) { return false; }
      const item = arr.find((x) => x.id === id);
      if (!item) { return false; }
      const newId = id + '-copy';
      const suffix = arr.filter((x) => String(x.id).startsWith(newId)).length;
      const finalId = suffix === 0 ? newId : newId + '-' + suffix;
      const clone = JSON.parse(JSON.stringify(item));
      clone.id = finalId;
      const idx = arr.findIndex((x) => x.id === id);
      arr.splice(idx + 1, 0, clone);
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

  private async startPipelineRunForEpic(epicId: string, pipelineId: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return; }
    const doc = readYaml(root);
    if (!doc) {
      void vscode.window.showWarningMessage('AIDLC: no workspace.yaml found.');
      return;
    }
    const pipeline = (doc.pipelines as PipelineConfig[] | undefined)?.find((p) => p.id === pipelineId);
    if (!pipeline) {
      void vscode.window.showWarningMessage(`Pipeline "${pipelineId}" not found.`);
      return;
    }
    const existing = RunStateStore.load(root, epicId);
    if (existing) {
      void vscode.window.showInformationMessage(
        `Run "${epicId}" already exists (status: ${existing.status}).`,
      );
      return;
    }
    const epic = listEpics(root, doc).find((x) => x.id === epicId);
    const context: Record<string, string> = { epic: epicId };
    if (epic) {
      try {
        const inputsPath = path.join(epic.epicDir, 'inputs.json');
        if (fs.existsSync(inputsPath)) {
          const parsed = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === 'string') { context[k] = v; }
            }
          }
        }
      } catch { /* ignore */ }
    }
    try {
      const runState = startRun({ runId: epicId, pipeline, context });
      RunStateStore.save(root, runState);
      void vscode.window.showInformationMessage(
        `Pipeline run "${epicId}" started — current step: ${runState.steps[runState.currentStepIdx].agent}.`,
      );
      this.refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to start pipeline run: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── HTML shell ──────────────────────────────────────────────────────────

  private getHtml(): string {
    const nonce = makeNonce();
    const webview = this.panel.webview;
    const cspSource = webview.cspSource;
    const initialState = buildState(this.currentView);
    const initialTheme = themeManager.current;

    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, 'out', 'webviews');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'styles.css')).toString();
    const entryUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'workspace.js')).toString();

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
<title>AIDLC Workspace</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">
window.__AIDLC_INITIAL_STATE__ = ${JSON.stringify(initialState)};
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
