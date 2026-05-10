/**
 * Read epic state files from disk so the Builder + sidebar can render a
 * "recent epics" view. Stays decoupled from the wizard — anything that
 * writes a `state.json` matching the shape gets picked up here.
 *
 * Cheap: scans <state.root> directly, reads each state.json. Counted in
 * milliseconds for a normal-size project (a few dozen epics). If/when we
 * cross the thousand-epic mark we'll add an indexed cache; not before.
 */

import * as fs from 'fs';
import * as path from 'path';

import { RunStateStore, normalizeStep, resolvePath } from '@aidlc/core';
import type {
  RunState,
  StepStatus,
  AutoReviewVerdict,
  PipelineConfig,
  PipelineStepConfig,
  StepHistoryEntry,
} from '@aidlc/core';

import { readYaml, type YamlDocument } from './yamlIO';
import {
  getOrComputeWorkspaceEpicUsage,
  type EpicUsage,
  type StepUsage,
} from './epicTokenAttribution';

export type EpicStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface EpicSummary {
  id: string;
  title: string;
  description: string;
  status: EpicStatus;
  createdAt: string;
  pipeline: string | null;
  agent: string | null;
  agents: string[];
  currentStep: number;
  stepStatuses: EpicStatus[];
  /** Per-step detail (timing, future fields). Same length as agents. */
  stepDetails: Array<{
    agent: string;
    status: EpicStatus;
    startedAt: string | null;
    finishedAt: string | null;
    /**
     * When this epic has a matching pipeline run (`.aidlc/runs/<id>.json`),
     * this is the per-step status from the run-state machine. Richer than
     * `status` — surfaces `awaiting_work` / `awaiting_auto_review` /
     * `awaiting_review` / `rejected` so the panel can show the right
     * action buttons.
     */
    runStatus: StepStatus | null;
    /** True when this is the current step of an active run. */
    isCurrentRunStep: boolean;
    /** Most recent rejection reason for this step, when rejected. */
    rejectReason?: string;
    /** Most recent auto-reviewer verdict (persists through the human gate). */
    autoReviewVerdict?: AutoReviewVerdict;
    /** Step config: does this step opt into auto_review in the pipeline yaml? */
    stepHasAutoReview: boolean;
    /** Step config: does this step opt into human_review in the pipeline yaml? */
    stepHasHumanReview: boolean;
    /** Append-only timeline of significant transitions for this step. */
    history?: StepHistoryEntry[];
    /** Cached count of `reject` entries in `history` — for compact display. */
    rejectCount: number;
    /** Carried feedback (from cascade reject or manual rerun feedback). */
    feedback?: string;
    /** Token usage attributed to this step (filled by `enrichEpicsWithUsage`). */
    tokenUsage?: StepUsage;
  }>;
  /** Aggregate token usage for the epic (filled by `enrichEpicsWithUsage`). */
  tokenUsage?: EpicUsage;
  /**
   * runId of the matching run state, if any. Convention: runId === epic.id.
   * When set, the panel can dispatch `aidlc.markStepDone` etc. with this id.
   */
  runId: string | null;
  /** Resolved inputs (capability id → user-supplied value). Keys may be empty. */
  inputs: Record<string, string>;
  inputsCount: number;
  /** Absolute path to state.json — used by the webview to open the file. */
  statePath: string;
  /** Absolute path to the epic dir (for opening artifacts/). */
  epicDir: string;
}

const STATUS_VALUES: ReadonlyArray<EpicStatus> = ['pending', 'in_progress', 'done', 'failed'];

function asStatus(v: unknown): EpicStatus {
  return STATUS_VALUES.includes(v as EpicStatus) ? (v as EpicStatus) : 'pending';
}

/**
 * Resolve the directory holding epic folders. Honours
 * workspace.yaml's `state.root` field; falls back to `docs/epics`.
 */
export function epicsRoot(workspaceRoot: string, doc: YamlDocument | null): string {
  const stateRoot = doc?.state && typeof (doc.state as Record<string, unknown>).root === 'string'
    ? String((doc.state as Record<string, unknown>).root)
    : 'docs/epics';
  return path.resolve(workspaceRoot, stateRoot);
}

export function listEpics(workspaceRoot: string, doc: YamlDocument | null): EpicSummary[] {
  const dir = epicsRoot(workspaceRoot, doc);
  if (!fs.existsSync(dir)) { return []; }

  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const epics: EpicSummary[] = [];
  for (const folder of folders) {
    const epicDir = path.join(dir, folder);
    const stateFile = path.join(epicDir, 'state.json');
    if (!fs.existsSync(stateFile)) { continue; }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch { continue; }
    if (!parsed || typeof parsed !== 'object') { continue; }

    const stepStatesRaw = Array.isArray(parsed.stepStates)
      ? (parsed.stepStates as Array<Record<string, unknown>>)
      : [];

    const epicId = typeof parsed.id === 'string' ? parsed.id : folder;

    // Overlay run-state if there's a matching pipeline run. The runId
    // convention is `runId === epic.id`, set by `startPipelineRunCommand`.
    // Wrap in try/catch so a malformed run file doesn't break the epic
    // listing (the epic still renders with run-status === null).
    let runState = null;
    try {
      runState = RunStateStore.load(workspaceRoot, epicId);
    } catch { /* invalid runId — treat as no run */ }
    const runStepByAgent = new Map<string, StepStatus>();
    const runRejectByAgent = new Map<string, string>();
    const runVerdictByAgent = new Map<string, AutoReviewVerdict>();
    const runHistoryByAgent = new Map<string, StepHistoryEntry[]>();
    const runFeedbackByAgent = new Map<string, string>();
    if (runState) {
      for (const sr of runState.steps) {
        runStepByAgent.set(sr.agent, sr.status);
        if (sr.rejectReason) { runRejectByAgent.set(sr.agent, sr.rejectReason); }
        if (sr.autoReviewVerdict) { runVerdictByAgent.set(sr.agent, sr.autoReviewVerdict); }
        if (sr.history && sr.history.length > 0) {
          runHistoryByAgent.set(sr.agent, sr.history);
        }
        if (sr.feedback) { runFeedbackByAgent.set(sr.agent, sr.feedback); }
      }
    }
    const runCurrentAgent = runState
      ? runState.steps[runState.currentStepIdx]?.agent
      : undefined;

    // Look up the pipeline definition from workspace.yaml so we can surface
    // each step's configured gates (auto_review / human_review) on the panel.
    const pipelineId = typeof parsed.pipeline === 'string' ? parsed.pipeline : null;
    const pipelineCfg = pipelineId
      ? (doc?.pipelines as PipelineConfig[] | undefined)?.find((p) => p.id === pipelineId)
      : undefined;
    const stepGateByIdx = new Map<number, { auto: boolean; human: boolean }>();
    if (pipelineCfg && Array.isArray(pipelineCfg.steps)) {
      pipelineCfg.steps.forEach((raw, i) => {
        const norm = normalizeStep(raw as PipelineStepConfig);
        stepGateByIdx.set(i, { auto: norm.auto_review, human: norm.human_review });
      });
    }

    const stepDetails = stepStatesRaw.map((s, i) => {
      const agent = typeof s.agent === 'string' ? s.agent : '';
      const gate = stepGateByIdx.get(i) ?? { auto: false, human: false };
      const runStatus = runStepByAgent.get(agent) ?? null;
      const history = runHistoryByAgent.get(agent);
      const rejectCount = history
        ? history.filter((e) => e.kind === 'reject').length
        : 0;
      // The state.json's per-step status doesn't sync from the run-state
      // machine, so prefer the run status when it's present. Mapping:
      //   approved                                  → done
      //   rejected                                  → failed
      //   awaiting_work | awaiting_auto_review |
      //   awaiting_review                           → in_progress
      //   pending / no run                          → fall back to state.json
      const displayStatus =
        runStatus === 'approved'
          ? ('done' as const)
          : runStatus === 'rejected'
          ? ('failed' as const)
          : runStatus === 'awaiting_work'
          || runStatus === 'awaiting_auto_review'
          || runStatus === 'awaiting_review'
          ? ('in_progress' as const)
          : asStatus(s.status);
      return {
        agent,
        status: displayStatus,
        startedAt: typeof s.startedAt === 'string' ? s.startedAt : null,
        finishedAt: typeof s.finishedAt === 'string' ? s.finishedAt : null,
        runStatus,
        isCurrentRunStep: !!runState && agent === runCurrentAgent,
        rejectReason: runRejectByAgent.get(agent),
        autoReviewVerdict: runVerdictByAgent.get(agent),
        stepHasAutoReview: gate.auto,
        stepHasHumanReview: gate.human,
        history,
        rejectCount,
        feedback: runFeedbackByAgent.get(agent),
      };
    });

    const inputs = readInputs(epicDir);

    // The state.json's overall status doesn't sync from the run-state
    // machine either, so when a runState is present, derive epic status
    // from it (completed → done; any rejected step → failed; otherwise
    // in_progress). Falls back to state.json when no runState exists.
    const epicStatus = runState
      ? runState.status === 'completed'
        ? 'done' as const
        : runState.steps.some((sr) => sr.status === 'rejected')
        ? 'failed' as const
        : 'in_progress' as const
      : asStatus(parsed.status);
    const currentStep = runState
      ? runState.currentStepIdx
      : (typeof parsed.currentStep === 'number' ? parsed.currentStep : 0);

    epics.push({
      id: epicId,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      status: epicStatus,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      pipeline: typeof parsed.pipeline === 'string' ? parsed.pipeline : null,
      agent: typeof parsed.agent === 'string' ? parsed.agent : null,
      agents: Array.isArray(parsed.agents) ? (parsed.agents as unknown[]).map(String) : [],
      currentStep,
      stepStatuses: stepDetails.map((s) => s.status),
      stepDetails,
      inputs,
      inputsCount: Object.keys(inputs).length,
      statePath: stateFile,
      epicDir,
      runId: runState ? runState.runId : null,
    });
  }

  // Newest first by createdAt; ties fall back to id.
  epics.sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    if (cmp !== 0) { return cmp; }
    return b.id.localeCompare(a.id);
  });
  return epics;
}

/**
 * Mutate the given epics in-place to fill in `tokenUsage` (epic-level) and
 * `stepDetails[].tokenUsage` (per-step) by attributing Claude jsonl records
 * to each epic's run state windows. Cheap on cache hit; async so a slow
 * jsonl walk doesn't block the sidebar refresh.
 */
export async function enrichEpicsWithUsage(
  workspaceRoot: string,
  epics: EpicSummary[],
): Promise<void> {
  const runs: RunState[] = [];
  const mtimes: number[] = [];
  for (const epic of epics) {
    if (!epic.runId) continue;
    const runFile = path.join(workspaceRoot, '.aidlc', 'runs', `${epic.runId}.json`);
    let stat: fs.Stats;
    try { stat = fs.statSync(runFile); } catch { continue; }
    let runState: RunState | null = null;
    try { runState = RunStateStore.load(workspaceRoot, epic.runId); }
    catch { continue; }
    if (!runState) continue;
    runs.push(runState);
    mtimes.push(stat.mtimeMs);
  }
  if (runs.length === 0) return;

  const usageByRunId = await getOrComputeWorkspaceEpicUsage(workspaceRoot, runs, mtimes);

  for (const epic of epics) {
    if (!epic.runId) continue;
    const u = usageByRunId.get(epic.runId);
    if (!u) continue;
    epic.tokenUsage = u;
    // Match per-step usage onto stepDetails by agent id (in order, so reruns
    // of the same agent map to the same step).
    for (let i = 0; i < epic.stepDetails.length; i++) {
      const sd = epic.stepDetails[i];
      const su = u.steps[i];
      if (su && su.agent === sd.agent) {
        sd.tokenUsage = su;
      }
    }
  }
}

function readInputs(epicDir: string): Record<string, string> {
  const inputsFile = path.join(epicDir, 'inputs.json');
  if (!fs.existsSync(inputsFile)) { return {}; }
  try {
    const parsed = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') { return {}; }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
  } catch { return {}; }
}

/**
 * Mirror the runtime `RunState` into the epic's `state.json` so the
 * persistent on-disk record stays in sync with the state machine. The
 * epic-state file is what gets committed (under `docs/epics/<id>/`), so
 * preserving step history + statuses there means another teammate who
 * pulls the repo can see the full audit trail without needing the local
 * `.aidlc/runs/` files.
 *
 * Convention: `runState.runId === epicId`. No-op when the epic dir
 * doesn't exist (the run isn't bound to an epic — e.g. a standalone
 * pipeline run kicked off from the sidebar).
 *
 * Idempotent: writes the full updated JSON each call. Failures are
 * surfaced to the caller; runCommands wraps this in try/catch so a
 * mirror failure can't block a state-machine transition.
 */
export function mirrorRunStateToEpic(
  workspaceRoot: string,
  runState: RunState,
  doc: YamlDocument | null,
): void {
  const dir = epicsRoot(workspaceRoot, doc);
  const epicDir = path.join(dir, runState.runId);
  const stateFile = path.join(epicDir, 'state.json');
  if (!fs.existsSync(stateFile)) { return; }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) ?? {};
    if (typeof parsed !== 'object' || parsed === null) { parsed = {}; }
  } catch {
    // Unparseable state.json: bail out rather than overwrite something the
    // user might be hand-editing. The runtime RunState file is the source
    // of truth for the live machine; we'll re-mirror on the next
    // transition.
    return;
  }

  const epicStatus =
    runState.status === 'completed'
      ? ('done' as const)
      : runState.steps.some((s) => s.status === 'rejected')
      ? ('failed' as const)
      : ('in_progress' as const);

  const stepStates = runState.steps.map((s) => ({
    agent: s.agent,
    status: mapStepStatus(s.status),
    revision: s.revision,
    runStatus: s.status,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    rejectReason: s.rejectReason,
    feedback: s.feedback,
    autoReviewVerdict: s.autoReviewVerdict,
    history: s.history ?? [],
    artifactsProduced: s.artifactsProduced,
  }));

  const next = {
    ...parsed,
    status: epicStatus,
    currentStep: runState.currentStepIdx,
    pipeline:
      typeof parsed.pipeline === 'string' ? parsed.pipeline : runState.pipelineId,
    agents: stepStates.map((s) => s.agent),
    stepStates,
    /** Last time the run-state machine touched this epic. */
    updatedAt: runState.updatedAt,
  };

  fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

function mapStepStatus(status: StepStatus): EpicStatus {
  switch (status) {
    case 'approved':
      return 'done';
    case 'rejected':
      return 'failed';
    case 'awaiting_work':
    case 'awaiting_auto_review':
    case 'awaiting_review':
      return 'in_progress';
    case 'pending':
    default:
      return 'pending';
  }
}

export interface MigrationReport {
  migrated: string[];
  backfilled: string[];
  skipped: Array<{ epicId: string; reason: string }>;
  errors: Array<{ epicId: string; reason: string }>;
}

/**
 * Walk every epic dir under <state.root>:
 *
 *   - Has a matching `.aidlc/runs/<id>.json`         → mirror it back
 *     into state.json so the on-disk schema picks up
 *     `revision` / `runStatus` / `history` / `feedback` /
 *     `autoReviewVerdict` / `artifactsProduced` and the epic-level
 *     `updatedAt`.
 *   - No runState but state.json exists (legacy flow)   → reconstruct a
 *     runState from state.json (per-step status mapping + inputs.json
 *     context + artifacts dir scan), persist it, then mirror back so
 *     the epic gets a full live run-state machine going forward.
 *   - Pipeline missing from workspace.yaml or unparseable state.json
 *     → record as an error and continue.
 *
 * Idempotent — re-running on a fully-migrated workspace is a no-op
 * since `mirrorRunStateToEpic` writes the same fields again and the
 * backfill branch only fires when no runState exists.
 */
export function migrateEpicStateFiles(workspaceRoot: string): MigrationReport {
  const report: MigrationReport = { migrated: [], backfilled: [], skipped: [], errors: [] };
  const doc = readYaml(workspaceRoot);
  const dir = epicsRoot(workspaceRoot, doc);
  if (!fs.existsSync(dir)) { return report; }

  const folders = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const epicId of folders) {
    const stateFile = path.join(dir, epicId, 'state.json');
    if (!fs.existsSync(stateFile)) { continue; }
    try {
      let runState = RunStateStore.load(workspaceRoot, epicId);
      let didBackfill = false;
      if (!runState) {
        const built = backfillRunStateFromEpic(workspaceRoot, epicId, doc);
        if (!built.ok) {
          report.skipped.push({ epicId, reason: built.reason });
          continue;
        }
        RunStateStore.save(workspaceRoot, built.runState);
        runState = built.runState;
        didBackfill = true;
      }
      mirrorRunStateToEpic(workspaceRoot, runState, doc);
      if (didBackfill) {
        report.backfilled.push(epicId);
      } else {
        report.migrated.push(epicId);
      }
    } catch (err) {
      report.errors.push({
        epicId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

/**
 * Reconstruct a runtime `RunState` from a legacy epic's `state.json`.
 *
 * Used when the user pulls a project that was created before the v2
 * runner existed (so docs/epics/ has rich state.json but no runs/*.json).
 * We can't recover what happened before the upgrade — there's no audit
 * trail to mine — but we CAN materialize a usable starting point so the
 * UI's gate panel + slash-command + Mark-step-done flow lights up.
 *
 * Mapping rules:
 *   stepStates[i].status === 'done'         → 'approved'
 *   stepStates[i].status === 'in_progress'  → 'awaiting_work'
 *   stepStates[i].status === 'failed'       → 'rejected'
 *   stepStates[i].status === 'pending'/_    → 'pending'
 *
 *   epic.status === 'done'                  → run.status 'completed'
 *   any step rejected                       → run.status 'running'
 *   else                                    → run.status 'running'
 *
 *   step.artifactsProduced                  → derived from the pipeline's
 *                                             `produces` paths if the file
 *                                             actually exists on disk.
 *
 * `context` reuses the epic's inputs.json (capability bindings) plus
 * `epic = epicId` so produces-path placeholders resolve.
 *
 * Returns `{ ok: false, reason }` when the epic's pipeline is no longer
 * declared in workspace.yaml (we can't know step requires/produces) or
 * state.json is unparseable.
 */
function backfillRunStateFromEpic(
  workspaceRoot: string,
  epicId: string,
  doc: YamlDocument | null,
): { ok: true; runState: RunState } | { ok: false; reason: string } {
  const stateFile = path.join(epicsRoot(workspaceRoot, doc), epicId, 'state.json');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) ?? {};
    if (typeof parsed !== 'object' || parsed === null) { return { ok: false, reason: 'state.json malformed' }; }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const pipelineId = typeof parsed.pipeline === 'string' ? parsed.pipeline : '';
  if (!pipelineId) {
    return { ok: false, reason: 'epic has no pipeline binding' };
  }
  const pipelineCfg = (doc?.pipelines as PipelineConfig[] | undefined)?.find(
    (p) => p.id === pipelineId,
  );
  if (!pipelineCfg || !Array.isArray(pipelineCfg.steps)) {
    return { ok: false, reason: `pipeline "${pipelineId}" not found in workspace.yaml` };
  }

  const inputsFile = path.join(epicsRoot(workspaceRoot, doc), epicId, 'inputs.json');
  const inputs = fs.existsSync(inputsFile) ? readInputs(path.dirname(inputsFile)) : {};
  const context: Record<string, string> = { epic: epicId, ...inputs };

  const stepStatesRaw = Array.isArray(parsed.stepStates)
    ? (parsed.stepStates as Array<Record<string, unknown>>)
    : [];

  const epicStatus = asStatus(parsed.status);
  const epicCurrentStep = typeof parsed.currentStep === 'number'
    ? parsed.currentStep
    : 0;

  const artifactsDir = path.join(epicsRoot(workspaceRoot, doc), epicId, 'artifacts');
  const existingArtifacts = fs.existsSync(artifactsDir)
    ? new Set(fs.readdirSync(artifactsDir).filter((n) => !n.startsWith('.')))
    : new Set<string>();

  const steps = pipelineCfg.steps.map((raw, i) => {
    const norm = normalizeStep(raw as PipelineStepConfig);
    const legacy = stepStatesRaw[i] ?? {};
    const legacyStatus = asStatus(legacy.status);
    const status: StepStatus =
      legacyStatus === 'done'
        ? 'approved'
        : legacyStatus === 'in_progress'
        ? 'awaiting_work'
        : legacyStatus === 'failed'
        ? 'rejected'
        : 'pending';
    // Resolve produces against the epic context, then check disk for any
    // file whose basename matches an existing artifact.
    const produces = norm.produces.map((p) => resolvePath(p, context));
    const artifactsProduced = produces.filter((p) => {
      const base = path.basename(p);
      return existingArtifacts.has(base);
    });
    return {
      stepIdx: i,
      agent: norm.agent,
      revision: 1,
      status,
      startedAt: typeof legacy.startedAt === 'string' ? legacy.startedAt : undefined,
      finishedAt: typeof legacy.finishedAt === 'string' ? legacy.finishedAt : undefined,
      artifactsProduced,
      history: [],
    };
  });

  const runStatus: RunState['status'] =
    epicStatus === 'done' && steps.every((s) => s.status === 'approved')
      ? 'completed'
      : 'running';

  const runState: RunState = {
    schemaVersion: 1,
    runId: epicId,
    pipelineId,
    context,
    startedAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStepIdx: Math.min(Math.max(epicCurrentStep, 0), Math.max(0, steps.length - 1)),
    status: runStatus,
    steps,
  };

  return { ok: true, runState };
}
