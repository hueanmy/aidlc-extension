/**
 * Pipeline run commands — phase 1 of the v2 orchestrator.
 *
 *   aidlc.startPipelineRun  — pick a pipeline, prompt for a run id, scaffold
 *                             the run JSON, and open step 0 in awaiting_work.
 *   aidlc.markStepDone      — validate the current step's `produces` exist,
 *                             then transition to awaiting_review (or auto-
 *                             approve when human_review=false).
 *   aidlc.approveStep       — human approves the awaiting_review step.
 *   aidlc.rejectStep        — human rejects with optional reason.
 *   aidlc.rerunStep         — retry a rejected step (revision++).
 *   aidlc.openRunState      — open the run JSON in the editor.
 *   aidlc.deleteRun         — remove the run file (confirms first).
 *
 * All run-mutating commands resolve the active runId via:
 *   1. explicit argument from the sidebar click
 *   2. otherwise, quick-pick over runs in `.aidlc/runs/` filtered by relevance
 *
 * The state machine itself lives in @aidlc/core/runs — these wrappers
 * only do VS Code-flavored UX (pickers, prompts, toasts) and persist the
 * resulting state.
 */

import * as vscode from 'vscode';

import {
  RunStateStore,
  RUN_ID_PATTERN,
  startRun,
  markStepDone,
  approveStep,
  rejectStep,
  rerunStep,
  PipelineRunError,
} from '@aidlc/core';
import type { PipelineConfig, RunState } from '@aidlc/core';

import { readYaml } from './yamlIO';

function getRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function requireRoot(action: string): string | undefined {
  const root = getRoot();
  if (!root) {
    void vscode.window.showWarningMessage(
      `AIDLC: Open a project first — ${action} targets the active workspace folder.`,
    );
    return undefined;
  }
  return root;
}

/** Find a pipeline definition by id in the current workspace.yaml. */
function loadPipeline(root: string, pipelineId: string): PipelineConfig | undefined {
  const doc = readYaml(root);
  if (!doc) { return undefined; }
  const found = (doc.pipelines as PipelineConfig[] | undefined)?.find((p) => p.id === pipelineId);
  return found;
}

/**
 * Resolve a runId to an active run. If `explicit` is supplied (from a
 * sidebar click), use that. Otherwise show a quick-pick of active runs.
 */
async function resolveRunId(
  root: string,
  explicit: string | undefined,
  filter: (s: RunState) => boolean = () => true,
): Promise<string | undefined> {
  if (explicit) { return explicit; }
  const runs = RunStateStore.list(root).filter(filter);
  if (runs.length === 0) {
    void vscode.window.showInformationMessage('AIDLC: no matching pipeline runs.');
    return undefined;
  }
  if (runs.length === 1) { return runs[0].runId; }
  const picked = await vscode.window.showQuickPick(
    runs.map((r) => ({
      label: r.runId,
      description: `${r.pipelineId} · ${r.status} · step ${r.currentStepIdx + 1}/${r.steps.length}`,
      runId: r.runId,
    })),
    { placeHolder: 'Pick a pipeline run', ignoreFocusOut: true },
  );
  return picked?.runId;
}

// ── start ────────────────────────────────────────────────────────────────

export async function startPipelineRunCommand(): Promise<void> {
  const root = requireRoot('Start Pipeline Run');
  if (!root) { return; }

  const doc = readYaml(root);
  if (!doc || !doc.pipelines || doc.pipelines.length === 0) {
    void vscode.window.showWarningMessage(
      'AIDLC: no pipelines defined in workspace.yaml. Add one with id + steps[] first.',
    );
    return;
  }

  const pickedPipeline = await vscode.window.showQuickPick(
    (doc.pipelines as PipelineConfig[]).map((p) => ({
      label: p.id,
      description: `${p.steps.length} step${p.steps.length === 1 ? '' : 's'} · on_failure: ${p.on_failure}`,
      pipeline: p,
    })),
    { placeHolder: 'Pick a pipeline to run', ignoreFocusOut: true },
  );
  if (!pickedPipeline) { return; }

  const runId = await vscode.window.showInputBox({
    prompt: 'Run id (typically the epic key — e.g. DRM-2100)',
    placeHolder: 'DRM-2100',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) { return 'Required'; }
      if (!RUN_ID_PATTERN.test(t)) {
        return 'Letters, digits, dot, dash, underscore only — must start with letter/digit';
      }
      const existing = RunStateStore.load(root, t);
      if (existing) {
        return `Run "${t}" already exists (status: ${existing.status})`;
      }
      return null;
    },
  });
  if (!runId) { return; }

  const state = startRun({
    runId: runId.trim(),
    pipeline: pickedPipeline.pipeline,
    context: { epic: runId.trim() },
  });
  RunStateStore.save(root, state);

  const firstStep = pickedPipeline.pipeline.steps[0];
  const firstAgent = typeof firstStep === 'string' ? firstStep : firstStep.agent;
  void vscode.window.showInformationMessage(
    `Started run "${runId}" — first step: ${firstAgent}. Run /${firstAgent} ${runId} in Claude, then click "Mark step done" in the sidebar.`,
  );
}

// ── markStepDone ─────────────────────────────────────────────────────────

export async function markStepDoneCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Mark Step Done');
  if (!root) { return; }

  const runId = await resolveRunId(
    root,
    runIdArg,
    (s) => s.status === 'running' && currentStepStatus(s) === 'awaiting_work',
  );
  if (!runId) { return; }

  const state = RunStateStore.load(root, runId);
  if (!state) { void vscode.window.showWarningMessage(`Run "${runId}" not found.`); return; }

  const pipeline = loadPipeline(root, state.pipelineId);
  if (!pipeline) {
    void vscode.window.showErrorMessage(
      `Run "${runId}" references pipeline "${state.pipelineId}" which is no longer in workspace.yaml.`,
    );
    return;
  }

  try {
    const next = markStepDone({ state, pipeline, workspaceRoot: root });
    RunStateStore.save(root, next);
    notifyStepTransition(next, state.currentStepIdx);
  } catch (err) {
    surfaceRunError(err);
  }
}

// ── approveStep ──────────────────────────────────────────────────────────

export async function approveStepCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Approve Step');
  if (!root) { return; }
  const runId = await resolveRunId(
    root,
    runIdArg,
    (s) => currentStepStatus(s) === 'awaiting_review',
  );
  if (!runId) { return; }

  const state = RunStateStore.load(root, runId);
  if (!state) { return; }
  const pipeline = loadPipeline(root, state.pipelineId);
  if (!pipeline) {
    void vscode.window.showErrorMessage(
      `Pipeline "${state.pipelineId}" missing from workspace.yaml.`,
    );
    return;
  }

  try {
    const next = approveStep({ state, pipeline });
    RunStateStore.save(root, next);
    notifyStepTransition(next, state.currentStepIdx);
  } catch (err) {
    surfaceRunError(err);
  }
}

// ── rejectStep ───────────────────────────────────────────────────────────

export async function rejectStepCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Reject Step');
  if (!root) { return; }
  const runId = await resolveRunId(
    root,
    runIdArg,
    (s) => currentStepStatus(s) === 'awaiting_review',
  );
  if (!runId) { return; }

  const state = RunStateStore.load(root, runId);
  if (!state) { return; }

  const reason = await vscode.window.showInputBox({
    prompt: 'Why is this step rejected? (optional — saved on the run for the rerun)',
    placeHolder: 'e.g. PRD missing performance acceptance criteria',
    ignoreFocusOut: true,
  });
  if (reason === undefined) { return; }

  try {
    const next = rejectStep({ state, reason: reason.trim() || undefined });
    RunStateStore.save(root, next);
    void vscode.window.showInformationMessage(
      `Rejected step "${state.steps[state.currentStepIdx].agent}". Click "Rerun" in the sidebar when ready.`,
    );
  } catch (err) {
    surfaceRunError(err);
  }
}

// ── rerunStep ────────────────────────────────────────────────────────────

export async function rerunStepCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Rerun Step');
  if (!root) { return; }
  const runId = await resolveRunId(
    root,
    runIdArg,
    (s) => currentStepStatus(s) === 'rejected',
  );
  if (!runId) { return; }

  const state = RunStateStore.load(root, runId);
  if (!state) { return; }
  const step = state.steps[state.currentStepIdx];

  const feedback = await vscode.window.showInputBox({
    prompt: 'Feedback for the rerun (optional — kept on the step for context)',
    placeHolder: step.feedback ?? step.rejectReason ?? 'e.g. address reviewer concern about test coverage',
    value: step.feedback ?? '',
    ignoreFocusOut: true,
  });
  if (feedback === undefined) { return; }

  try {
    const next = rerunStep({ state, feedback: feedback.trim() || undefined });
    RunStateStore.save(root, next);
    void vscode.window.showInformationMessage(
      `Step "${step.agent}" reset (revision ${next.steps[state.currentStepIdx].revision}). Run the slash command again, then "Mark step done".`,
    );
  } catch (err) {
    surfaceRunError(err);
  }
}

// ── openRunState ─────────────────────────────────────────────────────────

export async function openRunStateCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Open Run State');
  if (!root) { return; }
  const runId = await resolveRunId(root, runIdArg);
  if (!runId) { return; }
  const file = RunStateStore.file(root, runId);
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc, { preview: false });
}

// ── deleteRun ────────────────────────────────────────────────────────────

export async function deleteRunCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Delete Run');
  if (!root) { return; }
  const runId = await resolveRunId(root, runIdArg);
  if (!runId) { return; }
  const choice = await vscode.window.showWarningMessage(
    `Delete run "${runId}"? The state JSON is removed; produced artifacts on disk are kept.`,
    { modal: false },
    'Delete', 'Cancel',
  );
  if (choice !== 'Delete') { return; }
  RunStateStore.delete(root, runId);
  void vscode.window.showInformationMessage(`Deleted run "${runId}".`);
}

// ── shared helpers ───────────────────────────────────────────────────────

function currentStepStatus(s: RunState): string {
  return s.steps[s.currentStepIdx]?.status ?? 'unknown';
}

function notifyStepTransition(next: RunState, prevIdx: number): void {
  if (next.status === 'completed') {
    void vscode.window.showInformationMessage(
      `Pipeline "${next.pipelineId}" completed for run "${next.runId}". 🎉`,
    );
    return;
  }
  const step = next.steps[next.currentStepIdx];
  if (next.currentStepIdx === prevIdx) {
    // Same step — must be awaiting_review
    void vscode.window.showInformationMessage(
      `Step "${step.agent}" produced its artifacts. Awaiting your review in the sidebar.`,
    );
    return;
  }
  // Advanced
  void vscode.window.showInformationMessage(
    `Advanced to step "${step.agent}". Run /${step.agent} ${next.runId} in Claude, then "Mark step done".`,
  );
}

function surfaceRunError(err: unknown): void {
  if (err instanceof PipelineRunError) {
    if (err.missing && err.missing.length > 0) {
      void vscode.window.showErrorMessage(
        `${err.message}\nMissing: ${err.missing.join(', ')}`,
      );
      return;
    }
    void vscode.window.showErrorMessage(err.message);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`AIDLC: ${msg}`);
}
