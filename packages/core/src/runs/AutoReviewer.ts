/**
 * Auto-reviewer runner.
 *
 * Resolves the per-step `auto_review_runner` script path, loads it via
 * dynamic import (ESM-friendly), and invokes its default export with a
 * structured context. The validator returns a verdict the caller hands back
 * to {@link submitAutoReviewVerdict}.
 *
 * The validator contract is intentionally minimal — it's the user's own code
 * (e.g. `./scripts/validate-prd.mjs`), not a sandbox. We don't try to
 * sandbox it; if the script throws, we surface that as a `reject` verdict so
 * the run doesn't get stuck.
 *
 * ## Validator module shape
 *
 * ```js
 * // .aidlc/scripts/validate-prd.mjs
 * export default async function ({ workspaceRoot, state, step, pipeline, paths }) {
 *   const fs = await import('node:fs');
 *   const prd = fs.readFileSync(paths.produces[0], 'utf8');
 *   if (!prd.includes('## Acceptance Criteria')) {
 *     return { decision: 'reject', reason: 'PRD missing Acceptance Criteria section.' };
 *   }
 *   return { decision: 'pass', reason: 'PRD has all required sections.' };
 * }
 * ```
 *
 * Synchronous returns are also accepted.
 */

import * as path from 'path';
import { pathToFileURL } from 'url';

import type { PipelineConfig } from '../schema/WorkspaceSchema';
import { normalizeStep } from '../schema/WorkspaceSchema';
import type { RunState, AutoReviewVerdict, StepRecord } from './RunState';

export class AutoReviewerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AutoReviewerError';
  }
}

export interface AutoReviewerContext {
  workspaceRoot: string;
  state: RunState;
  step: StepRecord;
  pipeline: PipelineConfig;
  /** Convenience: produces / requires absolute paths. */
  paths: {
    produces: string[];
    requires: string[];
  };
}

export type AutoReviewerFn = (
  ctx: AutoReviewerContext,
) => AutoReviewVerdict | Promise<AutoReviewVerdict> | { decision: 'pass' | 'reject'; reason: string } | Promise<{ decision: 'pass' | 'reject'; reason: string }>;

/**
 * Resolve, import, and invoke a step's auto_review_runner.
 *
 * Throws AutoReviewerError if the path is missing, can't be loaded, or the
 * default export is not callable. Validator-internal errors are converted
 * to a `reject` verdict so the run can proceed (rerun after fix).
 */
export async function runAutoReview(args: {
  workspaceRoot: string;
  state: RunState;
  pipeline: PipelineConfig;
  /** Optional override — defaults to current step's index. */
  stepIdx?: number;
}): Promise<AutoReviewVerdict> {
  const { workspaceRoot, state, pipeline } = args;
  const idx = args.stepIdx ?? state.currentStepIdx;
  const step = state.steps[idx];
  if (!step) {
    throw new AutoReviewerError(`No step at index ${idx}`);
  }
  const stepConfig = pipeline.steps[idx];
  if (!stepConfig) {
    throw new AutoReviewerError(`Pipeline mismatch — index ${idx} not in pipeline.steps`);
  }
  const norm = normalizeStep(stepConfig);
  if (!norm.auto_review || !norm.auto_review_runner) {
    throw new AutoReviewerError(
      `Step "${norm.agent}" does not have auto_review_runner configured.`,
    );
  }

  const scriptPath = path.isAbsolute(norm.auto_review_runner)
    ? norm.auto_review_runner
    : path.join(workspaceRoot, norm.auto_review_runner);

  let mod: { default?: AutoReviewerFn } | AutoReviewerFn;
  try {
    // Dynamic import accepts file:// URLs which is the most reliable form
    // for absolute paths across platforms (Windows in particular).
    const url = pathToFileURL(scriptPath).href;
    mod = await import(url);
  } catch (err) {
    throw new AutoReviewerError(
      `Failed to load auto_review_runner "${norm.auto_review_runner}": ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const fn: AutoReviewerFn | undefined =
    typeof mod === 'function' ? mod : (mod as { default?: AutoReviewerFn }).default;
  if (typeof fn !== 'function') {
    throw new AutoReviewerError(
      `auto_review_runner "${norm.auto_review_runner}" must export a default function (got ${typeof fn}).`,
    );
  }

  const producesAbs = step.artifactsProduced.map((p) =>
    path.isAbsolute(p) ? p : path.join(workspaceRoot, p),
  );
  const requiresAbs = norm.requires.map((p) =>
    path.isAbsolute(p) ? p : path.join(workspaceRoot, p),
  );

  const ctx: AutoReviewerContext = {
    workspaceRoot,
    state,
    step,
    pipeline,
    paths: { produces: producesAbs, requires: requiresAbs },
  };

  const at = new Date().toISOString();
  const runner = scriptPath;

  let raw: { decision: 'pass' | 'reject'; reason: string };
  try {
    raw = await Promise.resolve(fn(ctx));
  } catch (err) {
    return {
      decision: 'reject',
      reason: `Auto-reviewer threw: ${err instanceof Error ? err.message : String(err)}`,
      at,
      runner,
    };
  }

  if (!raw || (raw.decision !== 'pass' && raw.decision !== 'reject') || typeof raw.reason !== 'string') {
    return {
      decision: 'reject',
      reason: `Auto-reviewer returned malformed verdict: ${JSON.stringify(raw)}`,
      at,
      runner,
    };
  }

  return { decision: raw.decision, reason: raw.reason, at, runner };
}
