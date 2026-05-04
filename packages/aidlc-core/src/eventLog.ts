import * as fs from 'fs';
import * as path from 'path';

export type EventActor = 'cli' | 'vscode' | 'mcp';

export interface AidlcEvent {
  ts: string;
  actor: EventActor;
  phase: string;
  from: string;
  to: string;
  by: string;
  reason?: string;
}

function logPath(epicFolderPath: string): string {
  return path.join(epicFolderPath, '.aidlc', 'events.jsonl');
}

/**
 * Append one event to the epic's event log.
 * Uses fs.appendFileSync (O_APPEND) which is safe for concurrent writers on
 * POSIX — each write is atomic up to PIPE_BUF (~4KB, well above one JSON line).
 */
export function appendEvent(epicFolderPath: string, event: AidlcEvent): void {
  const p = logPath(epicFolderPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(event) + '\n', 'utf8');
}

/** Read all events for an epic, oldest first. Returns [] if log doesn't exist. */
export function readEvents(epicFolderPath: string): AidlcEvent[] {
  const p = logPath(epicFolderPath);
  if (!fs.existsSync(p)) { return []; }
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as AidlcEvent; }
      catch { return null; }
    })
    .filter((e): e is AidlcEvent => e !== null);
}

/** Read events written after `afterTs` (ISO string). */
export function readEventsSince(epicFolderPath: string, afterTs: string): AidlcEvent[] {
  return readEvents(epicFolderPath).filter(e => e.ts > afterTs);
}

export { logPath as eventLogPath };
