/**
 * Shared helpers for commands that work with RunState and workspace pipelines.
 */

import chalk from 'chalk';
import {
  WorkspaceLoader,
  RunStateStore,
  type RunState,
  type StepRecord,
  type PipelineConfig,
} from '@aidlc/core';

// ── Run loading ───────────────────────────────────────────────────────────────

/** Load a run by id or exit with a clear error. */
export function requireRun(root: string, runId: string): RunState {
  const state = RunStateStore.load(root, runId);
  if (!state) {
    const all = RunStateStore.list(root);
    console.error(chalk.red(`Run "${runId}" not found.`));
    if (all.length > 0) {
      console.error(chalk.dim(`Available runs: ${all.map(r => r.runId).join(', ')}`));
    } else {
      console.error(chalk.dim('No runs yet. Run: aidlc run start <pipelineId>'));
    }
    process.exit(1);
  }
  return state;
}

// ── Workspace + pipeline loading ──────────────────────────────────────────────

/** Load workspace and find a pipeline by id, or exit. */
export function requirePipeline(root: string, pipelineId: string): {
  pipeline: PipelineConfig;
} {
  let ws;
  try {
    ws = WorkspaceLoader.load(root);
  } catch (err) {
    console.error(chalk.red(`Failed to load workspace: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const pipeline = ws.config.pipelines.find(p => p.id === pipelineId);
  if (!pipeline) {
    const ids = ws.config.pipelines.map(p => p.id);
    console.error(chalk.red(`Pipeline "${pipelineId}" not found in workspace.yaml.`));
    if (ids.length > 0) {
      console.error(chalk.dim(`Available: ${ids.join(', ')}`));
    } else {
      console.error(chalk.dim('No pipelines defined. Run: aidlc pipeline add --id <id> --steps ...'));
    }
    process.exit(1);
  }

  return { pipeline };
}

/** Load workspace and find the pipeline that matches a run's pipelineId. */
export function requirePipelineForRun(root: string, state: RunState): PipelineConfig {
  return requirePipeline(root, state.pipelineId).pipeline;
}

// ── Step resolution ───────────────────────────────────────────────────────────

/**
 * Resolve `<step>` arg to a step index. Accepts:
 *   - a 0-based integer string: "0", "1", "2"
 *   - an agent id: "reviewer", "planner"
 *
 * Returns -1 when not found (caller decides whether to exit).
 */
export function resolveStepIdx(state: RunState, step: string): number {
  // Try as integer first
  const asInt = parseInt(step, 10);
  if (!isNaN(asInt) && String(asInt) === step) {
    return asInt >= 0 && asInt < state.steps.length ? asInt : -1;
  }
  // Try as agent id
  return state.steps.findIndex(s => s.agent === step);
}

/** Like resolveStepIdx but exits with a clear message on failure. */
export function requireStepIdx(state: RunState, step: string): number {
  const idx = resolveStepIdx(state, step);
  if (idx < 0) {
    const agents = state.steps.map((s, i) => `${i}:${s.agent}`).join(', ');
    console.error(chalk.red(`Step "${step}" not found in run "${state.runId}".`));
    console.error(chalk.dim(`Valid steps (index:agent): ${agents}`));
    process.exit(1);
  }
  return idx;
}

// ── Display helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, (s: string) => string> = {
  pending:           chalk.dim,
  awaiting_work:     chalk.yellow,
  awaiting_review:   chalk.cyan,
  approved:          chalk.green,
  rejected:          chalk.red,
};

export function colorStatus(status: string): string {
  const fn = STATUS_COLOR[status] ?? chalk.white;
  return fn(status);
}

export function printRunSummary(state: RunState): void {
  const runColor = state.status === 'completed' ? chalk.green
    : state.status === 'failed' ? chalk.red : chalk.yellow;

  console.log(`\n${chalk.bold(state.runId)}  ${runColor(state.status)}`);
  console.log(chalk.dim(`  pipeline: ${state.pipelineId}`));
  if (Object.keys(state.context).length > 0) {
    const ctx = Object.entries(state.context).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(chalk.dim(`  context:  ${ctx}`));
  }
  console.log();

  state.steps.forEach((step, i) => {
    const isCurrent = i === state.currentStepIdx && state.status === 'running';
    const marker    = isCurrent ? chalk.yellow('▶') : ' ';
    const idxLabel  = chalk.dim(`${i}.`);
    const agent     = isCurrent ? chalk.bold(step.agent) : chalk.dim(step.agent);
    const status    = colorStatus(step.status);
    const rev       = step.revision > 1 ? chalk.dim(` rev${step.revision}`) : '';
    const feedback  = step.feedback    ? chalk.dim(` [feedback: ${step.feedback.slice(0, 40)}]`) : '';
    const reason    = step.rejectReason ? chalk.red(` ✘ ${step.rejectReason.slice(0, 60)}`) : '';
    console.log(`  ${marker} ${idxLabel} ${agent.padEnd(20)} ${status}${rev}${feedback}${reason}`);
  });
  console.log();
}

/** Parse "key=val,key2=val2" into a Record. Empty / whitespace input → {}. */
export function parseContext(raw: string): Record<string, string> {
  if (!raw.trim()) { return {}; }
  const ctx: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    if (!pair.trim()) { continue; }   // tolerate trailing commas / extra whitespace
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(chalk.red(`Invalid context pair "${pair}" — expected key=value`));
      process.exit(1);
    }
    ctx[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return ctx;
}

export type { RunState, StepRecord, PipelineConfig };
