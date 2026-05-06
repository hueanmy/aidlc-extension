import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { WORKSPACE_DIR } from '@aidlc/core';
import { readYaml, requireYaml, writeYaml, YamlDocument } from '../yamlIO';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import { SKILL_TEMPLATES } from '../skillTemplates';

// ── Built-in presets ──────────────────────────────────────────────────────────

interface BuiltinPreset {
  id: string;
  description: string;
  apply: (root: string, existing: YamlDocument) => YamlDocument;
}

const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: 'code-review',
    description: 'Single-agent code review pipeline: runs the code-reviewer skill on a diff',
    apply(root, doc) {
      ensureSkillFile(root, 'code-reviewer');
      addIfMissing(doc.skills, { id: 'code-reviewer', path: `./${WORKSPACE_DIR}/skills/code-reviewer.md` });
      addIfMissing(doc.agents, {
        id: 'reviewer',
        name: 'Code Reviewer',
        skills: ['code-reviewer'],
        model: 'claude-sonnet-4-5',
        capabilities: ['files', 'github'],
        description: 'Reviews diffs for bugs, security issues, and perf regressions.',
        outputs: 'Structured table with severity / category / verdict, plus PASS or FAIL verdict.',
      });
      addIfMissing(doc.pipelines, {
        id: 'review-pipeline',
        steps: [{ agent: 'reviewer', human_review: true }],
        on_failure: 'stop',
      });
      return doc;
    },
  },
  {
    id: 'release-notes',
    description: 'Single-agent pipeline that turns git commits into user-facing release notes',
    apply(root, doc) {
      ensureSkillFile(root, 'release-notes');
      addIfMissing(doc.skills, { id: 'release-notes', path: `./${WORKSPACE_DIR}/skills/release-notes.md` });
      addIfMissing(doc.agents, {
        id: 'release-writer',
        name: 'Release Notes Writer',
        skills: ['release-notes'],
        model: 'claude-sonnet-4-5',
        description: 'Summarises git commits into user-facing release notes.',
        outputs: 'Markdown release notes grouped by ✨ New / 🛠 Improved / 🐛 Fixed.',
      });
      addIfMissing(doc.pipelines, {
        id: 'release-pipeline',
        steps: [{ agent: 'release-writer', produces: ['RELEASE-NOTES.md'], human_review: true }],
        on_failure: 'stop',
      });
      return doc;
    },
  },
  {
    id: 'sdlc',
    description: 'Full SDLC pipeline: Plan → Design → Test Plan → Implement → Review → Execute Test → Release → Monitor → Doc Sync',
    apply(root, doc) {
      const phases: Array<{ id: string; name: string; skills: string[]; model: string; artifact: string | null }> = [
        { id: 'planner',       name: 'Planner',          skills: ['hello-world'],   model: 'claude-opus-4-7',    artifact: 'PRD.md' },
        { id: 'designer',      name: 'Tech Lead',         skills: ['hello-world'],   model: 'claude-opus-4-7',    artifact: 'TECH-DESIGN.md' },
        { id: 'test-planner',  name: 'QA Engineer',       skills: ['hello-world'],   model: 'claude-sonnet-4-5',  artifact: 'TEST-PLAN.md' },
        { id: 'developer',     name: 'Developer',         skills: ['hello-world'],   model: 'claude-sonnet-4-5',  artifact: null },
        { id: 'auto-reviewer', name: 'Auto Reviewer',     skills: ['code-reviewer'], model: 'claude-opus-4-7',    artifact: 'APPROVAL.md' },
        { id: 'qa-executor',   name: 'QA Executor',       skills: ['hello-world'],   model: 'claude-sonnet-4-5',  artifact: 'TEST-SCRIPT.md' },
        { id: 'release-mgr',   name: 'Release Manager',   skills: ['release-notes'], model: 'claude-sonnet-4-5',  artifact: 'RELEASE-NOTES.md' },
        { id: 'sre',           name: 'SRE',               skills: ['hello-world'],   model: 'claude-sonnet-4-5',  artifact: null },
        { id: 'archivist',     name: 'Archivist',         skills: ['hello-world'],   model: 'claude-sonnet-4-5',  artifact: 'DOC-SYNC.md' },
      ];

      // Ensure all .md files exist on disk BEFORE modifying doc — if a write
      // fails we want to abort before workspace.yaml is touched.
      ensureSkillFile(root, 'hello-world');
      ensureSkillFile(root, 'code-reviewer');
      ensureSkillFile(root, 'release-notes');

      addIfMissing(doc.skills, { id: 'hello-world',   path: `./${WORKSPACE_DIR}/skills/hello-world.md` });
      addIfMissing(doc.skills, { id: 'code-reviewer', path: `./${WORKSPACE_DIR}/skills/code-reviewer.md` });
      addIfMissing(doc.skills, { id: 'release-notes', path: `./${WORKSPACE_DIR}/skills/release-notes.md` });

      for (const p of phases) {
        const agent: Record<string, unknown> = {
          id: p.id, name: p.name, skills: p.skills, model: p.model,
        };
        if (p.artifact) { agent.artifact = p.artifact; }
        addIfMissing(doc.agents, agent);
      }

      const steps = phases.map(p => ({
        agent: p.id,
        ...(p.artifact ? { produces: [`docs/epics/{epic}/${p.artifact}`] } : {}),
        human_review: ['auto-reviewer', 'release-mgr'].includes(p.id),
      }));

      addIfMissing(doc.pipelines, {
        id: 'sdlc-pipeline',
        steps,
        on_failure: 'stop',
      });

      return doc;
    },
  },
];

// ── User presets (stored in .aidlc/presets/*.json) ────────────────────────────

const PRESETS_DIR = path.join(WORKSPACE_DIR, 'presets');

function presetsDir(root: string): string {
  return path.join(root, PRESETS_DIR);
}

interface UserPreset {
  id: string;
  savedAt: string;
  workspace: YamlDocument;
}

function listUserPresets(root: string): UserPreset[] {
  const dir = presetsDir(root);
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as UserPreset; }
      catch (err) {
        console.warn(chalk.yellow(`⚠ Skipping corrupt preset file ${f}: ${err instanceof Error ? err.message : String(err)}`));
        return null;
      }
    })
    .filter((p): p is UserPreset => p !== null);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureSkillFile(root: string, templateId: string): void {
  const tpl = SKILL_TEMPLATES.find(t => t.id === templateId);
  if (!tpl) { return; }
  const dir  = path.join(root, WORKSPACE_DIR, 'skills');
  // Use <templateId>.md as filename — consistent with what skill add produces.
  const file = path.join(dir, `${templateId}.md`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, tpl.content, 'utf8');
  }
}

function addIfMissing(arr: Array<Record<string, unknown>>, item: Record<string, unknown>): void {
  if (!arr.some(x => x.id === item.id)) { arr.push(item); }
}

// ── Command registration ──────────────────────────────────────────────────────

export function registerPreset(program: Command): void {
  const cmd = program.command('preset').description('Apply or save workspace presets');

  // ── list ────────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List available presets (built-in + saved)')
    .option('--json', 'Output raw JSON')
    .action((opts: { json?: boolean }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const users = listUserPresets(root);

      if (opts.json) {
        console.log(JSON.stringify({
          builtin: BUILTIN_PRESETS.map(p => ({ id: p.id, description: p.description })),
          saved:   users.map(p => ({ id: p.id, savedAt: p.savedAt })),
        }, null, 2));
        return;
      }

      console.log(chalk.bold('\nBuilt-in presets'));
      for (const p of BUILTIN_PRESETS) {
        console.log(`  ${chalk.cyan(p.id.padEnd(20))} ${chalk.dim(p.description)}`);
      }

      if (users.length > 0) {
        console.log(chalk.bold('\nSaved presets'));
        for (const p of users) {
          const date = new Date(p.savedAt).toLocaleDateString();
          console.log(`  ${chalk.green(p.id.padEnd(20))} ${chalk.dim(`saved ${date}`)}`);
        }
      }
      console.log();
    });

  // ── apply ───────────────────────────────────────────────────────────────────
  cmd
    .command('apply <name>')
    .description('Apply a preset to the current workspace (merges into existing config)')
    .action((name: string, _opts: unknown, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      let doc = readYaml(root);

      // Start from a blank doc if workspace doesn't exist yet
      if (!doc) {
        doc = {
          version: '1.0',
          name: 'AIDLC Workspace',
          agents: [], skills: [], environment: {},
          slash_commands: [], pipelines: [],
        };
      }

      // Check built-in presets first
      const builtin = BUILTIN_PRESETS.find(p => p.id === name);
      if (builtin) {
        const updated = builtin.apply(root, doc);
        writeYaml(root, updated);
        const a = updated.agents.length;
        const s = updated.skills.length;
        const p = updated.pipelines.length;
        console.log(chalk.green('✔') + ` Applied preset ${chalk.bold(name)}`);
        console.log(chalk.dim(`  ${a} agent${a !== 1 ? 's' : ''}, ${s} skill${s !== 1 ? 's' : ''}, ${p} pipeline${p !== 1 ? 's' : ''}`));
        console.log(chalk.dim('  Run: aidlc validate && aidlc list'));
        return;
      }

      // Check user presets
      const userPresets = listUserPresets(root);
      const user = userPresets.find(p => p.id === name);
      if (user) {
        const updated: YamlDocument = {
          ...doc,
          agents:    [...doc.agents,    ...user.workspace.agents.filter(a => !doc!.agents.some(x => x.id === a.id))],
          skills:    [...doc.skills,    ...user.workspace.skills.filter(s => !doc!.skills.some(x => x.id === s.id))],
          pipelines: [...doc.pipelines, ...user.workspace.pipelines.filter(p => !doc!.pipelines.some(x => x.id === p.id))],
        };
        writeYaml(root, updated);
        console.log(chalk.green('✔') + ` Applied saved preset ${chalk.bold(name)}`);
        return;
      }

      console.error(chalk.red(`Preset "${name}" not found.`));
      console.error(chalk.dim('Run: aidlc preset list'));
      process.exit(1);
    });

  // ── save ────────────────────────────────────────────────────────────────────
  cmd
    .command('save <name>')
    .description('Save the current workspace as a reusable preset')
    .action((name: string, _opts: unknown, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = requireYaml(root);

      const dir = presetsDir(root);
      fs.mkdirSync(dir, { recursive: true });

      const preset: UserPreset = {
        id: name,
        savedAt: new Date().toISOString(),
        workspace: doc,
      };
      const file = path.join(dir, `${name}.json`);
      const alreadyExists = fs.existsSync(file);

      fs.writeFileSync(file, JSON.stringify(preset, null, 2) + '\n', 'utf8');
      const action = alreadyExists ? 'Updated' : 'Saved';
      console.log(chalk.green('✔') + ` ${action} preset ${chalk.bold(name)}`);
      console.log(chalk.dim(`  ${doc.agents.length} agents, ${doc.skills.length} skills, ${doc.pipelines.length} pipelines`));
    });
}
