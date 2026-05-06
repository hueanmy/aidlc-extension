import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { validateWorkspace, WorkspaceLoader } from '@aidlc/core';
import { requireYaml, writeYaml, existingIds } from '../yamlIO';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import { parseContext, loadAgentSkills, formatSkillsList } from '../runHelpers';

export function registerAgent(program: Command): void {
  const cmd = program.command('agent').description('Manage agents in workspace.yaml');

  // ── add ────────────────────────────────────────────────────────────────────
  cmd
    .command('add')
    .description('Add a new agent to workspace.yaml')
    .requiredOption('--id <id>',     'unique agent id (e.g. code-reviewer)')
    .requiredOption('--name <name>',  'display name (e.g. "Code Reviewer")')
    .requiredOption('--skills <ids>', 'comma-separated skill ids this agent uses (at least one)')
    .option('--model <model>',   'Claude model override', 'claude-sonnet-4-5')
    .option('--capabilities <caps>', 'comma-separated capabilities (e.g. files,github)')
    .option('--description <desc>',  'one-line description shown in the sidebar')
    .option('--runner <runner>',  'runner type: default or custom', 'default')
    .option('--runner-path <path>',  'path to custom runner .js (required when --runner custom)')
    .action((opts: {
      id: string; name: string; skills: string; model: string;
      capabilities?: string; description?: string;
      runner: string; runnerPath?: string;
    }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);

      if (existingIds(doc.agents).has(opts.id)) {
        console.error(chalk.red(`Agent "${opts.id}" already exists. Use a different --id.`));
        process.exit(1);
      }

      const requestedSkills = opts.skills.split(',').map(s => s.trim()).filter(Boolean);
      if (requestedSkills.length === 0) {
        console.error(chalk.red('--skills must list at least one skill id.'));
        process.exit(1);
      }

      const skillIds = existingIds(doc.skills);
      const missing = requestedSkills.filter(id => !skillIds.has(id));
      if (missing.length > 0) {
        console.error(chalk.red(`Skill${missing.length === 1 ? '' : 's'} not found in workspace.yaml: ${missing.join(', ')}`));
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
        skills: requestedSkills,
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
      console.log(chalk.green('✔') + ` Added agent ${chalk.bold(opts.id)} (skills: ${requestedSkills.join(', ')})`);
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
        console.log(chalk.dim('No agents defined. Run: aidlc agent add --id <id> --name <name> --skills <ids>'));
        return;
      }
      for (const a of doc.agents) {
        const model  = a.model  ? chalk.dim(` [${a.model}]`)  : '';
        const runner = a.runner && a.runner !== 'default' ? chalk.yellow(` (${a.runner})`) : '';
        const desc   = a.description ? chalk.dim(`  ${a.description}`) : '';
        const skills = Array.isArray(a.skills)
          ? (a.skills as unknown[]).map(String).join(',')
          : (typeof a.skill === 'string' ? a.skill : '');
        console.log(`  ${chalk.bold(String(a.id))}  ${chalk.dim('skills:')}${skills}${model}${runner}${desc}`);
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

  // ── run ────────────────────────────────────────────────────────────────────
  cmd
    .command('run <id>')
    .description('One-shot: run an agent directly without creating a run state file')
    .option('--message <text>', 'User message sent to claude (what to do)')
    .option('--context <pairs>', 'Context key=value pairs, comma-separated (e.g. epic=ABC-123)')
    .option('--dry-run', 'Print the assembled prompt without spawning claude')
    .action(async (id: string, opts: {
      message?: string; context?: string; dryRun?: boolean;
    }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);

      let ws;
      try {
        ws = WorkspaceLoader.load(root);
      } catch (err) {
        console.error(chalk.red(`Failed to load workspace: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }

      const agent = ws.config.agents.find(a => a.id === id);
      if (!agent) {
        const ids = ws.config.agents.map(a => a.id);
        console.error(chalk.red(`Agent "${id}" not found.`));
        if (ids.length > 0) { console.error(chalk.dim(`Available: ${ids.join(', ')}`)); }
        process.exit(1);
      }

      let skillText: string;
      try {
        skillText = loadAgentSkills(ws.skills, agent);
      } catch (err) {
        console.error(chalk.red(`Failed to load skills for agent "${id}": ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }

      const env = ws.envResolver.resolveLayered(ws.config.environment ?? {}, agent.env ?? {});
      const context = opts.context ? parseContext(opts.context) : {};
      const contextStr = Object.entries(context).map(([k, v]) => `${k}=${v}`).join(' ');
      const userMessage = opts.message ?? (contextStr || `Run agent: ${id}`);

      if (opts.dryRun) {
        console.log(chalk.bold(`\n── System prompt (skills: ${formatSkillsList(agent)}) ──`));
        console.log(chalk.dim(skillText));
        console.log(chalk.bold('\n── User message ───────────────────────────────────────'));
        console.log(userMessage || chalk.dim('(empty)'));
        console.log();
        return;
      }

      console.log(chalk.bold(`\n▶  ${id}`) + chalk.dim(`  skills: ${formatSkillsList(agent)}`));
      if (userMessage) { console.log(chalk.dim(`   ${userMessage}`)); }
      console.log(chalk.dim('─'.repeat(60)));

      const runner = ws.runners.resolve(agent);
      const result = await runner.run({
        skill: skillText,
        env,
        args: userMessage ? [userMessage] : [],
        workspaceRoot: root,
        onOutput: (chunk) => process.stdout.write(chunk),
        onError:  (chunk) => process.stderr.write(chalk.dim(chunk)),
        claude: null,
      });

      console.log(chalk.dim('─'.repeat(60)));
      if (!result.success) {
        console.error(chalk.red(`\n✘  Agent "${id}" exited with an error.`));
        process.exit(1);
      }
      console.log(chalk.green(`\n✔  Done.`));
    });
}
