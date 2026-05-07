import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import chokidar from 'chokidar';
import Table from 'cli-table3';
import { RunStateStore, type RunState } from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import { colorStatus } from '../runHelpers';

const RUNS_GLOB = '.aidlc/runs/*.json';

export function registerWatch(program: Command): void {
  program
    .command('watch [runId]')
    .description('Live-render run state as it changes (Ctrl+C to stop)')
    .action((runId: string | undefined, _opts: unknown, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);
      const watchPath = path.join(root, RUNS_GLOB);

      // Initial render
      render(root, runId);

      const watcher = chokidar.watch(watchPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
      });

      let timer: NodeJS.Timeout | null = null;
      const debounced = () => {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(() => render(root, runId), 150);
      };

      watcher.on('add',    debounced);
      watcher.on('change', debounced);
      watcher.on('unlink', debounced);

      process.on('SIGINT', () => {
        void watcher.close().then(() => process.exit(0));
      });

      // Keep the event loop alive
    });
}

function clearScreen(): void {
  // Clear visible area + cursor home. We *don't* use \x1Bc here since that
  // also wipes scrollback, making it impossible to scroll up to past frames.
  process.stdout.write('\x1B[2J\x1B[H');
}

function render(root: string, runIdFilter?: string): void {
  clearScreen();

  const all = RunStateStore.list(root);
  const filtered = runIdFilter ? all.filter(r => r.runId === runIdFilter) : all;

  const ts = new Date().toLocaleTimeString();
  console.log(chalk.bold('aidlc watch') + chalk.dim(`  ${ts}  ·  ${root}`));
  console.log(chalk.dim('Ctrl+C to stop\n'));

  if (filtered.length === 0) {
    if (runIdFilter) {
      console.log(chalk.yellow(`No run named "${runIdFilter}". Existing: ${all.map(r => r.runId).join(', ') || '(none)'}`));
    } else {
      console.log(chalk.dim('No runs in .aidlc/runs/  —  Try: aidlc run start <pipelineId>'));
    }
    return;
  }

  // Single-run focus mode → step pipeline view
  if (runIdFilter && filtered.length === 1) {
    renderRunDetail(filtered[0]);
    return;
  }

  // Multi-run table
  const table = new Table({
    head: [
      chalk.bold('Run'),
      chalk.bold('Pipeline'),
      chalk.bold('Status'),
      chalk.bold('Step'),
      chalk.bold('Updated'),
    ],
    style: { head: [], border: [] },
  });

  for (const run of filtered) {
    const stepNum = `${run.currentStepIdx + 1}/${run.steps.length}`;
    const current = run.steps[run.currentStepIdx];
    const stepLabel = current
      ? `${stepNum}  ${current.agent} ${chalk.dim(`(${current.status})`)}`
      : stepNum;
    table.push([
      chalk.bold(run.runId),
      chalk.dim(run.pipelineId),
      colorRunStatus(run.status),
      stepLabel,
      chalk.dim(humanizeTime(run.updatedAt)),
    ]);
  }
  console.log(table.toString());
}

function renderRunDetail(run: RunState): void {
  const ctx = Object.entries(run.context).map(([k, v]) => `${k}=${v}`).join(', ');
  console.log(chalk.bold(run.runId) + '  ' + colorRunStatus(run.status));
  console.log(chalk.dim(`  pipeline: ${run.pipelineId}`));
  if (ctx) { console.log(chalk.dim(`  context:  ${ctx}`)); }
  console.log();

  run.steps.forEach((step, i) => {
    const isCurrent = i === run.currentStepIdx && run.status === 'running';
    const marker    = isCurrent ? chalk.yellow('▶') : ' ';
    const idxLabel  = chalk.dim(`${i}.`);
    const agent     = isCurrent ? chalk.bold(step.agent) : chalk.dim(step.agent);
    const status    = colorStatus(step.status);
    const rev       = step.revision > 1 ? chalk.dim(` rev${step.revision}`) : '';
    const reason    = step.rejectReason ? chalk.red(`  ✘ ${step.rejectReason.slice(0, 50)}`) : '';
    console.log(`  ${marker} ${idxLabel} ${agent.padEnd(20)} ${status}${rev}${reason}`);
  });
}

function colorRunStatus(status: string): string {
  if (status === 'completed') { return chalk.green(status); }
  if (status === 'failed')    { return chalk.red(status); }
  return chalk.yellow(status);
}

function humanizeTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) { return chalk.dim(iso); }   // corrupt/unknown — show raw
  const diff = Date.now() - ms;
  if (diff < 60_000)        { return `${Math.floor(diff / 1000)}s ago`; }
  if (diff < 3_600_000)     { return `${Math.floor(diff / 60_000)}m ago`; }
  if (diff < 86_400_000)    { return `${Math.floor(diff / 3_600_000)}h ago`; }
  return new Date(iso).toLocaleString();
}
