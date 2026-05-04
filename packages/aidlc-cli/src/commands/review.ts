import chalk from 'chalk';
import ora from 'ora';
import { EpicScanner, approvePhase, rejectPhase, REJECT_TO, PHASE_ID_SET } from '@aidlc/core';
import { readConfig } from '../cliConfig';
import * as os from 'os';

export async function cmdReview(
  workspaceRoot: string,
  phaseId: string,
  epicKey: string,
  opts: { approve?: string; reject?: string; rejectTo?: string; reviewer?: string },
): Promise<void> {
  if (!PHASE_ID_SET.has(phaseId)) {
    console.error(chalk.red(`Unknown phase: ${phaseId}`));
    process.exit(1);
  }

  const config = readConfig(workspaceRoot);
  const scanner = new EpicScanner(workspaceRoot, config.epicsPath);
  let epic;
  try {
    epic = scanner.scanEpic(epicKey);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const phase = epic.phases.find(p => p.id === phaseId);
  if (!phase) {
    console.error(chalk.red(`Phase "${phaseId}" is not enabled for epic ${epicKey}.`));
    process.exit(1);
  }

  const reviewer = opts.reviewer ?? os.userInfo().username;

  if (opts.approve !== undefined) {
    // Commander sets opts.approve = true (boolean) when --approve is used with no value.
    const comment = typeof opts.approve === 'string' ? opts.approve : '';
    const spinner = ora(`Approving ${epicKey} / ${phaseId}…`).start();
    try {
      approvePhase({ phaseId, epicFolderPath: epic.folderPath, reviewer, comment });
      spinner.succeed(chalk.green(`Approved ${epicKey} / ${phaseId}`));
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  if (opts.reject !== undefined) {
    const allowedTargets = REJECT_TO[phaseId];
    if (!allowedTargets || allowedTargets.length === 0) {
      console.error(chalk.red(`Phase "${phaseId}" has no upstream phases to reject to.`));
      process.exit(1);
    }

    const rejectTo = opts.rejectTo ?? allowedTargets[allowedTargets.length - 1];
    if (!allowedTargets.includes(rejectTo)) {
      console.error(chalk.red(`Cannot reject ${phaseId} to "${rejectTo}". Allowed: ${allowedTargets.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora(`Rejecting ${epicKey} / ${phaseId} → ${rejectTo}…`).start();
    try {
      rejectPhase({ fromPhaseId: phaseId, rejectTo, epicFolderPath: epic.folderPath, reviewer, reason: opts.reject });
      spinner.succeed(chalk.red(`Rejected ${epicKey} / ${phaseId}`) + chalk.dim(` → ${rejectTo}`));
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  // No action — print current state
  console.log();
  console.log(chalk.bold(`${epicKey} / ${phaseId}`) + '  ' + chalk.dim(`status: ${phase.status}`));
  if (phase.status === 'awaiting_human_review') {
    const allowed = REJECT_TO[phaseId] ?? [];
    console.log(chalk.yellow('\nThis phase is awaiting your review. Options:'));
    console.log(`  Approve:  ${chalk.cyan(`aidlc review ${phaseId} ${epicKey} --approve "comment"`)}`);
    if (allowed.length > 0) {
      console.log(`  Reject:   ${chalk.cyan(`aidlc review ${phaseId} ${epicKey} --reject "reason" --reject-to ${allowed[0]}`)}`);
      console.log(chalk.dim(`  Allowed reject targets: ${allowed.join(', ')}`));
    }
  } else {
    console.log(chalk.dim(`  Phase is not awaiting review (status: ${phase.status}).`));
  }
  console.log();
}
