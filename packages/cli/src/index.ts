#!/usr/bin/env node
import { Command } from 'commander';
import { registerValidate } from './commands/validate';
import { registerList } from './commands/list';
import { registerStatus } from './commands/status';

const program = new Command();

program
  .name('aidlc')
  .description('AIDLC terminal CLI — drive workspace.yaml pipelines from any terminal')
  .version('0.0.1')
  .option('-w, --workspace <path>', 'workspace root (defaults to cwd)');

registerValidate(program);
registerList(program);
registerStatus(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
