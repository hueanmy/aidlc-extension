import chalk from 'chalk';
import Table from 'cli-table3';
import { EpicScanner, EpicStatus } from '@aidlc/core';
import { readConfig } from '../cliConfig';

const STATUS_GLYPH: Record<string, string> = {
  passed:               '✅',
  done:                 '✅',
  in_progress:          '⏳',
  'in-progress':        '⏳',
  in_review:            '🔍',
  awaiting_human_review:'🔔',
  rejected:             '❌',
  stale:                '⚠️ ',
  failed_needs_human:   '🔴',
  blocked:              '⛔',
  pending:              '○',
};

export function cmdList(workspaceRoot: string, opts: { json?: boolean }): void {
  const config = readConfig(workspaceRoot);
  const scanner = new EpicScanner(workspaceRoot, config.epicsPath);
  const epics = scanner.scanAll();

  if (epics.length === 0) {
    console.log(chalk.dim('No epics found. Run ' + chalk.cyan('aidlc epic new <KEY> "<Title>"') + ' to create one.'));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(epics, null, 2));
    return;
  }

  const table = new Table({
    head: ['Epic', 'Title', 'Progress', 'Phase', 'Flags'],
    style: { head: ['cyan'] },
    colWidths: [14, 32, 10, 16, 8],
  });

  for (const epic of epics) {
    const flags = [
      epic.hasAwaitingReview ? '🔔' : '',
      epic.hasFailure        ? '🔴' : '',
    ].filter(Boolean).join(' ');

    const currentPhase = epic.phases[epic.currentPhase];
    const phaseLabel = currentPhase
      ? `${STATUS_GLYPH[currentPhase.status] ?? '○'} ${currentPhase.name}`
      : chalk.green('All done');

    table.push([
      chalk.bold(epic.key),
      truncate(epic.title, 30),
      progressBar(epic.progress),
      phaseLabel,
      flags,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`${epics.length} epic${epics.length === 1 ? '' : 's'} · workspace: ${workspaceRoot}`));
}

function progressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = pct === 100 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.dim;
  return color(bar) + ` ${pct}%`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export { EpicStatus };
