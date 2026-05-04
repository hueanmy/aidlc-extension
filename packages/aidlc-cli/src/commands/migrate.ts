import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { migrateEpics } from '@aidlc/core';
import { readConfig } from '../cliConfig';

export function cmdMigrate(workspaceRoot: string): void {
  const spinner = ora('Running migrations…').start();
  const config = readConfig(workspaceRoot);
  const epicsDir = path.resolve(workspaceRoot, config.epicsPath);

  const results = migrateEpics(epicsDir, (msg) => {
    spinner.text = msg;
  });

  if (results.length === 0) {
    spinner.succeed('Nothing to migrate — all epics are up to date.');
    return;
  }

  spinner.succeed(`Migrated ${results.length} item${results.length === 1 ? '' : 's'}:`);
  for (const r of results) {
    console.log(chalk.dim(`  • ${r}`));
  }
}
