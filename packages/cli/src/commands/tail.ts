import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { RunStateStore, type RunState, type StepRecord } from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import { colorStatus } from '../runHelpers';

const RUNS_GLOB = '.aidlc/runs/*.json';

interface Snapshot {
  status: RunState['status'];
  currentStepIdx: number;
  steps: Array<{ status: StepRecord['status']; revision: number; rejectReason?: string }>;
}

export function registerTail(program: Command): void {
  program
    .command('tail [runId]')
    .description('Stream state transitions as they happen (Ctrl+C to stop)')
    .action((runId: string | undefined, _opts: unknown, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);
      const watchPath = path.join(root, RUNS_GLOB);

      // Seed with current state so we don't print every existing run as new
      const seen = new Map<string, Snapshot>();
      for (const run of RunStateStore.list(root)) {
        if (runId && run.runId !== runId) { continue; }
        seen.set(run.runId, snapshot(run));
      }

      const focus = runId ? chalk.bold(runId) : chalk.bold('all runs');
      console.log(chalk.dim(`tailing ${focus}  ·  ${root}  (Ctrl+C to stop)\n`));

      if (seen.size === 0) {
        console.log(chalk.dim('No runs to watch yet.  Try: aidlc run start <pipelineId>'));
      } else {
        for (const [id, snap] of seen) {
          const cur = snap.steps[snap.currentStepIdx];
          console.log(
            chalk.dim(`[${time()}] `) + chalk.bold(id) +
            chalk.dim(` already at step ${snap.currentStepIdx} (${cur ? cur.status : '?'})`),
          );
        }
        console.log();
      }

      const watcher = chokidar.watch(watchPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
      });

      watcher.on('add',    (filePath) => onChange(root, filePath, seen, runId, 'add'));
      watcher.on('change', (filePath) => onChange(root, filePath, seen, runId, 'change'));
      watcher.on('unlink', (filePath) => onUnlink(filePath, seen));

      process.on('SIGINT', () => {
        void watcher.close().then(() => process.exit(0));
      });
    });
}

function onChange(
  root: string,
  filePath: string,
  seen: Map<string, Snapshot>,
  filterId: string | undefined,
  evt: 'add' | 'change',
): void {
  const id = path.basename(filePath, '.json');
  if (filterId && id !== filterId) { return; }

  const run = RunStateStore.load(root, id);
  if (!run) { return; }

  const next = snapshot(run);
  const prev = seen.get(id);
  seen.set(id, next);

  // First-seen file: print one summary line, no diff
  if (!prev || evt === 'add') {
    const cur = next.steps[next.currentStepIdx];
    console.log(
      chalk.dim(`[${time()}] `) + chalk.green('NEW') + ' ' + chalk.bold(id) +
      chalk.dim(` step ${next.currentStepIdx} (${cur ? cur.status : '?'})`),
    );
    return;
  }

  // Diff snapshots, print one line per change
  printDiff(id, prev, next);
}

function onUnlink(filePath: string, seen: Map<string, Snapshot>): void {
  const id = path.basename(filePath, '.json');
  if (seen.has(id)) {
    seen.delete(id);
    console.log(chalk.dim(`[${time()}] `) + chalk.red('GONE') + ' ' + chalk.bold(id));
  }
}

function printDiff(runId: string, prev: Snapshot, next: Snapshot): void {
  // Run-level status change
  if (prev.status !== next.status) {
    console.log(
      chalk.dim(`[${time()}] `) + chalk.bold(runId) + ' run ' +
      chalk.dim(prev.status) + ' → ' + colorRunStatus(next.status),
    );
  }

  // Pointer change
  if (prev.currentStepIdx !== next.currentStepIdx) {
    console.log(
      chalk.dim(`[${time()}] `) + chalk.bold(runId) +
      chalk.dim(` pointer ${prev.currentStepIdx} → ${next.currentStepIdx}`),
    );
  }

  // Per-step status / revision changes
  const len = Math.max(prev.steps.length, next.steps.length);
  for (let i = 0; i < len; i++) {
    const a = prev.steps[i];
    const b = next.steps[i];
    if (!a || !b) { continue; }

    if (a.status !== b.status) {
      const reason = b.rejectReason ? chalk.red(`  ✘ ${b.rejectReason.slice(0, 60)}`) : '';
      console.log(
        chalk.dim(`[${time()}] `) + chalk.bold(runId) +
        chalk.dim(` step ${i} ${colorStatus(a.status)} → `) + colorStatus(b.status) + reason,
      );
    }
    if (a.revision !== b.revision) {
      console.log(
        chalk.dim(`[${time()}] `) + chalk.bold(runId) +
        chalk.dim(` step ${i} revision ${a.revision} → ${b.revision}`),
      );
    }
  }
}

function snapshot(run: RunState): Snapshot {
  return {
    status: run.status,
    currentStepIdx: run.currentStepIdx,
    steps: run.steps.map(s => ({
      status: s.status,
      revision: s.revision,
      rejectReason: s.rejectReason,
    })),
  };
}

function time(): string { return new Date().toLocaleTimeString(); }

function colorRunStatus(status: string): string {
  if (status === 'completed') { return chalk.green(status); }
  if (status === 'failed')    { return chalk.red(status); }
  return chalk.yellow(status);
}
