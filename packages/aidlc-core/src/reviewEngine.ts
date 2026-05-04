import * as fs from 'fs';
import * as path from 'path';
import { PhaseReview, PhaseStatusValue } from './epicScanner';
import { PHASE_ORDER, PHASE_ID_SET } from './phases';
import { atomicWrite } from './atomicWrite';
import { appendEvent, EventActor } from './eventLog';

export interface ApproveOptions {
  phaseId: string;
  epicFolderPath: string;
  reviewer: string;
  comment?: string;
  actor?: EventActor;
}

export interface RejectOptions {
  fromPhaseId: string;
  rejectTo: string;
  epicFolderPath: string;
  reviewer: string;
  reason: string;
  actor?: EventActor;
}

/**
 * Flip an awaiting_human_review phase to passed.
 * Writes atomically and appends an event to the epic's event log.
 */
export function approvePhase(opts: ApproveOptions): Record<string, unknown> {
  const { phaseId, epicFolderPath, reviewer, comment, actor = 'cli' } = opts;
  const statusPath = phaseStatusPath(epicFolderPath, phaseId);
  const current = readPhaseStatus(statusPath) ?? {};
  const from = (current.status as string | undefined) ?? 'unknown';

  const verdict: PhaseReview = {
    decision: 'pass',
    reviewer,
    at: new Date().toISOString(),
    reason: comment?.trim() || 'Approved via aidlc.',
  };
  const next = {
    ...current,
    status: 'passed',
    updated_at: new Date().toISOString(),
    last_review: verdict,
  };

  atomicWrite(statusPath, JSON.stringify(next, null, 2) + '\n');

  appendEvent(epicFolderPath, {
    ts: new Date().toISOString(),
    actor,
    phase: phaseId,
    from,
    to: 'passed',
    by: reviewer,
    reason: verdict.reason,
  });

  return next;
}

/**
 * Cascade-reject a phase.
 *
 * Rules (mirror of cf-sdlc-pipeline orchestrator.ts cascadeReject):
 *  - target phase (rejectTo): archive current artifacts, bump revision, write rejected.
 *  - intermediate phases (strictly between target and current): passed/done → stale.
 *  - current phase (fromPhaseId): untouched.
 *
 * All writes are atomic. One event is appended per affected phase.
 */
export function rejectPhase(opts: RejectOptions): void {
  const { fromPhaseId, rejectTo, epicFolderPath, reviewer, reason, actor = 'cli' } = opts;

  if (!PHASE_ID_SET.has(fromPhaseId)) {
    throw new Error(`Unknown phase: ${fromPhaseId}`);
  }
  if (!PHASE_ID_SET.has(rejectTo)) {
    throw new Error(`Unknown target phase: ${rejectTo}`);
  }
  if (reason.trim().length < 5) {
    throw new Error('Rejection reason must be at least 5 characters.');
  }

  const fromIdx = PHASE_ORDER.indexOf(fromPhaseId as typeof PHASE_ORDER[number]);
  const toIdx   = PHASE_ORDER.indexOf(rejectTo   as typeof PHASE_ORDER[number]);

  if (toIdx >= fromIdx) {
    throw new Error(`Cannot reject forward: ${fromPhaseId} → ${rejectTo}`);
  }

  const verdict: PhaseReview = {
    decision: 'reject',
    reviewer,
    at: new Date().toISOString(),
    reject_to: rejectTo,
    reason: reason.trim(),
  };

  // Target phase: archive + revision bump + rejected
  const targetPath = phaseStatusPath(epicFolderPath, rejectTo);
  const targetCurrent = readPhaseStatus(targetPath);
  const targetRevision = (targetCurrent?.revision as number | undefined) ?? 0;
  const targetFrom = (targetCurrent?.status as string | undefined) ?? 'unknown';

  if (targetRevision > 0) {
    archivePhaseDir(epicFolderPath, rejectTo, targetRevision);
  }

  atomicWrite(
    targetPath,
    JSON.stringify({
      phase: rejectTo,
      status: 'rejected',
      revision: targetRevision + 1,
      updated_at: new Date().toISOString(),
      last_review: verdict,
    }, null, 2) + '\n',
  );

  appendEvent(epicFolderPath, {
    ts: new Date().toISOString(),
    actor,
    phase: rejectTo,
    from: targetFrom,
    to: 'rejected',
    by: reviewer,
    reason: reason.trim(),
  });

  // Intermediate phases: passed/done → stale
  for (let i = toIdx + 1; i < fromIdx; i++) {
    const mid = PHASE_ORDER[i];
    const midPath = phaseStatusPath(epicFolderPath, mid);
    const midState = readPhaseStatus(midPath);
    if (midState?.status === 'passed' || midState?.status === 'done') {
      atomicWrite(
        midPath,
        JSON.stringify({
          ...midState,
          status: 'stale',
          updated_at: new Date().toISOString(),
        }, null, 2) + '\n',
      );

      appendEvent(epicFolderPath, {
        ts: new Date().toISOString(),
        actor,
        phase: mid,
        from: midState.status as string,
        to: 'stale',
        by: reviewer,
        reason: `cascade from ${fromPhaseId} → ${rejectTo}`,
      });
    }
  }
}

export interface SetPhaseStatusOptions {
  epicFolderPath: string;
  phaseId: string;
  status: PhaseStatusValue;
  by: string;
  actor?: EventActor;
  reason?: string;
}

/**
 * Directly set any phase to any valid status.
 * No cascade — only the named phase is touched.
 * Writes atomically and appends an event to the log.
 */
export function setPhaseStatus(opts: SetPhaseStatusOptions): void {
  const { epicFolderPath, phaseId, status, by, actor = 'cli', reason } = opts;

  if (!PHASE_ID_SET.has(phaseId)) {
    throw new Error(`Unknown phase: ${phaseId}`);
  }

  const statusPath = phaseStatusPath(epicFolderPath, phaseId);
  const current = readPhaseStatus(statusPath) ?? {};
  const from = (current.status as string | undefined) ?? 'none';

  const next = {
    ...current,
    phase: phaseId,
    status,
    updated_at: new Date().toISOString(),
    revision: typeof current.revision === 'number' ? current.revision : 1,
  };

  atomicWrite(statusPath, JSON.stringify(next, null, 2) + '\n');

  appendEvent(epicFolderPath, {
    ts: new Date().toISOString(),
    actor,
    phase: phaseId,
    from,
    to: status,
    by,
    reason,
  });
}

export function phaseStatusPath(epicFolderPath: string, phaseId: string): string {
  return path.join(epicFolderPath, 'phases', phaseId, 'status.json');
}

export function readPhaseStatus(statusPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(statusPath)) { return null; }
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function archivePhaseDir(epicFolderPath: string, phaseId: string, revision: number): void {
  const dir = path.join(epicFolderPath, 'phases', phaseId);
  if (!fs.existsSync(dir)) { return; }
  const archiveDir = path.join(dir, 'archive', `revision-${revision}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'archive') { continue; }
    const src = path.join(dir, entry);
    const dst = path.join(archiveDir, entry);
    try {
      fs.renameSync(src, dst);
    } catch {
      /* best-effort — don't abort the whole cascade on a locked file */
    }
  }
}
