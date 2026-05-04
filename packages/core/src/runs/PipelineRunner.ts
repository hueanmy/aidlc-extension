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
 *   - rerun: user retries a rejected step → revision++, back to awaiting_work
 *
 * Phase 2 will layer in: requires gate-check on advance, hooks (before/after
 * step), reject-to-upstream cascade, automatic worker dispatch.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { PipelineConfig } from '../schema/WorkspaceSchema';
import { normalizeStep } from '../schema/WorkspaceSchema';
import type { RunState, StepRecord } from './RunState';
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
 * User clicked "Mark step done". Validate the current step's `produces`
 * paths exist relative to workspaceRoot. On success, transition to
 * awaiting_review (when human_review) or approved + advance to next step.
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

  if (norm.human_review) {
    nextStep.status = 'awaiting_review';
    next.status = 'running';
    return next;
  }

  // Auto-approve + advance.
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

/** Human rejected the awaiting_review step. Stays current; can rerun. */
export function rejectStep(args: {
  state: RunState;
  reason?: string;
}): RunState {
  const { state, reason } = args;
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
  const next = clone(state);
  next.steps[idx] = {
    ...step,
    status: 'rejected',
    rejectReason: reason ?? '',
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
  const next = clone(state);
  next.steps[idx] = {
    ...step,
    status: 'awaiting_work',
    revision: step.revision + 1,
    feedback: feedback ?? step.feedback,
    rejectReason: undefined,
    artifactsProduced: [],
    startedAt: new Date().toISOString(),
  };
  next.status = 'running';
  return next;
}

/** Mark the current step approved + open the next step (or complete the run). */
function advance(next: RunState, idx: number, pipeline: PipelineConfig): RunState {
  const finishedAt = new Date().toISOString();
  next.steps[idx] = {
    ...next.steps[idx],
    status: 'approved',
    finishedAt,
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
