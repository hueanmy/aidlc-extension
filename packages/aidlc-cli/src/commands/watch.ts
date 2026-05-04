import * as path from 'path';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { EpicScanner } from '@aidlc/core';
import { readConfig } from '../cliConfig';
import { cmdStatus } from './status';

export function cmdWatch(workspaceRoot: string, epicKey?: string): void {
  const config = readConfig(workspaceRoot);
  const epicsDir = path.resolve(workspaceRoot, config.epicsPath);

  const patterns = epicKey
    ? [
        path.join(epicsDir, epicKey.toUpperCase(), 'phases', '**', 'status.json'),
        path.join(epicsDir, epicKey.toUpperCase(), 'pipeline.json'),
        path.join(epicsDir, epicKey.toUpperCase(), '.aidlc', 'events.jsonl'),
      ]
    : [
        path.join(epicsDir, '**', 'phases', '**', 'status.json'),
        path.join(epicsDir, '**', 'pipeline.json'),
      ];

  const scope = epicKey ? chalk.bold(epicKey.toUpperCase()) : 'all epics';
  console.log(chalk.dim(`Watching ${scope} in ${epicsDir}  (Ctrl+C to stop)\n`));

  // Initial render
  render(workspaceRoot, config.epicsPath, epicKey);

  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const onChange = (filePath: string) => {
    const rel = path.relative(workspaceRoot, filePath);
    console.log(chalk.dim(`\n  changed: ${rel}`));
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => render(workspaceRoot, config.epicsPath, epicKey), 150);
  };

  watcher.on('change', onChange).on('add', onChange).on('unlink', onChange);

  process.on('SIGINT', () => {
    void watcher.close();
    console.log(chalk.dim('\nStopped.'));
    process.exit(0);
  });
}

function render(workspaceRoot: string, epicsPath: string, epicKey?: string): void {
  console.log(chalk.dim('─'.repeat(60)));
  if (epicKey) {
    try {
      cmdStatus(workspaceRoot, epicKey.toUpperCase(), {});
    } catch {
      // Epic may not exist yet or scan failed — skip this render cycle
    }
  } else {
    const scanner = new EpicScanner(workspaceRoot, epicsPath);
    const epics = scanner.scanAll();
    if (epics.length === 0) {
      console.log(chalk.dim('No epics found.'));
      return;
    }
    for (const epic of epics) {
      const pct = epic.progress;
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      const current = epic.phases[epic.currentPhase];
      const flags = [
        epic.hasAwaitingReview ? chalk.red('🔔') : '',
        epic.hasFailure        ? chalk.red('🔴') : '',
      ].filter(Boolean).join(' ');
      console.log(
        chalk.bold(epic.key.padEnd(12)) +
        chalk.cyan(bar) + ` ${pct}%`.padStart(5) +
        '  ' + chalk.dim(current?.name ?? 'done') +
        (flags ? '  ' + flags : ''),
      );
    }
  }
}
