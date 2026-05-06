import { Command } from 'commander';
import chalk from 'chalk';
import {
  WorkspaceLoader,
  RunStateStore,
  startRun,
  markStepDone,
  approveStep,
  rejectStep,
  rerunStep,
  PipelineRunError,
  RUN_ID_PATTERN,
  type RunState,
  type PipelineConfig,
} from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import {
  requireRun,
  requirePipeline,
  requirePipelineForRun,
  requireStepIdx,
  printRunSummary,
  parseContext,
} from '../runHelpers';

export function registerRun(program: Command): void {
  const cmd = program
    .command('run')
    .description('Manage pipeline runs');

  // ── start ──────────────────────────────────────────────────────────────────
  cmd
    .command('start <pipelineId>')
    .description('Start a new pipeline run')
    .option('--id <runId>',        'run id (default: <pipeline>-<timestamp>)')
    .option('--context <pairs>',   'context key=value pairs, comma-separated (e.g. epic=ABC-123)')
    .action((pipelineId: string, opts: { id?: string; context?: string }, actionCmd: Command) => {
      const root     = resolveWorkspaceRoot(actionCmd);
      const runId    = opts.id ?? `${pipelineId}-${Date.now()}`;
      const context  = opts.context ? parseContext(opts.context) : {};

      if (!RUN_ID_PATTERN.test(runId)) {
        console.error(chalk.red(`Invalid run id "${runId}" — use letters, digits, dots, dashes, underscores.`));
        process.exit(1);
      }

      if (RunStateStore.load(root, runId)) {
        console.error(chalk.red(`Run "${runId}" already exists. Use a different --id.`));
        process.exit(1);
      }

      const { pipeline } = requirePipeline(root, pipelineId);

      let state;
      try {
        state = startRun({ runId, pipeline, context });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      RunStateStore.save(root, state);
      console.log(chalk.green('✔') + ` Started run ${chalk.bold(runId)}`);
      printRunSummary(state);
      const first = state.steps[0];
      if (first) {
        console.log(chalk.dim(`  Current step: ${chalk.bold(first.agent)} — awaiting_work`));
        console.log(chalk.dim(`  When done: aidlc run mark-done ${runId}`));
      }
    });

  // ── mark-done ──────────────────────────────────────────────────────────────
  cmd
    .command('mark-done <runId>')
    .description('Mark the current step done (validates produces paths, then advances or awaits review)')
    .action((runId: string, _opts: unknown, actionCmd: Command) => {
      const root     = resolveWorkspaceRoot(actionCmd);
      const state    = requireRun(root, runId);
      const pipeline = requirePipelineForRun(root, state);

      let next;
      try {
        next = markStepDone({ state, pipeline, workspaceRoot: root });
      } catch (err) {
        if (err instanceof PipelineRunError && err.missing?.length) {
          console.error(chalk.red('Missing artifacts — step not marked done:'));
          for (const m of err.missing) { console.error(chalk.dim(`  ✘ ${m}`)); }
          console.error(chalk.dim('\nProduce the files above, then retry: aidlc run mark-done ' + runId));
        } else {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        }
        process.exit(1);
      }

      RunStateStore.save(root, next);
      const step = next.steps[state.currentStepIdx];
      if (step.status === 'awaiting_review') {
        console.log(chalk.cyan('✔') + ` Step "${step.agent}" is now ${chalk.cyan('awaiting_review')}`);
        console.log(chalk.dim(`  Approve: aidlc run approve ${runId}`));
        console.log(chalk.dim(`  Reject:  aidlc run reject ${runId} --reason "..."`));
      } else {
        console.log(chalk.green('✔') + ` Step "${step.agent}" auto-approved, advancing…`);
        printRunSummary(next);
      }
    });

  // ── approve ────────────────────────────────────────────────────────────────
  cmd
    .command('approve <runId>')
    .description('Approve the current awaiting_review step')
    .option('--comment <text>', 'Optional comment recorded on the step')
    .action((runId: string, opts: { comment?: string }, actionCmd: Command) => {
      const root     = resolveWorkspaceRoot(actionCmd);
      const state    = requireRun(root, runId);
      const pipeline = requirePipelineForRun(root, state);

      let next;
      try {
        next = approveStep({ state, pipeline });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      // Attach comment to the approved step record if supplied
      if (opts.comment) {
        next.steps[state.currentStepIdx].feedback = opts.comment;
      }

      RunStateStore.save(root, next);
      const approvedStep = state.steps[state.currentStepIdx];
      console.log(chalk.green('✔') + ` Approved "${approvedStep.agent}"`);
      printRunSummary(next);

      if (next.status === 'completed') {
        console.log(chalk.green('🎉 Run completed — all steps approved.'));
      }
    });

  // ── reject ─────────────────────────────────────────────────────────────────
  cmd
    .command('reject <runId>')
    .description('Reject the current awaiting_review step')
    .requiredOption('--reason <text>', 'Why the step was rejected')
    .action((runId: string, opts: { reason: string }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);

      let next;
      try {
        next = rejectStep({ state, reason: opts.reason });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      RunStateStore.save(root, next);
      const step = state.steps[state.currentStepIdx];
      console.log(chalk.red('✘') + ` Rejected "${step.agent}"`);
      console.log(chalk.dim(`  Reason: ${opts.reason}`));
      console.log(chalk.dim(`  Rerun:  aidlc run rerun ${runId} [--feedback "..."]`));
    });

  // ── rerun ──────────────────────────────────────────────────────────────────
  cmd
    .command('rerun <runId>')
    .description('Retry the current rejected step (bumps revision, resets to awaiting_work)')
    .option('--feedback <text>', 'Notes for the next attempt (stored on the step)')
    .action((runId: string, opts: { feedback?: string }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);

      let next;
      try {
        next = rerunStep({ state, feedback: opts.feedback });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      RunStateStore.save(root, next);
      const step = next.steps[next.currentStepIdx];
      console.log(chalk.yellow('↺') + ` Rerunning "${step.agent}" (rev ${step.revision})`);
      if (opts.feedback) { console.log(chalk.dim(`  Feedback: ${opts.feedback}`)); }
      console.log(chalk.dim(`  When done: aidlc run mark-done ${runId}`));
    });

  // ── delete ─────────────────────────────────────────────────────────────────
  cmd
    .command('delete <runId>')
    .description('Delete a run state file')
    .option('--force', 'Skip confirmation for running/active runs')
    .action((runId: string, opts: { force?: boolean }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);

      if (state.status === 'running' && !opts.force) {
        console.error(chalk.yellow(`Run "${runId}" is still running. Use --force to delete anyway.`));
        process.exit(1);
      }

      RunStateStore.delete(root, runId);
      console.log(chalk.green('✔') + ` Deleted run ${chalk.bold(runId)}`);
    });

  // ── open ───────────────────────────────────────────────────────────────────
  cmd
    .command('open <runId>')
    .description('Print the run state JSON (pipe into jq, open in editor, etc.)')
    .option('--path', 'Print the file path only instead of the JSON content')
    .action((runId: string, opts: { path?: boolean }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);

      if (opts.path) {
        console.log(RunStateStore.file(root, runId));
        return;
      }
      console.log(JSON.stringify(state, null, 2));
    });

  // ── exec ───────────────────────────────────────────────────────────────────
  cmd
    .command('exec <runId>')
    .description(
      'Execute the current step by spawning the claude CLI, then auto-advance.\n' +
      '  Streams output live. Stops at human_review steps unless --auto-approve.',
    )
    .option('--until <step>',   'Stop after this step completes (index or agent id)')
    .option('--auto-approve',   'Also auto-approve human_review steps without pausing')
    .option('--message <text>', 'Override the user message sent to claude (default: context pairs)')
    .option('--dry-run',        'Print the assembled prompt without spawning claude')
    .action(async (runId: string, opts: {
      until?: string; autoApprove?: boolean; message?: string; dryRun?: boolean;
    }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      await execLoop(root, runId, opts);
    });
}

// ── Exec internals ────────────────────────────────────────────────────────────

async function execLoop(
  root: string,
  runId: string,
  opts: { until?: string; autoApprove?: boolean; message?: string; dryRun?: boolean },
): Promise<void> {
  // Resolve the optional --until boundary once (before loop, using initial state).
  const initialState = requireRun(root, runId);
  const untilIdx = opts.until !== undefined
    ? requireStepIdx(initialState, opts.until)
    : -1;

  while (true) {
    // Reload fresh state each iteration so concurrent edits (extension, other CLI) are picked up.
    const state = RunStateStore.load(root, runId);
    if (!state) {
      console.error(chalk.red(`Run "${runId}" disappeared.`));
      process.exit(1);
    }

    if (state.status === 'completed') {
      console.log(chalk.green('\n🎉 Run completed — all steps approved.'));
      break;
    }
    if (state.status === 'failed') {
      console.error(chalk.red('\nRun failed.'));
      process.exit(1);
    }

    const step = state.steps[state.currentStepIdx];

    // Stop at human_review unless --auto-approve
    if (step.status === 'awaiting_review') {
      if (opts.autoApprove) {
        await autoApproveStep(root, state, runId);
        continue;
      }
      console.log(chalk.cyan(`\n⏸  Step "${step.agent}" is awaiting human review.`));
      console.log(chalk.dim(`  Approve: aidlc run approve ${runId}`));
      console.log(chalk.dim(`  Reject:  aidlc run reject ${runId} --reason "..."`));
      break;
    }

    // Stop at rejected unless user reruns
    if (step.status === 'rejected') {
      console.log(chalk.red(`\n✘  Step "${step.agent}" was rejected.`));
      console.log(chalk.dim(`  Rerun: aidlc run rerun ${runId} [--feedback "..."]`));
      break;
    }

    if (step.status !== 'awaiting_work') {
      console.error(chalk.red(`\nUnexpected step status "${step.status}" — cannot exec.`));
      process.exit(1);
    }

    // Execute the current step
    const success = await execStep(root, state, runId, opts);
    if (!success) { process.exit(1); }

    // Check --until boundary
    if (untilIdx >= 0 && state.currentStepIdx >= untilIdx) {
      console.log(chalk.dim(`\nStopped at step ${untilIdx} as requested.`));
      break;
    }
  }
}

async function execStep(
  root: string,
  state: RunState,
  runId: string,
  opts: { message?: string; dryRun?: boolean },
): Promise<boolean> {
  const stepIdx  = state.currentStepIdx;
  const stepRec  = state.steps[stepIdx];
  const agentId  = stepRec.agent;

  // Load workspace
  let ws;
  try {
    ws = WorkspaceLoader.load(root);
  } catch (err) {
    console.error(chalk.red(`Failed to load workspace: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }

  const pipeline = ws.config.pipelines.find((p: PipelineConfig) => p.id === state.pipelineId);
  if (!pipeline) {
    console.error(chalk.red(`Pipeline "${state.pipelineId}" not found in workspace.yaml.`));
    return false;
  }

  const agent = ws.config.agents.find(a => a.id === agentId);
  if (!agent) {
    console.error(chalk.red(`Agent "${agentId}" not found in workspace.yaml.`));
    return false;
  }

  // Load skill
  let skillText: string;
  try {
    skillText = ws.skills.load(agent.skill);
  } catch (err) {
    console.error(chalk.red(`Failed to load skill "${agent.skill}": ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }

  // Resolve env (workspace layer + agent layer)
  const env = ws.envResolver.resolveLayered(ws.config.environment ?? {}, agent.env ?? {});

  // Build user message: explicit --message → context pairs → agent name as fallback.
  // claude --print always requires a non-empty prompt.
  const contextStr = Object.entries(state.context).map(([k, v]) => `${k}=${v}`).join(' ');
  const userMessage = opts.message ?? (contextStr || `Execute step: ${agentId}`);

  // Dry run — print prompt and exit
  if (opts.dryRun) {
    console.log(chalk.bold('\n── System prompt (skill) ──────────────────────────────'));
    console.log(chalk.dim(skillText));
    console.log(chalk.bold('\n── User message ───────────────────────────────────────'));
    console.log(userMessage || chalk.dim('(empty)'));
    console.log(chalk.bold('\n── Env vars ───────────────────────────────────────────'));
    for (const [k, v] of Object.entries(env)) {
      const masked = k.toLowerCase().includes('key') || k.toLowerCase().includes('token')
        ? '***' : v;
      console.log(chalk.dim(`  ${k}=${masked}`));
    }
    console.log();
    return true;
  }

  // Execute
  console.log(chalk.bold(`\n▶  Step ${stepIdx}: ${agentId}`) + chalk.dim(` (rev ${stepRec.revision})`));
  console.log(chalk.dim(`   skill: ${agent.skill}  model: ${agent.model ?? 'claude-sonnet-4-5'}`));
  if (userMessage) { console.log(chalk.dim(`   context: ${userMessage}`)); }
  console.log(chalk.dim('─'.repeat(60)));

  const runner = ws.runners.resolve(agent);
  const result = await runner.run({
    skill: skillText,
    env,
    args: userMessage ? [userMessage] : [],
    workspaceRoot: root,
    onOutput: (chunk) => process.stdout.write(chunk),
    onError:  (chunk) => process.stderr.write(chalk.dim(chunk)),
    claude: null,
  });

  console.log(chalk.dim('─'.repeat(60)));

  if (!result.success) {
    console.error(chalk.red(`\n✘  Step "${agentId}" failed (non-zero exit).`));
    console.error(chalk.dim('   Fix the issue then retry: aidlc run exec ' + runId));
    return false;
  }

  // markStepDone — validates produces paths
  let next: RunState;
  try {
    const freshState = RunStateStore.load(root, runId)!;
    next = markStepDone({ state: freshState, pipeline, workspaceRoot: root });
  } catch (err) {
    if (err instanceof PipelineRunError && err.missing?.length) {
      console.error(chalk.red('\n✘  Step completed but missing expected artifacts:'));
      for (const m of err.missing) { console.error(chalk.dim(`   ✘ ${m}`)); }
      console.error(chalk.dim('\n   Produce the files above, then: aidlc run mark-done ' + runId));
    } else {
      console.error(chalk.red(`\n✘  ${err instanceof Error ? err.message : String(err)}`));
    }
    return false;
  }

  RunStateStore.save(root, next);

  const doneStep = next.steps[stepIdx];
  if (doneStep.status === 'awaiting_review') {
    console.log(chalk.cyan(`\n✔  Step "${agentId}" done — awaiting review.`));
  } else {
    console.log(chalk.green(`\n✔  Step "${agentId}" approved.`));
  }

  return true;
}

async function autoApproveStep(root: string, state: RunState, runId: string): Promise<void> {
  const ws = WorkspaceLoader.load(root);
  const pipeline = ws.config.pipelines.find((p: PipelineConfig) => p.id === state.pipelineId)!;
  const next = approveStep({ state, pipeline });
  RunStateStore.save(root, next);
  const step = state.steps[state.currentStepIdx];
  console.log(chalk.green(`✔  Auto-approved "${step.agent}" (--auto-approve)`));
}
