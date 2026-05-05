import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { validateWorkspace } from '@aidlc/core';
import { requireYaml, writeYaml, existingIds } from '../yamlIO';
import { resolveWorkspaceRoot } from '../workspaceRoot';

export function registerAgent(program: Command): void {
  const cmd = program.command('agent').description('Manage agents in workspace.yaml');

  // ── add ────────────────────────────────────────────────────────────────────
  cmd
    .command('add')
    .description('Add a new agent to workspace.yaml')
    .requiredOption('--id <id>',     'unique agent id (e.g. code-reviewer)')
    .requiredOption('--name <name>',  'display name (e.g. "Code Reviewer")')
    .requiredOption('--skill <skill>', 'skill id this agent uses')
    .option('--model <model>',   'Claude model override', 'claude-sonnet-4-5')
    .option('--capabilities <caps>', 'comma-separated capabilities (e.g. files,github)')
    .option('--description <desc>',  'one-line description shown in the sidebar')
    .option('--runner <runner>',  'runner type: default or custom', 'default')
    .option('--runner-path <path>',  'path to custom runner .js (required when --runner custom)')
    .action((opts: {
      id: string; name: string; skill: string; model: string;
      capabilities?: string; description?: string;
      runner: string; runnerPath?: string;
    }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);

      if (existingIds(doc.agents).has(opts.id)) {
        console.error(chalk.red(`Agent "${opts.id}" already exists. Use a different --id.`));
        process.exit(1);
      }

      const skillIds = existingIds(doc.skills);
      if (!skillIds.has(opts.skill)) {
        console.error(chalk.red(`Skill "${opts.skill}" not found in workspace.yaml.`));
        if (skillIds.size > 0) {
          console.error(chalk.dim(`  Available: ${[...skillIds].join(', ')}`));
        } else {
          console.error(chalk.dim('  Run: aidlc skill add --id <id> --template hello-world'));
        }
        process.exit(1);
      }

      if (opts.runner === 'custom' && !opts.runnerPath) {
        console.error(chalk.red('--runner-path is required when --runner custom'));
        process.exit(1);
      }

      const agent: Record<string, unknown> = {
        id: opts.id,
        name: opts.name,
        skill: opts.skill,
        model: opts.model,
      };
      if (opts.capabilities) {
        agent.capabilities = opts.capabilities.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (opts.description) { agent.description = opts.description; }
      if (opts.runner !== 'default') { agent.runner = opts.runner; }
      if (opts.runnerPath) { agent.runner_path = opts.runnerPath; }

      doc.agents.push(agent);

      try {
        validateWorkspace(doc, '.aidlc/workspace.yaml');
      } catch (err) {
        console.error(chalk.red('Validation failed — workspace.yaml not written:'));
        console.error(chalk.dim(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      writeYaml(root, doc);
      console.log(chalk.green('✔') + ` Added agent ${chalk.bold(opts.id)} (skill: ${opts.skill})`);
    });

  // ── list ───────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List all agents')
    .option('--json', 'Output raw JSON')
    .action((opts: { json?: boolean }, actionCmd: Command) => {
      const doc = requireYaml(resolveWorkspaceRoot(actionCmd));
      if (opts.json) { console.log(JSON.stringify(doc.agents, null, 2)); return; }

      if (doc.agents.length === 0) {
        console.log(chalk.dim('No agents defined. Run: aidlc agent add --id <id> --name <name> --skill <skill>'));
        return;
      }
      for (const a of doc.agents) {
        const model  = a.model  ? chalk.dim(` [${a.model}]`)  : '';
        const runner = a.runner && a.runner !== 'default' ? chalk.yellow(` (${a.runner})`) : '';
        const desc   = a.description ? chalk.dim(`  ${a.description}`) : '';
        console.log(`  ${chalk.bold(String(a.id))}  ${chalk.dim('skill:')}${a.skill}${model}${runner}${desc}`);
      }
      console.log(chalk.dim(`\n${doc.agents.length} agent${doc.agents.length !== 1 ? 's' : ''}`));
    });

  // ── show ───────────────────────────────────────────────────────────────────
  cmd
    .command('show <id>')
    .description('Show details of one agent')
    .action((id: string, _opts: unknown, actionCmd: Command) => {
      const doc   = requireYaml(resolveWorkspaceRoot(actionCmd));
      const agent = doc.agents.find(a => a.id === id);
      if (!agent) {
        console.error(chalk.red(`Agent "${id}" not found.`));
        process.exit(1);
      }
      console.log(JSON.stringify(agent, null, 2));
    });

  // ── remove ─────────────────────────────────────────────────────────────────
  cmd
    .command('remove <id>')
    .description('Remove an agent from workspace.yaml')
    .action((id: string, _opts: unknown, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);
      const before = doc.agents.length;
      doc.agents = doc.agents.filter(a => a.id !== id);
      if (doc.agents.length === before) {
        console.error(chalk.red(`Agent "${id}" not found.`));
        process.exit(1);
      }
      writeYaml(root, doc);
      console.log(chalk.green('✔') + ` Removed agent ${chalk.bold(id)}`);
    });
}
