/**
 * Filesystem persistence for {@link RunState}.
 *
 * Layout:
 *   <workspace>/.aidlc/runs/<runId>.json
 *
 * The store is intentionally dumb — it reads/writes JSON, validates the
 * schemaVersion, and that's it. All state-machine logic lives in
 * {@link PipelineRunner}.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { RunState } from './RunState';

const RUNS_DIR = path.join('.aidlc', 'runs');

/**
 * Filesystem-safe id check — same rules as preset ids: lowercase letters,
 * digits, dashes, underscores, plus a leading letter or digit. Epic keys
 * like `DRM-2100` need uppercase, so we widen to `[A-Za-z0-9._-]`.
 */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class RunStateStore {
  /** Resolve the runs directory for a given workspace root. */
  static dir(workspaceRoot: string): string {
    return path.join(workspaceRoot, RUNS_DIR);
  }

  /** Resolve the JSON file path for a specific run. */
  static file(workspaceRoot: string, runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error(`Invalid runId "${runId}" — must match ${RUN_ID_PATTERN}`);
    }
    return path.join(RunStateStore.dir(workspaceRoot), `${runId}.json`);
  }

  /** List all runs (sorted by updatedAt desc). Tolerates missing dir. */
  static list(workspaceRoot: string): RunState[] {
    const dir = RunStateStore.dir(workspaceRoot);
    if (!fs.existsSync(dir)) { return []; }
    const out: RunState[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) { continue; }
      try {
        const raw = fs.readFileSync(path.join(dir, entry), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schemaVersion === 1 && typeof parsed.runId === 'string') {
          out.push(parsed as RunState);
        }
      } catch { /* skip corrupt run files — surface as warning when picked */ }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  static load(workspaceRoot: string, runId: string): RunState | null {
    const p = RunStateStore.file(workspaceRoot, runId);
    if (!fs.existsSync(p)) { return null; }
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && parsed.schemaVersion === 1) { return parsed as RunState; }
      return null;
    } catch { return null; }
  }

  static save(workspaceRoot: string, state: RunState): void {
    const dir = RunStateStore.dir(workspaceRoot);
    fs.mkdirSync(dir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(
      RunStateStore.file(workspaceRoot, state.runId),
      JSON.stringify(state, null, 2),
      'utf8',
    );
  }

  static delete(workspaceRoot: string, runId: string): void {
    const p = RunStateStore.file(workspaceRoot, runId);
    if (fs.existsSync(p)) { fs.unlinkSync(p); }
  }
}

export { RUN_ID_PATTERN };
