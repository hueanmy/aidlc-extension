#!/usr/bin/env node
import { Command } from 'commander';
import { registerValidate } from './commands/validate';
import { registerList } from './commands/list';
import { registerStatus } from './commands/status';
import { registerInit } from './commands/init';
import { registerDoctor } from './commands/doctor';
import { registerAgent } from './commands/agent';
import { registerSkill } from './commands/skill';
import { registerPipeline } from './commands/pipeline';
import { registerPreset } from './commands/preset';
import { registerRun } from './commands/run';
import { registerStep } from './commands/step';
import { registerWatch } from './commands/watch';
import { registerTail } from './commands/tail';
import { registerDashboard } from './commands/dashboard';
import { registerEpic } from './commands/epic';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('aidlc')
  .description('AIDLC terminal CLI — drive workspace.yaml pipelines from any terminal')
  .version(version)
  .option('-w, --workspace <path>', 'workspace root (defaults to cwd)');

registerInit(program);
registerValidate(program);
registerList(program);
registerStatus(program);
registerDoctor(program);
registerAgent(program);
registerSkill(program);
registerPipeline(program);
registerPreset(program);
registerRun(program);
registerStep(program);
registerWatch(program);
registerTail(program);
registerDashboard(program);
registerEpic(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
