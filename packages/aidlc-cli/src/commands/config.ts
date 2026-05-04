import chalk from 'chalk';
import { readConfig, setConfigValue } from '../cliConfig';

export function cmdConfigShow(workspaceRoot: string): void {
  const config = readConfig(workspaceRoot);
  console.log(JSON.stringify(config, null, 2));
}

export function cmdConfigSet(workspaceRoot: string, key: string, value: string): void {
  try {
    setConfigValue(workspaceRoot, key, value);
    console.log(chalk.green(`✔`) + ` Set ${chalk.bold(key)} = ${chalk.cyan(value)}`);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
