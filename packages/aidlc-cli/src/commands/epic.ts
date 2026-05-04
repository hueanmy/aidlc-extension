import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { createEpicFolder } from '@aidlc/core';
import { readConfig } from '../cliConfig';

export async function cmdEpicNew(
  workspaceRoot: string,
  epicKey: string,
  title: string,
): Promise<void> {
  const spinner = ora(`Creating epic ${chalk.bold(epicKey)}…`).start();
  const config = readConfig(workspaceRoot);

  const templateRoot = config.templateSourcePath
    ? path.resolve(workspaceRoot, config.templateSourcePath)
    : path.resolve(__dirname, '../../../../templates/generic');

  try {
    createEpicFolder(
      workspaceRoot,
      config.epicsPath,
      epicKey,
      title,
      templateRoot,
      (msg) => spinner.text = msg,
    );
    spinner.succeed(`Created ${chalk.bold(epicKey)} — ${title}`);
    console.log(chalk.dim(`  Run: aidlc status ${epicKey}`));
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
