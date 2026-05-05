import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { validateWorkspace, WORKSPACE_DIR } from '@aidlc/core';
import { requireYaml, writeYaml, existingIds } from '../yamlIO';
import { SKILL_TEMPLATES, TEMPLATE_IDS, findTemplate } from '../skillTemplates';
import { resolveWorkspaceRoot } from '../workspaceRoot';

export function registerSkill(program: Command): void {
  const cmd = program.command('skill').description('Manage skills in workspace.yaml');

  // ── add ────────────────────────────────────────────────────────────────────
  cmd
    .command('add')
    .description('Add a new skill (--template to scaffold from a built-in, --path to reference your own .md)')
    .requiredOption('--id <id>', 'unique skill id (e.g. code-reviewer)')
    .option('--template <name>',
      `scaffold .md from a built-in template: ${TEMPLATE_IDS.join(', ')}`)
    .option('--path <file>', 'relative path to an existing .md file (e.g. .aidlc/skills/my.md)')
    .action((opts: { id: string; template?: string; path?: string }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);

      if (existingIds(doc.skills).has(opts.id)) {
        console.error(chalk.red(`Skill "${opts.id}" already exists.`));
        process.exit(1);
      }

      if (opts.template && opts.path) {
        console.error(chalk.red('Use either --template or --path, not both.'));
        process.exit(1);
      }
      if (!opts.template && !opts.path) {
        console.error(chalk.red('Provide --template <name> or --path <file>.'));
        console.error(chalk.dim(`Templates: ${TEMPLATE_IDS.join(', ')}`));
        process.exit(1);
      }

      let skillEntry: Record<string, unknown>;

      if (opts.template) {
        const tpl = findTemplate(opts.template);
        if (!tpl) {
          console.error(chalk.red(`Unknown template "${opts.template}".`));
          console.error(chalk.dim(`Available: ${TEMPLATE_IDS.join(', ')}`));
          process.exit(1);
        }
        // Write the skill .md into .aidlc/skills/
        const skillsDir = path.join(root, WORKSPACE_DIR, 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const filename = `${opts.id}.md`;
        const skillPath = path.join(skillsDir, filename);
        fs.writeFileSync(skillPath, tpl.content, 'utf8');
        const relPath = `./${WORKSPACE_DIR}/skills/${filename}`;
        skillEntry = { id: opts.id, path: relPath };
        console.log(chalk.dim(`  Wrote skill file: ${skillPath}`));
      } else {
        // --path: reference an existing file
        const absPath = path.resolve(root, opts.path!);
        if (!fs.existsSync(absPath)) {
          console.error(chalk.red(`Skill file not found: ${opts.path}`));
          process.exit(1);
        }
        skillEntry = { id: opts.id, path: opts.path };
      }

      doc.skills.push(skillEntry);

      try {
        validateWorkspace(doc, '.aidlc/workspace.yaml');
      } catch (err) {
        console.error(chalk.red('Validation failed — workspace.yaml not written:'));
        console.error(chalk.dim(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      writeYaml(root, doc);
      console.log(chalk.green('✔') + ` Added skill ${chalk.bold(opts.id)}`);
    });

  // ── list ───────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List all skills')
    .option('--json', 'Output raw JSON')
    .option('--templates', 'List built-in skill templates instead')
    .action((opts: { json?: boolean; templates?: boolean }, actionCmd: Command) => {
      if (opts.templates) {
        if (opts.json) { console.log(JSON.stringify(SKILL_TEMPLATES, null, 2)); return; }
        for (const t of SKILL_TEMPLATES) {
          console.log(`  ${chalk.bold(t.id).padEnd(22)} ${chalk.dim(t.description)}`);
        }
        return;
      }

      const doc = requireYaml(resolveWorkspaceRoot(actionCmd));
      if (opts.json) { console.log(JSON.stringify(doc.skills, null, 2)); return; }

      if (doc.skills.length === 0) {
        console.log(chalk.dim('No skills defined. Run: aidlc skill add --id <id> --template hello-world'));
        return;
      }
      for (const s of doc.skills) {
        const source = s.builtin ? chalk.cyan('builtin') : chalk.dim(String(s.path ?? ''));
        console.log(`  ${chalk.bold(String(s.id))}  ${source}`);
      }
      console.log(chalk.dim(`\n${doc.skills.length} skill${doc.skills.length !== 1 ? 's' : ''}`));
    });

  // ── show ───────────────────────────────────────────────────────────────────
  cmd
    .command('show <id>')
    .description('Print the .md content of a skill')
    .action((id: string, _opts: unknown, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const doc   = requireYaml(root);
      const skill = doc.skills.find(s => s.id === id);
      if (!skill) {
        console.error(chalk.red(`Skill "${id}" not found.`));
        process.exit(1);
      }
      if (skill.builtin) {
        console.log(chalk.dim(`(builtin skill — content loaded by the runner at runtime)`));
        return;
      }
      if (typeof skill.path === 'string') {
        const abs = path.resolve(root, skill.path);
        if (!fs.existsSync(abs)) {
          console.error(chalk.red(`Skill file not found: ${skill.path}`));
          process.exit(1);
        }
        console.log(fs.readFileSync(abs, 'utf8'));
        return;
      }
      console.log(JSON.stringify(skill, null, 2));
    });

  // ── remove ─────────────────────────────────────────────────────────────────
  cmd
    .command('remove <id>')
    .description('Remove a skill from workspace.yaml (does not delete the .md file)')
    .action((id: string, _opts: unknown, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);
      const before = doc.skills.length;
      doc.skills = doc.skills.filter(s => s.id !== id);
      if (doc.skills.length === before) {
        console.error(chalk.red(`Skill "${id}" not found.`));
        process.exit(1);
      }
      writeYaml(root, doc);
      console.log(chalk.green('✔') + ` Removed skill ${chalk.bold(id)} from workspace.yaml`);
      console.log(chalk.dim('  (the .md file was not deleted — remove it manually if needed)'));
    });
}
