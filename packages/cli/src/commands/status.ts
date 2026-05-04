import { Command } from 'commander';
import { RunStateStore, normalizeStep, WorkspaceLoader } from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';

export function registerStatus(program: Command): void {
  program
    .command('status [runId]')
    .description('List runs in .aidlc/runs/, or show one run in detail')
    .option('--json', 'output JSON')
    .action(async (runId: string | undefined, opts: { json?: boolean }, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);

      if (!runId) {
        const runs = RunStateStore.list(root);
        if (opts.json) {
          console.log(JSON.stringify(runs, null, 2));
          return;
        }
        if (runs.length === 0) {
          console.log('No runs in .aidlc/runs/');
          return;
        }
        console.log(`${runs.length} run(s):`);
        for (const r of runs) {
          const cur = r.steps[r.currentStepIdx];
          console.log(
            `  ${r.runId.padEnd(28)} ${r.pipelineId.padEnd(20)} ${r.status.padEnd(10)} step ${r.currentStepIdx + 1}/${r.steps.length} (${cur?.status ?? '—'})`,
          );
        }
        return;
      }

      const run = RunStateStore.load(root, runId);
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(run, null, 2));
        return;
      }

      const ws = await WorkspaceLoader.load(root);
      const pipeline = ws.config.pipelines.find((p) => p.id === run.pipelineId);

      console.log(`Run:      ${run.runId}`);
      console.log(`Pipeline: ${run.pipelineId}`);
      console.log(`Status:   ${run.status}`);
      console.log(`Started:  ${run.startedAt}`);
      console.log(`Updated:  ${run.updatedAt}`);
      console.log('Context:');
      for (const [k, v] of Object.entries(run.context)) {
        console.log(`  ${k}=${v}`);
      }
      console.log('Steps:');
      for (let i = 0; i < run.steps.length; i++) {
        const s = run.steps[i];
        const stepDef = pipeline?.steps[i];
        const norm = stepDef ? normalizeStep(stepDef) : null;
        const marker = i === run.currentStepIdx ? '>' : ' ';
        const review = norm?.human_review ? ' [review]' : '';
        console.log(`  ${marker} ${i + 1}. ${s.agent.padEnd(24)} rev=${s.revision} ${s.status}${review}`);
        if (s.rejectReason) { console.log(`      reject: ${s.rejectReason}`); }
        if (s.feedback) { console.log(`      feedback: ${s.feedback}`); }
      }
    });
}
