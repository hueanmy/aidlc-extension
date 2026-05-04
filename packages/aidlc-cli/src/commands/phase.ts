import chalk from 'chalk';
import * as os from 'os';
import { EpicScanner, setPhaseStatus, PHASE_ID_SET, type PhaseStatusValue } from '@aidlc/core';
import { readConfig } from '../cliConfig';

const VALID_STATUSES: PhaseStatusValue[] = [
  'pending', 'in_progress', 'in_review', 'awaiting_human_review',
  'passed', 'done', 'rejected', 'stale', 'failed_needs_human', 'blocked',
];

function resolveEpic(workspaceRoot: string, epicKey: string) {
  const config = readConfig(workspaceRoot);
  const scanner = new EpicScanner(workspaceRoot, config.epicsPath);
  try {
    return scanner.scanEpic(epicKey);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

function apply(
  workspaceRoot: string,
  epicKey: string,
  phaseId: string,
  status: PhaseStatusValue,
  opts: { reviewer?: string; reason?: string },
): void {
  if (!PHASE_ID_SET.has(phaseId)) {
    console.error(chalk.red(`Unknown phase: ${phaseId}`));
    console.error(chalk.dim(`Valid phases: ${[...PHASE_ID_SET].join(', ')}`));
    process.exit(1);
  }

  const epic = resolveEpic(workspaceRoot, epicKey);
  const by = opts.reviewer ?? os.userInfo().username;

  try {
    setPhaseStatus({
      epicFolderPath: epic.folderPath,
      phaseId,
      status,
      by,
      actor: 'cli',
      reason: opts.reason,
    });
    console.log(
      chalk.green('✔') +
      `  ${chalk.bold(epicKey)} / ${chalk.bold(phaseId)} → ${chalk.cyan(status)}` +
      chalk.dim(`  [${by}]`),
    );
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

export function cmdPhaseSet(
  workspaceRoot: string,
  epicKey: string,
  phaseId: string,
  status: string,
  opts: { reviewer?: string; reason?: string },
): void {
  if (!VALID_STATUSES.includes(status as PhaseStatusValue)) {
    console.error(chalk.red(`Invalid status: ${status}`));
    console.error(chalk.dim(`Valid statuses: ${VALID_STATUSES.join(', ')}`));
    process.exit(1);
  }
  apply(workspaceRoot, epicKey, phaseId, status as PhaseStatusValue, opts);
}

export function cmdPhaseStart(
  workspaceRoot: string,
  epicKey: string,
  phaseId: string,
  opts: { reviewer?: string },
): void {
  apply(workspaceRoot, epicKey, phaseId, 'in_progress', {
    ...opts,
    reason: 'started via aidlc phase start',
  });
}

export function cmdPhaseDone(
  workspaceRoot: string,
  epicKey: string,
  phaseId: string,
  opts: { reviewer?: string },
): void {
  apply(workspaceRoot, epicKey, phaseId, 'passed', {
    ...opts,
    reason: 'manually marked done via aidlc phase done',
  });
}

export function cmdPhaseReset(
  workspaceRoot: string,
  epicKey: string,
  phaseId: string,
  opts: { reviewer?: string },
): void {
  apply(workspaceRoot, epicKey, phaseId, 'pending', {
    ...opts,
    reason: 'reset via aidlc phase reset',
  });
}

export function cmdPhaseSkip(
  workspaceRoot: string,
  epicKey: string,
  phaseId: string,
  opts: { reviewer?: string },
): void {
  apply(workspaceRoot, epicKey, phaseId, 'passed', {
    ...opts,
    reason: 'skipped via aidlc phase skip',
  });
}
