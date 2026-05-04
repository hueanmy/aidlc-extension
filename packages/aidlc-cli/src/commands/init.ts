import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ensureMcpConfig } from '@aidlc/core';
import { readConfig, writeConfig } from '../cliConfig';

export async function cmdInit(workspaceRoot: string, opts: { mcp?: boolean }): Promise<void> {
  const spinner = ora('Initialising AIDLC workspace…').start();

  const config = readConfig(workspaceRoot);
  const epicsDir = path.resolve(workspaceRoot, config.epicsPath);

  if (!fs.existsSync(epicsDir)) {
    fs.mkdirSync(epicsDir, { recursive: true });
    spinner.succeed(`Created epics directory: ${chalk.cyan(epicsDir)}`);
  } else {
    spinner.info(`Epics directory already exists: ${chalk.cyan(epicsDir)}`);
  }

  writeConfig(workspaceRoot, config);
  console.log(chalk.green('✔') + ' Wrote .aidlc/config.json');

  if (opts.mcp) {
    const result = ensureMcpConfig(
      { workspaceRoot, ...config, autoConfigureMcp: true },
      (msg) => console.log(chalk.dim(`  [mcp] ${msg}`)),
    );
    if (result.status === 'written') {
      console.log(chalk.green(`✔ MCP entry written: ${result.serverName}`));
    } else if (result.status === 'already-exists') {
      console.log(chalk.yellow(`  MCP entry already exists: ${result.serverName}`));
    } else {
      console.log(chalk.dim(`  MCP skipped: ${result.reason}`));
    }
  }

  console.log('\n' + chalk.bold('Done.') + ' Run ' + chalk.cyan('aidlc list') + ' to see epics.');
}
