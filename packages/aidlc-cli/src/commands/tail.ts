import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { EpicScanner, readEvents, eventLogPath, AidlcEvent } from '@aidlc/core';
import { readConfig } from '../cliConfig';

const ACTOR_COLOR: Record<string, (s: string) => string> = {
  cli:    chalk.cyan,
  vscode: chalk.magenta,
  mcp:    chalk.yellow,
};

const STATUS_COLOR: Record<string, (s: string) => string> = {
  passed:  chalk.green,
  rejected: chalk.red,
  stale:   chalk.yellow,
};

function formatEvent(e: AidlcEvent): string {
  const ts   = chalk.dim(new Date(e.ts).toLocaleTimeString());
  const actor = (ACTOR_COLOR[e.actor] ?? chalk.white)(e.actor.padEnd(6));
  const phase = chalk.bold(e.phase.padEnd(14));
  const arrow = `${chalk.dim(e.from)} → ${(STATUS_COLOR[e.to] ?? chalk.white)(e.to)}`;
  const by    = chalk.dim(`[${e.by}]`);
  const reason = e.reason ? chalk.dim(`  "${e.reason}"`) : '';
  return `${ts}  ${actor}  ${phase}  ${arrow}  ${by}${reason}`;
}

export function cmdTail(workspaceRoot: string, epicKey?: string): void {
  const config = readConfig(workspaceRoot);
  const epicsDir = path.resolve(workspaceRoot, config.epicsPath);

  // Resolve which epic folders to tail
  const epicFolders: Array<{ key: string; folder: string }> = [];

  if (epicKey) {
    const key = epicKey.toUpperCase();
    const folder = path.join(epicsDir, key);
    if (!fs.existsSync(folder)) {
      console.error(chalk.red(`Epic not found: ${key}`));
      process.exit(1);
    }
    epicFolders.push({ key, folder });
  } else {
    const scanner = new EpicScanner(workspaceRoot, config.epicsPath);
    for (const epic of scanner.scanAll()) {
      epicFolders.push({ key: epic.key, folder: epic.folderPath });
    }
  }

  if (epicFolders.length === 0) {
    console.log(chalk.dim('No epics found.'));
    return;
  }

  // Print existing events first
  for (const { key, folder } of epicFolders) {
    const events = readEvents(folder);
    if (events.length > 0) {
      console.log(chalk.dim(`── ${key} ─────────────────────────────────`));
      for (const e of events) { console.log(formatEvent(e)); }
    }
  }

  // Watch for new lines
  const logPaths = epicFolders.map(({ folder }) => eventLogPath(folder));
  const knownSizes = new Map<string, number>();
  for (const p of logPaths) {
    knownSizes.set(p, fs.existsSync(p) ? fs.statSync(p).size : 0);
  }

  console.log(chalk.dim('\nWaiting for new events…  (Ctrl+C to stop)'));

  const watcher = chokidar.watch(logPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
  });

  watcher.on('change', (filePath) => {
    const prevSize = knownSizes.get(filePath) ?? 0;
    const newSize = fs.statSync(filePath).size;
    if (newSize <= prevSize) { return; }

    // Read only the new bytes appended
    const buf = Buffer.alloc(newSize - prevSize);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, buf.length, prevSize);
    } finally {
      fs.closeSync(fd);
    }
    knownSizes.set(filePath, newSize);

    const newLines = buf.toString('utf8').split('\n').filter(Boolean);
    for (const line of newLines) {
      try {
        const event = JSON.parse(line) as AidlcEvent;
        console.log(formatEvent(event));
      } catch {
        console.log(chalk.dim(line));
      }
    }
  });

  watcher.on('add', (filePath) => {
    knownSizes.set(filePath, 0);
  });

  process.on('SIGINT', () => {
    void watcher.close();
    process.exit(0);
  });
}
