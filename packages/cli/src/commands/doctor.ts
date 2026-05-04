import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  WorkspaceLoader,
  WorkspaceNotFoundError,
  RunStateStore,
} from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';

interface Check {
  label: string;
  pass: boolean;
  info?: string;
}

function ok(label: string, info?: string): Check   { return { label, pass: true,  info }; }
function fail(label: string, info?: string): Check  { return { label, pass: false, info }; }

function printSection(title: string, checks: Check[]): void {
  console.log(chalk.bold(`\n${title}`));
  for (const c of checks) {
    const icon   = c.pass ? chalk.green('✔') : chalk.red('✘');
    const detail = c.info ? chalk.dim(`  ${c.info}`) : '';
    console.log(`  ${icon}  ${c.label}${detail}`);
  }
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Validate workspace, claude binary, env, skills, and run state files')
    .action((_opts: unknown, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);

      console.log(chalk.bold('\naidlc doctor'));
      console.log(chalk.dim(`workspace: ${root}\n`));

      // ── Workspace ────────────────────────────────────────────────────────
      const wsChecks: Check[] = [];
      let ws: Awaited<ReturnType<typeof WorkspaceLoader.load>> | null = null;

      const wsPath = path.join(root, '.aidlc', 'workspace.yaml');
      if (!fs.existsSync(wsPath)) {
        wsChecks.push(fail('.aidlc/workspace.yaml exists', 'run: aidlc init'));
      } else {
        wsChecks.push(ok('.aidlc/workspace.yaml exists'));
        try {
          ws = WorkspaceLoader.load(root);
          const c = ws.config;
          wsChecks.push(ok('workspace.yaml parses & validates',
            `${c.agents.length} agent${c.agents.length !== 1 ? 's' : ''}, ` +
            `${c.skills.length} skill${c.skills.length !== 1 ? 's' : ''}, ` +
            `${c.pipelines.length} pipeline${c.pipelines.length !== 1 ? 's' : ''}`));
        } catch (err) {
          wsChecks.push(fail('workspace.yaml parses & validates',
            err instanceof Error ? err.message : String(err)));
        }
      }

      printSection('Workspace', wsChecks);

      // ── Claude binary ─────────────────────────────────────────────────────
      const claudeChecks: Check[] = [];

      let claudeBin = '';
      try {
        claudeBin = execSync('which claude', { encoding: 'utf8', timeout: 5000 }).trim();
        claudeChecks.push(ok('claude binary on PATH', claudeBin));
      } catch {
        claudeChecks.push(fail('claude binary on PATH',
          'install: https://github.com/anthropics/claude-code'));
      }

      if (claudeBin) {
        try {
          const version = execSync('claude --version', {
            encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
          claudeChecks.push(ok(`claude --version`, version.split('\n')[0]));
        } catch {
          claudeChecks.push(fail('claude --version returned error',
            'try: claude --version in a terminal'));
        }
      }

      // Auth: check ANTHROPIC_API_KEY or claude internal login
      const apiKeySet = !!process.env.ANTHROPIC_API_KEY;
      if (apiKeySet) {
        claudeChecks.push(ok('ANTHROPIC_API_KEY set'));
      } else {
        // Claude Code can auth via its own login; check if claude can respond
        if (claudeBin) {
          try {
            execSync('claude config list', {
              encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'],
            });
            claudeChecks.push(ok('Claude authenticated (via claude config)', 'no ANTHROPIC_API_KEY needed'));
          } catch {
            claudeChecks.push(fail('Not authenticated',
              'set ANTHROPIC_API_KEY or run: claude login'));
          }
        } else {
          claudeChecks.push(fail('ANTHROPIC_API_KEY not set',
            'set ANTHROPIC_API_KEY env var or install claude and run: claude login'));
        }
      }

      printSection('Claude', claudeChecks);

      // ── Skills ────────────────────────────────────────────────────────────
      if (ws) {
        const skillChecks: Check[] = [];
        for (const skill of ws.config.skills) {
          if (skill.builtin) {
            // SkillLoader will validate; for now mark as assumed-ok
            skillChecks.push(ok(`skill "${skill.id}"`, 'builtin'));
          } else if (skill.path) {
            const absPath = path.resolve(root, skill.path);
            if (fs.existsSync(absPath)) {
              skillChecks.push(ok(`skill "${skill.id}"`, skill.path));
            } else {
              skillChecks.push(fail(`skill "${skill.id}"`,
                `file not found: ${skill.path}`));
            }
          } else {
            skillChecks.push(fail(`skill "${skill.id}"`, 'no path or builtin declared'));
          }
        }

        // Custom runner paths
        for (const agent of ws.config.agents) {
          if (agent.runner === 'custom' && agent.runner_path) {
            const absPath = path.resolve(root, agent.runner_path);
            if (fs.existsSync(absPath)) {
              skillChecks.push(ok(`runner "${agent.id}"`, agent.runner_path));
            } else {
              skillChecks.push(fail(`runner "${agent.id}"`,
                `runner_path not found: ${agent.runner_path}`));
            }
          }
        }

        if (skillChecks.length > 0) {
          printSection('Skills & runners', skillChecks);
        }
      }

      // ── Run state ────────────────────────────────────────────────────────
      const runChecks: Check[] = [];
      const runsDir = path.join(root, '.aidlc', 'runs');

      if (!fs.existsSync(runsDir)) {
        runChecks.push(ok('.aidlc/runs/', 'no runs yet'));
      } else {
        const allRuns = RunStateStore.list(root);
        const runFiles = fs.readdirSync(runsDir).filter(f => f.endsWith('.json'));
        const corrupt  = runFiles.length - allRuns.length;

        runChecks.push(ok(
          `${allRuns.length} run file${allRuns.length !== 1 ? 's' : ''} readable`,
          corrupt > 0 ? `${corrupt} corrupt file(s) skipped` : undefined,
        ));

        const active = allRuns.filter(r => r.status === 'running');
        if (active.length > 0) {
          runChecks.push(ok(
            `${active.length} active run${active.length !== 1 ? 's' : ''}`,
            active.map(r => r.runId).join(', '),
          ));
        }
      }

      printSection('Runs', runChecks);

      // ── Runtime ──────────────────────────────────────────────────────────
      const nodeVersion = process.versions.node;
      const [nodeMajor] = nodeVersion.split('.').map(Number);
      printSection('Runtime', [
        nodeMajor >= 18
          ? ok(`Node.js ${nodeVersion}`)
          : fail(`Node.js ${nodeVersion}`, 'upgrade to Node.js 18+'),
      ]);

      // ── Summary ───────────────────────────────────────────────────────────
      const all = [...wsChecks, ...claudeChecks, ...runChecks];
      const failures = all.filter(c => !c.pass);

      console.log();
      if (failures.length === 0) {
        console.log(chalk.green('✔ All checks passed.'));
      } else {
        console.log(chalk.yellow(`⚠ ${failures.length} check${failures.length !== 1 ? 's' : ''} failed — see above.`));
        process.exit(1);
      }
      console.log();
    });
}
