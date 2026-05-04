import { Command } from 'commander';
import {
  WorkspaceLoader,
  WorkspaceNotFoundError,
  WorkspaceParseError,
  WorkspaceValidationError,
} from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description('Validate .aidlc/workspace.yaml against the schema')
    .action(async (_opts, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);
      try {
        const ws = await WorkspaceLoader.load(root);
        const c = ws.config;
        console.log(`workspace.yaml OK (${ws.configPath})`);
        console.log(`  agents:    ${c.agents.length}`);
        console.log(`  skills:    ${c.skills.length}`);
        console.log(`  pipelines: ${c.pipelines.length}`);
      } catch (err) {
        if (err instanceof WorkspaceNotFoundError) {
          console.error(err.message);
        } else if (err instanceof WorkspaceParseError) {
          console.error(`workspace.yaml parse error: ${err.message}`);
        } else if (err instanceof WorkspaceValidationError) {
          console.error('workspace.yaml validation failed:');
          for (const issue of err.issues) {
            console.error(`  - ${issue.path.join('.') || '<root>'}: ${issue.message}`);
          }
        } else {
          throw err;
        }
        process.exit(1);
      }
    });
}
