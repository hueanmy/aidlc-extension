import { Command } from 'commander';
import { WorkspaceLoader, stepAgentId } from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('Print agents, skills, and pipelines from workspace.yaml')
    .option('--json', 'output JSON instead of human-readable text')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);
      const ws = await WorkspaceLoader.load(root);
      const c = ws.config;

      if (opts.json) {
        console.log(JSON.stringify({
          name: c.name,
          version: c.version,
          agents: c.agents.map((a) => ({ id: a.id, name: a.name, skills: a.skills })),
          skills: c.skills.map((s) => ({ id: s.id, builtin: s.builtin === true })),
          pipelines: c.pipelines.map((p) => ({
            id: p.id,
            steps: p.steps.map((s) => stepAgentId(s)),
          })),
        }, null, 2));
        return;
      }

      console.log(`${c.name} (workspace v${c.version})`);
      console.log('');
      console.log(`Agents (${c.agents.length}):`);
      for (const a of c.agents) {
        console.log(`  - ${a.id}: ${a.name} [skills=${a.skills.join(',')}]`);
      }
      console.log('');
      console.log(`Skills (${c.skills.length}):`);
      for (const s of c.skills) {
        console.log(`  - ${s.id}${s.builtin ? ' (builtin)' : ` (${s.path})`}`);
      }
      console.log('');
      console.log(`Pipelines (${c.pipelines.length}):`);
      for (const p of c.pipelines) {
        const steps = p.steps.map((s) => stepAgentId(s)).join(' → ');
        console.log(`  - ${p.id}: ${steps}`);
      }
    });
}
