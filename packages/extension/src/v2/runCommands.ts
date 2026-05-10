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
  canStartStep,
  markStepDone,
  approveStep,
  rejectStep,
  rerunStep,
  requestStepUpdate,
  submitAutoReviewVerdict,
  runAutoReview,
  PipelineRunError,
  AutoReviewerError,
} from '@aidlc/core';
import type { PipelineConfig, RunState } from '@aidlc/core';

import { readYaml } from './yamlIO';
import { mirrorRunStateToEpic } from './epicsList';

/**
 * Save the runtime RunState file AND mirror its display fields + per-step
 * history into the epic's docs/epics/<id>/state.json so the on-disk record
 * stays in sync. Mirror failures don't block the save — runs/ is the
 * authoritative source for the live machine; state.json is a snapshot for
 * git / offline review.
 */
function saveRun(workspaceRoot: string, next: RunState): void {
  RunStateStore.save(workspaceRoot, next);
  try {
    mirrorRunStateToEpic(workspaceRoot, next, readYaml(workspaceRoot));
  } catch (err) {
    void vscode.window.showWarningMessage(
      `AIDLC: failed to mirror run state into epic state.json — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

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

/**
 * Webview-driven start: caller (the React StartRunModal) supplies pipelineId
 * and runId directly so we skip showQuickPick + showInputBox. The validations
 * the input box did (RUN_ID_PATTERN, no duplicate) also run inside the modal,
 * so the only re-checks here are server-side safety nets — invalid inputs
 * just fall through to a warning toast.
 */
export async function startPipelineRunInlineCommand(
  pipelineId: string,
  runId: string,
): Promise<void> {
  const root = requireRoot('Start Pipeline Run');
  if (!root) { return; }

  const id = pipelineId.trim();
  const rid = runId.trim();
  if (!id || !rid) { return; }
  if (!RUN_ID_PATTERN.test(rid)) {
    void vscode.window.showWarningMessage(
      `Invalid run id "${rid}" — must match ${RUN_ID_PATTERN}.`,
    );
    return;
  }

  const doc = readYaml(root);
  if (!doc || !Array.isArray(doc.pipelines)) {
    void vscode.window.showWarningMessage('AIDLC: no workspace.yaml or no pipelines defined.');
    return;
  }
  const pipeline = (doc.pipelines as PipelineConfig[]).find((p) => p.id === id);
  if (!pipeline) {
    void vscode.window.showWarningMessage(`Pipeline "${id}" not found in workspace.yaml.`);
    return;
  }
  if (RunStateStore.load(root, rid)) {
    void vscode.window.showWarningMessage(`Run "${rid}" already exists.`);
    return;
  }

  const state = startRun({
    runId: rid,
    pipeline,
    context: { work: rid },
  });
  saveRun(root, state);

  const firstStep = pipeline.steps[0];
  const firstAgent = typeof firstStep === 'string' ? firstStep : firstStep.agent;
  void vscode.window.showInformationMessage(
    `Started run "${rid}" — first step: ${firstAgent}. Run /${firstAgent} ${rid} in Claude, then click "Mark step done" in the sidebar.`,
  );
}

export async function startPipelineRunCommand(pipelineIdArg?: string): Promise<void> {
  const root = requireRoot('Start Pipeline Run');
  if (!root) { return; }

  const doc = readYaml(root);
  if (!doc || !doc.pipelines || doc.pipelines.length === 0) {
    void vscode.window.showWarningMessage(
      'AIDLC: no pipelines defined in workspace.yaml. Add one with id + steps[] first.',
    );
    return;
  }

  let pickedPipeline: { pipeline: PipelineConfig } | undefined;
  if (pipelineIdArg) {
    const found = (doc.pipelines as PipelineConfig[]).find((p) => p.id === pipelineIdArg);
    if (!found) {
      void vscode.window.showWarningMessage(
        `AIDLC: pipeline "${pipelineIdArg}" not found in workspace.yaml.`,
      );
      return;
    }
    pickedPipeline = { pipeline: found };
  } else {
    pickedPipeline = await vscode.window.showQuickPick(
      (doc.pipelines as PipelineConfig[]).map((p) => ({
        label: p.id,
        description: `${p.steps.length} step${p.steps.length === 1 ? '' : 's'} · on_failure: ${p.on_failure}`,
        pipeline: p,
      })),
      { placeHolder: 'Pick a pipeline to run', ignoreFocusOut: true },
    );
  }
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
  saveRun(root, state);

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

  // Soft gate-check: surface missing requires as a warning before we attempt
  // markStepDone. The user can still proceed (they may know the requires
  // path is wrong / outdated); we just don't want them to be surprised.
  const gate = canStartStep({ state, pipeline, workspaceRoot: root });
  if (!gate.ok) {
    const choice = await vscode.window.showWarningMessage(
      `Step "${state.steps[state.currentStepIdx].agent}" is missing required upstream artifacts:\n${gate.missing.join(', ')}`,
      { modal: false },
      'Mark done anyway',
      'Cancel',
    );
    if (choice !== 'Mark done anyway') { return; }
  }

  try {
    const next = markStepDone({ state, pipeline, workspaceRoot: root });
    saveRun(root, next);
    notifyStepTransition(next, state.currentStepIdx);
  } catch (err) {
    surfaceRunError(err);
  }
}

// ── runAutoReview ────────────────────────────────────────────────────────

export async function runAutoReviewCommand(runIdArg?: string): Promise<void> {
  const root = requireRoot('Run Auto-Review');
  if (!root) { return; }
  const runId = await resolveRunId(
    root,
    runIdArg,
    (s) => currentStepStatus(s) === 'awaiting_auto_review',
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

  const step = state.steps[state.currentStepIdx];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Auto-reviewing "${step.agent}"…`, cancellable: false },
    async () => {
      try {
        const verdict = await runAutoReview({ workspaceRoot: root, state, pipeline });
        const next = submitAutoReviewVerdict({ state, pipeline, verdict });
        saveRun(root, next);

        const tag = verdict.decision === 'pass' ? '✅ pass' : '❌ reject';
        const followUp = next.steps[next.currentStepIdx];
        const action =
          next.status === 'completed'        ? 'Pipeline completed.' :
          followUp.status === 'awaiting_review' ? 'Awaiting your review in the sidebar.' :
          followUp.status === 'rejected'     ? 'Step rejected — see Rerun button.' :
          followUp.status === 'awaiting_work' ? `Advanced to "${followUp.agent}".` :
          'Run state updated.';
        void vscode.window.showInformationMessage(
          `Auto-review ${tag}: ${verdict.reason}\n${action}`,
        );
      } catch (err) {
        if (err instanceof AutoReviewerError) {
          void vscode.window.showErrorMessage(`Auto-review failed: ${err.message}`);
          return;
        }
        surfaceRunError(err);
      }
    },
  );
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
    saveRun(root, next);
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

  // Ask which step to send work back to. The default is "stay on this step"
  // (in-place rerun); upstream choices cascade-reset intermediate steps to
  // pending so the user redoes the chain after fixing the upstream cause.
  const idx = state.currentStepIdx;
  const currentStep = state.steps[idx];
  const targetIdx = await pickRejectTarget(state);
  if (targetIdx === undefined) { return; }

  try {
    const next = rejectStep({
      state,
      reason: reason.trim() || undefined,
      targetIdx: targetIdx === idx ? undefined : targetIdx,
    });
    saveRun(root, next);
    if (targetIdx === idx) {
      void vscode.window.showInformationMessage(
        `Rejected step "${currentStep.agent}". Click "Rerun" in the sidebar when ready.`,
      );
    } else {
      const target = state.steps[targetIdx];
      void vscode.window.showInformationMessage(
        `Rejected step "${currentStep.agent}" → sent back to step ${targetIdx + 1} "${target.agent}". Intermediate steps reset to pending.`,
      );
    }
  } catch (err) {
    surfaceRunError(err);
  }
}

/**
 * Webview-driven reject: caller (the React modal) supplies reason and
 * targetIdx directly so we skip the VS Code showInputBox + showQuickPick
 * dialogs that `rejectStepCommand` would normally pop. Same downstream
 * state transition + toast.
 */
export async function rejectStepInlineCommand(
  runId: string,
  reason: string,
  targetIdx: number,
): Promise<void> {
  const root = requireRoot('Reject Step');
  if (!root) { return; }
  const state = RunStateStore.load(root, runId);
  if (!state) { return; }
  const idx = state.currentStepIdx;
  const currentStep = state.steps[idx];
  if (!currentStep) { return; }
  if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > idx) { return; }

  try {
    const next = rejectStep({
      state,
      reason: reason.trim() || undefined,
      targetIdx: targetIdx === idx ? undefined : targetIdx,
    });
    saveRun(root, next);
    if (targetIdx === idx) {
      void vscode.window.showInformationMessage(
        `Rejected step "${currentStep.agent}". Click "Rerun" in the sidebar when ready.`,
      );
    } else {
      const target = state.steps[targetIdx];
      void vscode.window.showInformationMessage(
        `Rejected step "${currentStep.agent}" → sent back to step ${targetIdx + 1} "${target.agent}". Intermediate steps reset to pending.`,
      );
    }
  } catch (err) {
    surfaceRunError(err);
  }
}

/**
 * Quickpick for "send the rejected work back to which step?".
 * Returns the chosen step index, or undefined if the user dismissed the
 * picker. The first item is the current step (in-place rerun) — that's the
 * default behavior and stays prominent so the user doesn't have to navigate
 * to keep the existing flow.
 */
async function pickRejectTarget(state: RunState): Promise<number | undefined> {
  const idx = state.currentStepIdx;
  const items: Array<vscode.QuickPickItem & { stepIdx: number }> = [
    {
      label: `$(refresh) Stay on step ${idx + 1} — ${state.steps[idx].agent}`,
      description: 'Rerun in place',
      detail: 'Mark current step rejected; user fixes and reruns same step. Default.',
      stepIdx: idx,
    },
  ];
  // Upstream candidates: any earlier step. Most recent first so step N-1 is
  // the next item the user sees (most common cascade target).
  for (let i = idx - 1; i >= 0; i--) {
    items.push({
      label: `$(arrow-up) Send back to step ${i + 1} — ${state.steps[i].agent}`,
      description: 'Cascade reject',
      detail: `Resets steps ${i + 2}–${idx + 1} to pending; revision++ on step ${i + 1}.`,
      stepIdx: i,
    });
  }

  // No upstream choices → don't bother asking.
  if (items.length === 1) { return idx; }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Send rejected work back to which step?',
    ignoreFocusOut: true,
  });
  return picked ? picked.stepIdx : undefined;
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
    saveRun(root, next);
    void vscode.window.showInformationMessage(
      `Step "${step.agent}" reset (revision ${next.steps[state.currentStepIdx].revision}). Run the slash command again, then "Mark step done".`,
    );
  } catch (err) {
    surfaceRunError(err);
  }
}

/**
 * Webview-driven rerun: caller (the React RerunModal) supplies the optional
 * feedback string directly so we skip the showInputBox dialog.
 */
export async function rerunStepInlineCommand(
  runId: string,
  feedback: string,
): Promise<void> {
  const root = requireRoot('Rerun Step');
  if (!root) { return; }
  const state = RunStateStore.load(root, runId);
  if (!state) { return; }
  const step = state.steps[state.currentStepIdx];
  if (!step) { return; }

  try {
    const next = rerunStep({ state, feedback: feedback.trim() || undefined });
    saveRun(root, next);
    void vscode.window.showInformationMessage(
      `Step "${step.agent}" reset (revision ${next.steps[state.currentStepIdx].revision}). Run the slash command again, then "Mark step done".`,
    );
  } catch (err) {
    surfaceRunError(err);
  }
}

/**
 * Webview-driven update request: rewind an already-approved step (and
 * downstream steps) so the user can re-do them after a requirement change.
 * Carries the supplied feedback to the rewound step. Mirrors run state
 * into the epic's state.json via `saveRun`.
 */
export async function requestStepUpdateInlineCommand(
  runId: string,
  stepIdx: number,
  feedback: string,
): Promise<void> {
  const root = requireRoot('Request Step Update');
  if (!root) { return; }
  const state = RunStateStore.load(root, runId);
  if (!state) { return; }
  const pipeline = loadPipeline(root, state.pipelineId);
  if (!pipeline) {
    void vscode.window.showErrorMessage(
      `Run "${runId}" references pipeline "${state.pipelineId}" which is no longer in workspace.yaml.`,
    );
    return;
  }
  try {
    const next = requestStepUpdate({
      state,
      pipeline,
      stepIdx,
      feedback: feedback.trim() || undefined,
    });
    saveRun(root, next);
    const target = next.steps[stepIdx];
    void vscode.window.showInformationMessage(
      `Step "${target.agent}" reopened (revision ${target.revision}). Downstream steps reset to pending — work them again after this one.`,
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

export async function deleteRunCommand(
  runIdArg?: string,
  /** When true, skip the VS Code confirm dialog (the webview already showed an
   * inline ConfirmModal). Always false for command-palette invocations. */
  skipConfirm = false,
): Promise<void> {
  const root = requireRoot('Delete Run');
  if (!root) { return; }
  const runId = await resolveRunId(root, runIdArg);
  if (!runId) { return; }
  if (!skipConfirm) {
    const choice = await vscode.window.showWarningMessage(
      `Delete run "${runId}"? The state JSON is removed; produced artifacts on disk are kept.`,
      { modal: false },
      'Delete', 'Cancel',
    );
    if (choice !== 'Delete') { return; }
  }
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
