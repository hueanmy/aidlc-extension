import { Command } from 'commander';
import chalk from 'chalk';
import { RunStateStore, type StepStatus } from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import {
  requireRun,
  requireStepIdx,
  printRunSummary,
  colorStatus,
} from '../runHelpers';

const VALID_STATUSES: StepStatus[] = [
  'pending', 'awaiting_work', 'awaiting_review', 'approved', 'rejected',
];

export function registerStep(program: Command): void {
  const cmd = program
    .command('step')
    .description(
      'Directly control any step in a run — bypasses the sequential gate.\n' +
      '  <step> can be a 0-based index ("0") or an agent id ("reviewer").',
    );

  // ── start ──────────────────────────────────────────────────────────────────
  cmd
    .command('start <runId> <step>')
    .description('Set a step to awaiting_work and move the run pointer to it')
    .action((runId: string, step: string, _opts: unknown, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);
      const idx   = requireStepIdx(state, step);

      // Invariant: at most one step is `awaiting_work` at a time. If we're
      // moving the pointer away from a step that was awaiting_work, demote
      // it back to pending — otherwise we'd leave two steps "currently in progress".
      const prevIdx = state.currentStepIdx;
      if (prevIdx !== idx && state.steps[prevIdx]?.status === 'awaiting_work') {
        state.steps[prevIdx] = {
          ...state.steps[prevIdx],
          status: 'pending',
          startedAt: undefined,
        };
      }

      state.steps[idx] = {
        ...state.steps[idx],
        status: 'awaiting_work',
        startedAt: new Date().toISOString(),
        rejectReason: undefined,
        artifactsProduced: [],
      };
      state.currentStepIdx = idx;
      state.status = 'running';

      RunStateStore.save(root, state);
      const agent = state.steps[idx].agent;
      console.log(chalk.yellow('▶') + ` Step ${idx} "${agent}" → ${chalk.yellow('awaiting_work')}`);
      if (prevIdx !== idx && state.steps[prevIdx]?.agent) {
        console.log(chalk.dim(`  (Demoted previous current step ${prevIdx} to pending)`));
      }
      console.log(chalk.dim(`  When done: aidlc run mark-done ${runId}`));
    });

  // ── done ───────────────────────────────────────────────────────────────────
  cmd
    .command('done <runId> <step>')
    .description('Mark any step as approved without validating produces (work done outside the tool)')
    .option('--reason <text>', 'Note why this was manually approved')
    .action((runId: string, step: string, opts: { reason?: string }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);
      const idx   = requireStepIdx(state, step);
      const now   = new Date().toISOString();

      state.steps[idx] = {
        ...state.steps[idx],
        status: 'approved',
        finishedAt: now,
        feedback: opts.reason ?? 'Manually marked done via aidlc step done.',
        artifactsProduced: state.steps[idx].artifactsProduced ?? [],
      };

      // Only advance the pointer if we touched the CURRENT step. Marking an
      // earlier step done shouldn't drag the pointer backward.
      if (idx === state.currentStepIdx) {
        const nextIdx = state.steps.findIndex((s, i) => i > idx && s.status !== 'approved');
        if (nextIdx >= 0) {
          state.currentStepIdx = nextIdx;
          state.status = 'running';
        }
      }

      // Run is complete when every step is approved (regardless of pointer).
      if (state.steps.every(s => s.status === 'approved')) {
        state.status = 'completed';
      } else {
        state.status = 'running';
      }

      RunStateStore.save(root, state);
      const agent = state.steps[idx].agent;
      console.log(chalk.green('✔') + ` Step ${idx} "${agent}" → ${chalk.green('approved')}`);
      printRunSummary(state);
    });

  // ── skip ───────────────────────────────────────────────────────────────────
  cmd
    .command('skip <runId> <step>')
    .description('Mark a step as approved with a skip reason (jump over it)')
    .action((runId: string, step: string, _opts: unknown, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);
      const idx   = requireStepIdx(state, step);
      const now   = new Date().toISOString();

      state.steps[idx] = {
        ...state.steps[idx],
        status: 'approved',
        finishedAt: now,
        feedback: 'Skipped via aidlc step skip.',
        artifactsProduced: [],
      };

      // Only advance the pointer if we touched the CURRENT step.
      if (idx === state.currentStepIdx) {
        const nextIdx = state.steps.findIndex((s, i) => i > idx && s.status !== 'approved');
        if (nextIdx >= 0) {
          state.currentStepIdx = nextIdx;
        }
      }

      if (state.steps.every(s => s.status === 'approved')) {
        state.status = 'completed';
      } else {
        state.status = 'running';
      }

      RunStateStore.save(root, state);
      const agent = state.steps[idx].agent;
      console.log(chalk.green('⤼') + ` Step ${idx} "${agent}" skipped → ${chalk.green('approved')}`);
    });

  // ── reset ──────────────────────────────────────────────────────────────────
  cmd
    .command('reset <runId> <step>')
    .description('Reset a step to pending (no cascade — only this step is touched)')
    .action((runId: string, step: string, _opts: unknown, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);
      const idx   = requireStepIdx(state, step);

      state.steps[idx] = {
        ...state.steps[idx],
        status: 'pending',
        startedAt: undefined,
        finishedAt: undefined,
        feedback: undefined,
        rejectReason: undefined,
        artifactsProduced: [],
      };
      state.status = 'running';

      RunStateStore.save(root, state);
      const agent = state.steps[idx].agent;
      console.log(chalk.dim('↺') + ` Step ${idx} "${agent}" → ${colorStatus('pending')}`);
      console.log(chalk.dim(`  Use "aidlc step start ${runId} ${step}" to begin work on it.`));
    });

  // ── set ────────────────────────────────────────────────────────────────────
  cmd
    .command('set <runId> <step> <status>')
    .description(`Set any step to any valid status: ${VALID_STATUSES.join(', ')}`)
    .action((runId: string, step: string, status: string, _opts: unknown, actionCmd: Command) => {
      if (!VALID_STATUSES.includes(status as StepStatus)) {
        console.error(chalk.red(`Invalid status "${status}".`));
        console.error(chalk.dim(`Valid: ${VALID_STATUSES.join(', ')}`));
        process.exit(1);
      }

      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);
      const idx   = requireStepIdx(state, step);

      state.steps[idx] = { ...state.steps[idx], status: status as StepStatus };
      state.status = 'running';

      RunStateStore.save(root, state);
      const agent = state.steps[idx].agent;
      console.log(chalk.green('✔') + ` Step ${idx} "${agent}" → ${colorStatus(status)}`);
    });

  // ── jump ───────────────────────────────────────────────────────────────────
  cmd
    .command('jump <runId> <step>')
    .description(
      'Move the run pointer to a step, marking all earlier pending steps approved.\n' +
      '  Use when you want to resume or start from an arbitrary point.',
    )
    .action((runId: string, step: string, _opts: unknown, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const state = requireRun(root, runId);
      const idx   = requireStepIdx(state, step);
      const now   = new Date().toISOString();

      let autoApproved = 0;
      for (let i = 0; i < idx; i++) {
        if (state.steps[i].status === 'pending') {
          state.steps[i] = {
            ...state.steps[i],
            status: 'approved',
            finishedAt: now,
            feedback: 'Auto-approved by aidlc step jump.',
          };
          autoApproved++;
        }
      }

      state.steps[idx] = {
        ...state.steps[idx],
        status: 'awaiting_work',
        startedAt: now,
        rejectReason: undefined,
        artifactsProduced: [],
      };
      state.currentStepIdx = idx;
      state.status = 'running';

      RunStateStore.save(root, state);
      const agent = state.steps[idx].agent;
      console.log(chalk.yellow('⤷') + ` Jumped to step ${idx} "${chalk.bold(agent)}"`);
      if (autoApproved > 0) {
        console.log(chalk.dim(`  Auto-approved ${autoApproved} earlier pending step${autoApproved !== 1 ? 's' : ''}`));
      }
      printRunSummary(state);
    });
}
