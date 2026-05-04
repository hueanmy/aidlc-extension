import chalk from 'chalk';
import { EpicScanner } from '@aidlc/core';
import { readConfig } from '../cliConfig';

const GLYPH: Record<string, string> = {
  passed:               chalk.green('✅'),
  done:                 chalk.green('✅'),
  in_progress:          chalk.yellow('⏳'),
  'in-progress':        chalk.yellow('⏳'),
  in_review:            chalk.cyan('🔍'),
  awaiting_human_review: chalk.red('🔔'),
  rejected:             chalk.red('❌'),
  stale:                chalk.yellow('⚠️ '),
  failed_needs_human:   chalk.red('🔴'),
  blocked:              chalk.red('⛔'),
  pending:              chalk.dim('○'),
};

export function cmdStatus(workspaceRoot: string, epicKey: string, opts: { json?: boolean }): void {
  const config = readConfig(workspaceRoot);
  const scanner = new EpicScanner(workspaceRoot, config.epicsPath);

  let epic;
  try {
    epic = scanner.scanEpic(epicKey);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(epic, null, 2));
    return;
  }

  const progressPct = epic.progress;
  const bar = '█'.repeat(Math.round(progressPct / 10)) + '░'.repeat(10 - Math.round(progressPct / 10));
  console.log();
  console.log(chalk.bold(epic.key) + '  ' + chalk.white(epic.title));
  console.log(chalk.cyan(bar) + `  ${progressPct}%`);
  console.log();

  for (let i = 0; i < epic.phases.length; i++) {
    const phase = epic.phases[i];
    const isCurrent = i === epic.currentPhase;
    const glyph = GLYPH[phase.status] ?? chalk.dim('○');
    const nameStr = isCurrent ? chalk.bold.white(phase.name.padEnd(14)) : chalk.dim(phase.name.padEnd(14));
    const statusStr = chalk.dim(phase.status);
    const revStr = phase.revision !== undefined ? chalk.dim(` rev ${phase.revision}`) : '';
    const agentStr = chalk.dim(` [${phase.agentEmoji}]`);
    const flag = epic.hasAwaitingReview && phase.status === 'awaiting_human_review'
      ? chalk.red(' ← awaiting your review')
      : '';

    console.log(`  ${glyph}  ${nameStr}  ${statusStr}${revStr}${agentStr}${flag}`);
  }

  console.log();
  if (epic.hasAwaitingReview) {
    const p = epic.phases.find(ph => ph.status === 'awaiting_human_review');
    if (p) {
      console.log(chalk.yellow(`Run: aidlc review ${p.id} ${epic.key} --approve "LGTM"`));
    }
  }
}
