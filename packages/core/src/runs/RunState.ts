/**
 * Persistent state for an in-flight pipeline run.
 *
 * One run = one execution of one pipeline against one "subject" (typically an
 * epic key like `DRM-2100`, but the runner is agnostic — `runId` is just a
 * filesystem-safe identifier). State files live at
 * `<workspace>/.aidlc/runs/<runId>.json` and act as the single source of
 * truth for what step the user is on, which steps passed/failed, and what
 * feedback the human supplied on rejected steps.
 *
 * The state machine is intentionally simple in phase 1:
 *
 *   awaiting_work  → user runs the slash command externally, comes back to
 *                    "Mark step done"
 *   awaiting_review → step produced its artifacts; pause for human approve
 *                     / reject
 *   approved       → step passed; runner advances currentStepIdx
 *   rejected       → step rejected by human; user can rerun (revision++)
 *
 * Phase 2 will add: gate-check on `requires` paths, hooks (before/after
 * step), reject-to-upstream cascade, automatic worker dispatch via the
 * runner registry.
 */

export type StepStatus =
  | 'pending'           // not yet reached
  | 'awaiting_work'     // current step, user is doing the work externally
  | 'awaiting_review'   // produces validated, paused for human approve/reject
  | 'approved'          // human approved (or auto-approved when human_review=false)
  | 'rejected';         // human rejected; can rerun

export type RunStatus =
  | 'running'           // a step is awaiting_work or awaiting_review
  | 'completed'         // all steps approved
  | 'failed';           // produces validation failed and not recoverable

export interface StepRecord {
  /** Index into pipeline.steps[]. */
  stepIdx: number;
  /** Agent id for this step (resolved from pipeline.steps[stepIdx]). */
  agent: string;
  /** Bumps each time the user reruns this step after a rejection. Starts at 1. */
  revision: number;
  status: StepStatus;
  /** ISO timestamp when this step first transitioned to awaiting_work. */
  startedAt?: string;
  /** ISO timestamp when this step transitioned to approved. */
  finishedAt?: string;
  /**
   * Resolved produces paths (placeholders substituted from run context).
   * Filled in when the step transitions to awaiting_review or approved.
   */
  artifactsProduced: string[];
  /** Optional human feedback supplied at rerun time. Carried forward. */
  feedback?: string;
  /** Reason supplied with the most recent rejection. Cleared on rerun. */
  rejectReason?: string;
}

export interface RunState {
  schemaVersion: 1;
  /** Unique within the workspace; used as the .json filename. */
  runId: string;
  /** Pipeline id this run is executing. Must exist in workspace.yaml. */
  pipelineId: string;
  /**
   * Free-form context map used for placeholder substitution in artifact
   * paths. Convention: `epic` → epic key, but any key can be used.
   */
  context: Record<string, string>;
  startedAt: string;
  updatedAt: string;
  /** Index of the step currently being worked / reviewed / rejected. */
  currentStepIdx: number;
  status: RunStatus;
  /** One entry per pipeline step, length === pipeline.steps.length. */
  steps: StepRecord[];
}

/**
 * Substitute `{key}` placeholders in an artifact path with values from the
 * run's context map. Unknown placeholders are left intact so the missing
 * key shows up in the produces validation error rather than silently
 * resolving to empty string.
 */
export function resolvePath(template: string, context: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key) => {
    const value = context[key];
    return typeof value === 'string' && value.length > 0 ? value : match;
  });
}
