import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import { readYaml } from '../yamlIO';
import { listEpics, loadEpic, type EpicStatus, type EpicSummary } from '../epicsList';

export function registerEpic(program: Command): void {
  const cmd = program
    .command('epic')
    .description('List + inspect epics from <state.root>/<id>/state.json (mirrors the extension)');

  // ── list ───────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List all epics found under workspace state.root (default: docs/epics/)')
    .option('--json', 'Output raw JSON')
    .option('--status <status>', 'Filter by status (pending | in_progress | done | failed)')
    .action((opts: { json?: boolean; status?: string }, actionCmd: Command) => {
      const root = resolveWorkspaceRoot(actionCmd);
      const doc  = readYaml(root);
      let epics  = listEpics(root, doc);

      if (opts.status) {
        epics = epics.filter(e => e.status === opts.status);
      }

      if (opts.json) {
        console.log(JSON.stringify(epics, null, 2));
        return;
      }

      if (epics.length === 0) {
        console.log(chalk.dim('No epics found.'));
        console.log(chalk.dim(`  state.root = ${doc?.state ? (doc.state as Record<string, unknown>).root ?? 'docs/epics' : 'docs/epics'}`));
        return;
      }

      const table = new Table({
        head: [chalk.bold('Epic'), chalk.bold('Title'), chalk.bold('Progress'), chalk.bold('Status'), chalk.bold('Pipeline')],
        style: { head: [], border: [] },
      });

      for (const epic of epics) {
        const total = epic.stepDetails.length;
        const done  = epic.stepDetails.filter(s => s.status === 'done').length;
        const pct   = total ? Math.round((done / total) * 100) : 0;
        const stepLabel = total ? `${done}/${total} (${pct}%)` : '—';

        table.push([
          chalk.bold(epic.id),
          truncate(epic.title || chalk.dim('(untitled)'), 40),
          stepLabel,
          colorEpicStatus(epic.status),
          chalk.dim(epic.pipeline ?? '—'),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n${epics.length} epic${epics.length !== 1 ? 's' : ''}`));
    });

  // ── status / show ──────────────────────────────────────────────────────────
  cmd
    .command('status <id>')
    .alias('show')
    .description('Show full status of one epic — step pipeline, inputs, paths')
    .option('--json', 'Output raw EpicSummary JSON')
    .action((id: string, opts: { json?: boolean }, actionCmd: Command) => {
      const root  = resolveWorkspaceRoot(actionCmd);
      const doc   = readYaml(root);
      const epic  = loadEpic(root, doc, id);

      if (!epic) {
        const all = listEpics(root, doc).map(e => e.id);
        console.error(chalk.red(`Epic "${id}" not found.`));
        if (all.length > 0) {
          console.error(chalk.dim(`Available: ${all.join(', ')}`));
        }
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(epic, null, 2));
        return;
      }

      printEpicDetail(epic);
    });
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function printEpicDetail(epic: EpicSummary): void {
  console.log();
  console.log(chalk.bold(epic.id) + '  ' + colorEpicStatus(epic.status));
  if (epic.title)       { console.log(chalk.dim('  title:    ') + epic.title); }
  if (epic.description) { console.log(chalk.dim('  desc:     ') + epic.description); }
  if (epic.pipeline)    { console.log(chalk.dim('  pipeline: ') + epic.pipeline); }
  if (epic.createdAt)   { console.log(chalk.dim('  created:  ') + epic.createdAt); }
  console.log(chalk.dim('  state:    ') + chalk.dim(epic.statePath));
  console.log();

  if (epic.stepDetails.length > 0) {
    epic.stepDetails.forEach((s, i) => {
      const isCurrent = i === epic.currentStep && epic.status === 'in_progress';
      const marker    = isCurrent ? chalk.yellow('▶') : ' ';
      const status    = colorEpicStatus(s.status);
      const agent     = isCurrent ? chalk.bold(s.agent || '?') : chalk.dim(s.agent || '?');
      const finished  = s.finishedAt ? chalk.dim(` ✓ ${s.finishedAt.slice(0, 19).replace('T', ' ')}`) : '';
      console.log(`  ${marker} ${chalk.dim((i + 1) + '.')} ${agent.padEnd(20)} ${status}${finished}`);
    });
    console.log();
  }

  const inputKeys = Object.keys(epic.inputs);
  if (inputKeys.length > 0) {
    console.log(chalk.bold('Inputs:'));
    for (const key of inputKeys) {
      const val = epic.inputs[key];
      const display = val.length > 80 ? val.slice(0, 77) + '…' : val;
      console.log(`  ${chalk.dim(key + ':')} ${display}`);
    }
    console.log();
  }
}

function colorEpicStatus(status: EpicStatus): string {
  switch (status) {
    case 'done':        return chalk.green(status);
    case 'in_progress': return chalk.yellow(status.replace('_', ' '));
    case 'failed':      return chalk.red(status);
    case 'pending':
    default:            return chalk.dim(status);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
