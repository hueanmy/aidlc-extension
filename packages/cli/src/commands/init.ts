import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveWorkspaceRoot } from '../workspaceRoot';

const AIDLC_DIR      = '.aidlc';
const WORKSPACE_FILE = 'workspace.yaml';
const SKILLS_DIR     = 'skills';
const RUNS_DIR       = 'runs';

const STARTER_WORKSPACE = `version: "1.0"
name: "My AIDLC Workspace"

# Skills are system prompts for your Claude agents.
# Add a builtin skill (bundled) or point to your own .md file.
skills: []
#   - id: code-reviewer
#     builtin: true
#   - id: my-skill
#     path: ./.aidlc/skills/my-skill.md

# Agents are Claude instances wired to a skill.
agents: []
#   - id: reviewer
#     name: "Code Reviewer"
#     skill: code-reviewer
#     model: claude-sonnet-4-5
#     capabilities: [files, github]

# Pipelines chain agents into ordered steps.
pipelines: []
#   - id: review-pipeline
#     steps:
#       - agent: reviewer
#         produces: ["docs/review-{epic}.md"]
#         human_review: true

# Optional: declare a context entity that persists state across runs.
# state:
#   entity: epic
#   root: docs/epics
#   status_file: .state.json
`;

function check(label: string, pass: boolean, info?: string): void {
  const icon = pass ? chalk.green('✔') : chalk.yellow('ℹ');
  const detail = info ? chalk.dim(`  ${info}`) : '';
  console.log(`  ${icon}  ${label}${detail}`);
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Scaffold .aidlc/ workspace for a new project')
    .option('--name <name>', 'workspace name (written into workspace.yaml)', 'My AIDLC Workspace')
    .action(async (opts: { name: string }, cmd: Command) => {
      const root    = resolveWorkspaceRoot(cmd);
      const aidlcDir = path.join(root, AIDLC_DIR);
      const wsPath   = path.join(aidlcDir, WORKSPACE_FILE);
      const skillsDir = path.join(aidlcDir, SKILLS_DIR);
      const runsDir   = path.join(aidlcDir, RUNS_DIR);

      console.log(chalk.bold('\naidlc init'));
      console.log(chalk.dim(`workspace: ${root}\n`));

      // workspace.yaml
      if (fs.existsSync(wsPath)) {
        check(`${AIDLC_DIR}/${WORKSPACE_FILE}`, true, 'already exists — skipped');
      } else {
        fs.mkdirSync(aidlcDir, { recursive: true });
        const content = STARTER_WORKSPACE.replace(
          '"My AIDLC Workspace"',
          JSON.stringify(opts.name),
        );
        fs.writeFileSync(wsPath, content, 'utf8');
        check(`${AIDLC_DIR}/${WORKSPACE_FILE}`, true, 'created');
      }

      // .aidlc/skills/
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
        check(`${AIDLC_DIR}/${SKILLS_DIR}/`, true, 'created');
      } else {
        check(`${AIDLC_DIR}/${SKILLS_DIR}/`, true, 'already exists — skipped');
      }

      // .aidlc/runs/
      if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
        check(`${AIDLC_DIR}/${RUNS_DIR}/`, true, 'created');
      } else {
        check(`${AIDLC_DIR}/${RUNS_DIR}/`, true, 'already exists — skipped');
      }

      console.log();
      console.log(chalk.green('✔') + ' Done. Next steps:');
      console.log(chalk.dim(`  1. Edit ${chalk.white(`.aidlc/${WORKSPACE_FILE}`)} to add agents, skills, and pipelines`));
      console.log(chalk.dim(`  2. Run ${chalk.cyan('aidlc validate')} to check the schema`));
      console.log(chalk.dim(`  3. Run ${chalk.cyan('aidlc doctor')} to verify the Claude binary and env`));
      console.log(chalk.dim(`  4. Run ${chalk.cyan('aidlc agent add')} to add your first agent (M2)\n`));
    });
}
