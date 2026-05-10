/**
 * State machine for a pipeline run.
 *
 * Pure functions over {@link RunState}: each transition takes the current
 * state + a pipeline definition and returns the next state. The store
 * persists; nothing here touches the filesystem (except gate-check, which
 * is a read-only `existsSync` against produced artifacts).
 *
 * Phase 1 implements:
 *   - start: scaffold a fresh RunState from a pipeline + context map
 *   - markStepDone: validate the current step's `produces` exist; transition
 *     to awaiting_review (if human_review) or auto-approve + advance
 *   - approve: human accepts current awaiting_review step → advance
 *   - reject: human rejects current awaiting_review step → step rejected
 *     (in-place) OR cascade to an upstream step with intermediate steps
 *     reset to pending
 *   - rerun: user retries a rejected step → revision++, back to awaiting_work
 *
 * Phase 2 will layer in: requires gate-check on advance, hooks (before/after
 * step), automatic worker dispatch.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { PipelineConfig } from '../schema/WorkspaceSchema';
import { normalizeStep } from '../schema/WorkspaceSchema';
import type { RunState, StepRecord, AutoReviewVerdict, StepHistoryEntry } from './RunState';
import { resolvePath } from './RunState';

export class PipelineRunError extends Error {
  constructor(message: string, public readonly missing?: string[]) {
    super(message);
    this.name = 'PipelineRunError';
  }
}

/**
 * Create a fresh run for the given pipeline + context. Caller persists
 * the result via {@link RunStateStore.save}.
 *
 * Throws if the pipeline has zero steps (caught by Zod, but we double-
 * check so a misconfigured runtime doesn't produce an invalid run).
 */
export function startRun(args: {
  runId: string;
  pipeline: PipelineConfig;
  context: Record<string, string>;
}): RunState {
  const { runId, pipeline, context } = args;
  if (pipeline.steps.length === 0) {
    throw new PipelineRunError(`Pipeline "${pipeline.id}" has no steps`);
  }
  const now = new Date().toISOString();
  const steps: StepRecord[] = pipeline.steps.map((s, idx) => {
    const norm = normalizeStep(s);
    return {
      stepIdx: idx,
      agent: norm.agent,
      revision: 1,
      status: idx === 0 ? 'awaiting_work' : 'pending',
      startedAt: idx === 0 ? now : undefined,
      artifactsProduced: [],
    };
  });
  return {
    schemaVersion: 1,
    runId,
    pipelineId: pipeline.id,
    context: { ...context },
    startedAt: now,
    updatedAt: now,
    currentStepIdx: 0,
    status: 'running',
    steps,
  };
}

/**
 * Soft gate-check for a step's `requires`. Returns `{ ok: true }` when all
 * required upstream artifacts exist on disk, `{ ok: false, missing: [...] }`
 * otherwise. Used by the extension UI to surface a warning *before* the user
 * starts work on a step (e.g. show a banner / disable the "Mark step done"
 * button) — orthogonal to the hard-block at markStepDone time.
 *
 * Pure read-only — does not mutate state, does not throw.
 */
export function canStartStep(args: {
  state: RunState;
  pipeline: PipelineConfig;
  workspaceRoot: string;
  /** Defaults to the current step. */
  stepIdx?: number;
}): { ok: true } | { ok: false; missing: string[] } {
  const { state, pipeline, workspaceRoot } = args;
  const idx = args.stepIdx ?? state.currentStepIdx;
  const stepConfig = pipeline.steps[idx];
  if (!stepConfig) {
    return { ok: false, missing: [`(no step at index ${idx})`] };
  }
  const norm = normalizeStep(stepConfig);
  const missing: string[] = [];
  for (const rel of norm.requires.map((p) => resolvePath(p, state.context))) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * User clicked "Mark step done". Validate the current step's `requires` AND
 * `produces` paths exist relative to workspaceRoot. On success, transition to:
 *
 *   - `awaiting_auto_review` when `auto_review: true`  (validator pending)
 *   - `awaiting_review`      when `human_review: true` and no auto-review
 *   - `approved` + advance   when neither gate is configured
 *
 * Throws PipelineRunError with `missing` populated when artifacts aren't
 * found — caller surfaces this in the UI so the user can fix and retry.
 */
export function markStepDone(args: {
  state: RunState;
  pipeline: PipelineConfig;
  workspaceRoot: string;
}): RunState {
  const { state, pipeline, workspaceRoot } = args;
  const idx = state.currentStepIdx;
  const step = state.steps[idx];
  if (!step) {
    throw new PipelineRunError(`No step at index ${idx}`);
  }
  if (step.status !== 'awaiting_work') {
    throw new PipelineRunError(
      `Cannot mark step "${step.agent}" done: status is "${step.status}", expected "awaiting_work"`,
    );
  }

  const stepConfig = pipeline.steps[idx];
  if (!stepConfig) {
    throw new PipelineRunError(`Pipeline mismatch — index ${idx} not in pipeline.steps`);
  }
  const norm = normalizeStep(stepConfig);

  // Hard gate-check on requires (separate from the soft check at start time).
  const resolvedRequires = norm.requires.map((p) => resolvePath(p, state.context));
  const missingRequires: string[] = [];
  for (const rel of resolvedRequires) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) { missingRequires.push(rel); }
  }
  if (missingRequires.length > 0) {
    throw new PipelineRunError(
      `Step "${step.agent}" is blocked — required upstream artifacts are missing.`,
      missingRequires,
    );
  }

  // Validate produces — each path resolved with run context, then existsSync.
  const resolvedProduces = norm.produces.map((p) => resolvePath(p, state.context));
  const missing: string[] = [];
  for (const rel of resolvedProduces) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); }
  }
  if (missing.length > 0) {
    throw new PipelineRunError(
      `Step "${step.agent}" has not produced its expected artifacts.`,
      missing,
    );
  }

  const next = clone(state);
  const nextStep = next.steps[idx];
  nextStep.artifactsProduced = resolvedProduces;
  // Clear any prior verdict so the new run gets a fresh one.
  nextStep.autoReviewVerdict = undefined;

  if (norm.auto_review) {
    nextStep.status = 'awaiting_auto_review';
    next.status = 'running';
    return next;
  }

  if (norm.human_review) {
    nextStep.status = 'awaiting_review';
    next.status = 'running';
    return next;
  }

  // Neither gate — auto-approve + advance.
  return advance(next, idx, pipeline);
}

/**
 * Apply an auto-reviewer verdict to the current `awaiting_auto_review` step.
 *
 *   - decision: 'pass' + step has `human_review: true`  → `awaiting_review`
 *   - decision: 'pass' + no human gate                  → approve + advance
 *   - decision: 'reject'                                → `rejected` + reason
 *
 * The verdict is also stored on the step record so the human reviewer (and
 * the rerun flow) can see why the validator failed.
 */
export function submitAutoReviewVerdict(args: {
  state: RunState;
  pipeline: PipelineConfig;
  verdict: AutoReviewVerdict;
}): RunState {
  const { state, pipeline, verdict } = args;
  const idx = state.currentStepIdx;
  const step = state.steps[idx];
  if (!step) {
    throw new PipelineRunError(`No step at index ${idx}`);
  }
  if (step.status !== 'awaiting_auto_review') {
    throw new PipelineRunError(
      `Cannot submit auto-review verdict for step "${step.agent}": status is "${step.status}", expected "awaiting_auto_review"`,
    );
  }

  const stepConfig = pipeline.steps[idx];
  if (!stepConfig) {
    throw new PipelineRunError(`Pipeline mismatch — index ${idx} not in pipeline.steps`);
  }
  const norm = normalizeStep(stepConfig);

  const next = clone(state);
  const nextStep = next.steps[idx];
  nextStep.autoReviewVerdict = verdict;
  nextStep.history = pushHistory(nextStep.history, {
    kind: 'auto_review',
    at: verdict.at,
    revision: nextStep.revision,
    decision: verdict.decision,
    reason: verdict.reason,
    runner: verdict.runner,
  });

  if (verdict.decision === 'reject') {
    nextStep.status = 'rejected';
    nextStep.rejectReason = verdict.reason;
    nextStep.history = pushHistory(nextStep.history, {
      kind: 'reject',
      at: verdict.at,
      revision: nextStep.revision,
      reason: verdict.reason,
      sentBackToIdx: idx,
    });
    next.status = 'running';
    return next;
  }

  // pass
  if (norm.human_review) {
    nextStep.status = 'awaiting_review';
    next.status = 'running';
    return next;
  }

  return advance(next, idx, pipeline);
}

/** Human approved the awaiting_review step → advance to next. */
export function approveStep(args: {
  state: RunState;
  pipeline: PipelineConfig;
}): RunState {
  const { state, pipeline } = args;
  const idx = state.currentStepIdx;
  const step = state.steps[idx];
  if (!step) {
    throw new PipelineRunError(`No step at index ${idx}`);
  }
  if (step.status !== 'awaiting_review') {
    throw new PipelineRunError(
      `Cannot approve step "${step.agent}": status is "${step.status}", expected "awaiting_review"`,
    );
  }
  return advance(clone(state), idx, pipeline);
}

/**
 * Human rejected the awaiting_review step.
 *
 * Two modes:
 *   - In-place (default, `targetIdx` omitted or === currentStepIdx): the
 *     current step transitions to `rejected`. The user clicks Rerun to bump
 *     revision and try again on the same step.
 *   - Cascade upstream (`targetIdx < currentStepIdx`): the work needs to go
 *     back to an earlier step (e.g. PRD missing a requirement caught at
 *     review time). The target step is reset to `awaiting_work` with
 *     revision++, intermediate steps + the rejected current step are reset
 *     to `pending` and lose their artifacts/verdicts. The reject reason is
 *     copied into the target step's `feedback` so the user has context when
 *     they redo upstream work. `currentStepIdx` rewinds to the target.
 */
export function rejectStep(args: {
  state: RunState;
  reason?: string;
  targetIdx?: number;
}): RunState {
  const { state, reason, targetIdx } = args;
  const idx = state.currentStepIdx;
  const step = state.steps[idx];
  if (!step) {
    throw new PipelineRunError(`No step at index ${idx}`);
  }
  if (step.status !== 'awaiting_review') {
    throw new PipelineRunError(
      `Cannot reject step "${step.agent}": status is "${step.status}", expected "awaiting_review"`,
    );
  }

  const now = new Date().toISOString();
  const isCascade = typeof targetIdx === 'number' && targetIdx >= 0 && targetIdx < idx;
  if (isCascade) {
    const next = clone(state);
    const blame = `Rejected at step ${idx + 1} (${step.agent})${reason ? `: ${reason}` : ''}`;
    // History on the rejected step: a `reject` entry pointing at the cascade
    // target so a future viewer can see "step N was rejected, work bounced
    // back to step M".
    const rejectedHistory = pushHistory(next.steps[idx].history, {
      kind: 'reject',
      at: now,
      revision: next.steps[idx].revision,
      reason,
      sentBackToIdx: targetIdx as number,
    });
    for (let i = targetIdx as number; i <= idx; i++) {
      const s = next.steps[i];
      if (i === (targetIdx as number)) {
        // Target step: bump revision + reset to awaiting_work. Record the
        // cascade-rerun on its own history.
        const newRev = s.revision + 1;
        next.steps[i] = {
          ...s,
          status: 'awaiting_work',
          revision: newRev,
          feedback: blame,
          rejectReason: undefined,
          autoReviewVerdict: undefined,
          artifactsProduced: [],
          finishedAt: undefined,
          startedAt: now,
          history: pushHistory(s.history, {
            kind: 'rerun',
            at: now,
            revision: newRev,
            feedback: blame,
          }),
        };
      } else if (i === idx) {
        // The rejected step keeps its full history + the new reject entry,
        // even though we're about to reset its working fields.
        next.steps[i] = {
          ...s,
          status: 'pending',
          rejectReason: undefined,
          autoReviewVerdict: undefined,
          artifactsProduced: [],
          startedAt: undefined,
          finishedAt: undefined,
          history: rejectedHistory,
        };
      } else {
        // Intermediate step (target < i < idx). Reset to pending, history
        // preserved as-is — these steps weren't directly involved in this
        // rejection.
        next.steps[i] = {
          ...s,
          status: 'pending',
          rejectReason: undefined,
          autoReviewVerdict: undefined,
          artifactsProduced: [],
          startedAt: undefined,
          finishedAt: undefined,
        };
      }
    }
    next.currentStepIdx = targetIdx as number;
    next.status = 'running';
    return next;
  }

  const next = clone(state);
  next.steps[idx] = {
    ...step,
    status: 'rejected',
    rejectReason: reason ?? '',
    history: pushHistory(step.history, {
      kind: 'reject',
      at: now,
      revision: step.revision,
      reason,
      sentBackToIdx: idx,
    }),
  };
  next.status = 'running';
  return next;
}

/**
 * User wants to retry a rejected step (presumably after re-reading
 * `feedback`). Resets the step to awaiting_work and bumps revision.
 * Optional `feedback` is stored on the step record so the user can keep
 * track of what they're addressing this time.
 */
export function rerunStep(args: {
  state: RunState;
  feedback?: string;
}): RunState {
  const { state, feedback } = args;
  const idx = state.currentStepIdx;
  const step = state.steps[idx];
  if (!step) {
    throw new PipelineRunError(`No step at index ${idx}`);
  }
  if (step.status !== 'rejected') {
    throw new PipelineRunError(
      `Cannot rerun step "${step.agent}": status is "${step.status}", expected "rejected"`,
    );
  }
  const now = new Date().toISOString();
  const next = clone(state);
  const newRev = step.revision + 1;
  const carriedFeedback = feedback ?? step.feedback;
  next.steps[idx] = {
    ...step,
    status: 'awaiting_work',
    revision: newRev,
    feedback: carriedFeedback,
    rejectReason: undefined,
    artifactsProduced: [],
    startedAt: now,
    history: pushHistory(step.history, {
      kind: 'rerun',
      at: now,
      revision: newRev,
      feedback: carriedFeedback,
    }),
  };
  next.status = 'running';
  return next;
}

/**
 * Request an update on a previously-approved step. Triggered by the user
 * outside the awaiting_review flow when requirements change after the step
 * was approved (or after the run already moved past it). Behaves like a
 * cascade reject but is callable from any current state:
 *
 *   - The targeted step rewinds to `awaiting_work` with revision++ and the
 *     supplied feedback carried forward (so the next agent run sees what
 *     changed).
 *   - All steps downstream of the target up to the current step (or end of
 *     pipeline if the run already completed) are reset to `pending`,
 *     losing their artifactsProduced / verdicts. Their history is
 *     preserved — UI can show "previously done, awaiting update".
 *   - currentStepIdx rewinds to the target step.
 *   - The whole run flips to `running` if it was completed.
 *
 * History on the target step records both a `rerun` entry (since revision
 * bumps) for symmetry with the regular rerun flow, so the audit trail
 * answers the question "why did this step get redone?".
 */
export function requestStepUpdate(args: {
  state: RunState;
  pipeline: PipelineConfig;
  stepIdx: number;
  feedback?: string;
}): RunState {
  const { state, pipeline, stepIdx, feedback } = args;
  if (
    !Number.isInteger(stepIdx) ||
    stepIdx < 0 ||
    stepIdx >= state.steps.length
  ) {
    throw new PipelineRunError(`Invalid stepIdx ${stepIdx}`);
  }
  const target = state.steps[stepIdx];
  if (target.status !== 'approved') {
    throw new PipelineRunError(
      `Cannot request update on step "${target.agent}": status is "${target.status}", expected "approved"`,
    );
  }

  const now = new Date().toISOString();
  const next = clone(state);
  // upper bound for the reset range — the current step (inclusive). If the
  // run already completed we still go through the very last step.
  const upper = state.status === 'completed'
    ? pipeline.steps.length - 1
    : state.currentStepIdx;

  for (let i = stepIdx; i <= upper; i++) {
    const s = next.steps[i];
    if (i === stepIdx) {
      const newRev = s.revision + 1;
      next.steps[i] = {
        ...s,
        status: 'awaiting_work',
        revision: newRev,
        feedback: feedback ?? s.feedback,
        rejectReason: undefined,
        autoReviewVerdict: undefined,
        artifactsProduced: [],
        finishedAt: undefined,
        startedAt: now,
        history: pushHistory(s.history, {
          kind: 'rerun',
          at: now,
          revision: newRev,
          feedback: feedback ?? s.feedback,
        }),
      };
    } else {
      // Downstream step — reset to pending, KEEP history so the UI can
      // distinguish "previously done, awaiting update" from "never reached".
      next.steps[i] = {
        ...s,
        status: 'pending',
        rejectReason: undefined,
        autoReviewVerdict: undefined,
        artifactsProduced: [],
        startedAt: undefined,
        finishedAt: undefined,
      };
    }
  }
  next.currentStepIdx = stepIdx;
  next.status = 'running';
  return next;
}

/** Mark the current step approved + open the next step (or complete the run). */
function advance(next: RunState, idx: number, pipeline: PipelineConfig): RunState {
  const finishedAt = new Date().toISOString();
  const approved = next.steps[idx];
  next.steps[idx] = {
    ...approved,
    status: 'approved',
    finishedAt,
    history: pushHistory(approved.history, {
      kind: 'approve',
      at: finishedAt,
      revision: approved.revision,
    }),
  };
  const nextIdx = idx + 1;
  if (nextIdx >= pipeline.steps.length) {
    next.status = 'completed';
    return next;
  }
  next.currentStepIdx = nextIdx;
  next.steps[nextIdx] = {
    ...next.steps[nextIdx],
    status: 'awaiting_work',
    startedAt: finishedAt,
  };
  next.status = 'running';
  return next;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pushHistory(
  existing: StepHistoryEntry[] | undefined,
  entry: StepHistoryEntry,
): StepHistoryEntry[] {
  return existing ? [...existing, entry] : [entry];
}
