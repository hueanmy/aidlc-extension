import { Command } from 'commander';
import chalk from 'chalk';
import { validateWorkspace } from '@aidlc/core';
import { requireYaml, writeYaml, existingIds } from '../yamlIO';
import { resolveWorkspaceRoot } from '../workspaceRoot';

export function registerPipeline(program: Command): void {
  const cmd = program.command('pipeline').description('Manage pipelines in workspace.yaml');

  // ── add ────────────────────────────────────────────────────────────────────
  cmd
    .command('add')
    .description('Add a new pipeline')
    .requiredOption('--id <id>', 'unique pipeline id (e.g. full-review)')
    .requiredOption('--steps <agents>',
      'comma-separated agent ids in order (e.g. planner,coder,reviewer)')
    .option('--human-review', 'mark every step as requiring human review before advancing')
    .option('--on-failure <mode>', '"stop" or "continue" on step failure', 'stop')
    .option('--produces <paths>',
      'comma-separated artifact path templates per step, colon-separated per step\n' +
      '  e.g. "docs/{epic}/PRD.md:docs/{epic}/TECH.md" — one section per step')
    .action((opts: {
      id: string; steps: string;
      humanReview?: boolean; onFailure: string; produces?: string;
    }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);

      if (existingIds(doc.pipelines).has(opts.id)) {
        console.error(chalk.red(`Pipeline "${opts.id}" already exists.`));
        process.exit(1);
      }

      const stepIds    = opts.steps.split(',').map(s => s.trim()).filter(Boolean);
      const agentIds   = existingIds(doc.agents);
      const unknown    = stepIds.filter(id => !agentIds.has(id));
      if (unknown.length > 0) {
        console.error(chalk.red(`Unknown agent(s): ${unknown.join(', ')}`));
        if (agentIds.size > 0) {
          console.error(chalk.dim(`Available agents: ${[...agentIds].join(', ')}`));
        } else {
          console.error(chalk.dim('Run: aidlc agent add --id <id> --name <n> --skill <s>'));
        }
        process.exit(1);
      }

      // Parse per-step produces (colon-separated artifact path templates)
      const producesPerStep: string[][] = [];
      if (opts.produces) {
        const sections = opts.produces.split(':');
        for (const section of sections) {
          producesPerStep.push(section.split(',').map(s => s.trim()).filter(Boolean));
        }
      }

      const steps = stepIds.map((agent, i) => {
        const hasMeta = (producesPerStep[i]?.length ?? 0) > 0 || opts.humanReview;
        if (!hasMeta) { return agent; }   // write clean string when no metadata
        const step: Record<string, unknown> = { agent };
        if (producesPerStep[i]?.length) { step.produces = producesPerStep[i]; }
        if (opts.humanReview) { step.human_review = true; }
        return step;
      });

      const pipeline: Record<string, unknown> = {
        id: opts.id,
        steps,
        on_failure: opts.onFailure,
      };

      doc.pipelines.push(pipeline);

      try {
        validateWorkspace(doc, '.aidlc/workspace.yaml');
      } catch (err) {
        console.error(chalk.red('Validation failed — workspace.yaml not written:'));
        console.error(chalk.dim(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      writeYaml(root, doc);
      console.log(chalk.green('✔') + ` Added pipeline ${chalk.bold(opts.id)}`);
      console.log(chalk.dim(`  Steps: ${stepIds.join(' → ')}`));
    });

  // ── list ───────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List all pipelines')
    .option('--json', 'Output raw JSON')
    .action((opts: { json?: boolean }, actionCmd: Command) => {
      const doc = requireYaml(resolveWorkspaceRoot(actionCmd));
      if (opts.json) { console.log(JSON.stringify(doc.pipelines, null, 2)); return; }

      if (doc.pipelines.length === 0) {
        console.log(chalk.dim('No pipelines defined. Run: aidlc pipeline add --id <id> --steps agent1,agent2'));
        return;
      }
      for (const p of doc.pipelines) {
        const steps = Array.isArray(p.steps)
          ? (p.steps as Array<Record<string, unknown>>)
            .map(s => typeof s === 'string' ? s : String(s.agent ?? '?'))
            .join(chalk.dim(' → '))
          : chalk.dim('(no steps)');
        console.log(`  ${chalk.bold(String(p.id))}  ${steps}`);
      }
      console.log(chalk.dim(`\n${doc.pipelines.length} pipeline${doc.pipelines.length !== 1 ? 's' : ''}`));
    });

  // ── show ───────────────────────────────────────────────────────────────────
  cmd
    .command('show <id>')
    .description('Show full pipeline definition')
    .action((id: string, _opts: unknown, actionCmd: Command) => {
      const doc      = requireYaml(resolveWorkspaceRoot(actionCmd));
      const pipeline = doc.pipelines.find(p => p.id === id);
      if (!pipeline) {
        console.error(chalk.red(`Pipeline "${id}" not found.`));
        process.exit(1);
      }

      console.log(chalk.bold(`\n${id}`));
      const steps = Array.isArray(pipeline.steps)
        ? (pipeline.steps as Array<Record<string, unknown>>)
        : [];
      steps.forEach((step, i) => {
        const agent   = typeof step === 'string' ? step : String(step.agent ?? '?');
        const review  = step.human_review ? chalk.yellow(' [review]') : '';
        const prod    = Array.isArray(step.produces) && step.produces.length
          ? chalk.dim(` → ${(step.produces as string[]).join(', ')}`) : '';
        console.log(`  ${chalk.dim(String(i + 1) + '.')} ${chalk.bold(agent)}${review}${prod}`);
      });
      console.log();
    });

  // ── remove ─────────────────────────────────────────────────────────────────
  cmd
    .command('remove <id>')
    .description('Remove a pipeline from workspace.yaml')
    .action((id: string, _opts: unknown, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);
      const before = doc.pipelines.length;
      doc.pipelines = doc.pipelines.filter(p => p.id !== id);
      if (doc.pipelines.length === before) {
        console.error(chalk.red(`Pipeline "${id}" not found.`));
        process.exit(1);
      }
      writeYaml(root, doc);
      console.log(chalk.green('✔') + ` Removed pipeline ${chalk.bold(id)}`);
    });
}
