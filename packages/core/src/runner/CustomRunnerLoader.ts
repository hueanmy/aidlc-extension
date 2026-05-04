/**
 * Loads a user-supplied custom runner from a `runner_path` (relative to the
 * workspace root) and validates it satisfies the AidlcRunner contract before
 * returning it for use.
 *
 * Phase 1: JS only (`.js` / `.cjs`). TypeScript runner support (`.ts` via
 * ts-node / esbuild on the fly) is deferred to v1.1 per the design decisions
 * in the v2 spec.
 *
 * Security note: custom runners run inside the extension host process —
 * they're effectively eval'd code. Phase 1 trusts the user's local files;
 * the v2 spec marks sandbox (vm2 / worker_threads) as future work.
 */

import * as path from 'path';
import * as fs from 'fs';

import type { AidlcRunner } from './types';
import { RunnerValidationError } from './types';

export class CustomRunnerLoader {
  constructor(private readonly workspaceRoot: string) {}

  /** Resolve a workspace-relative or absolute path to absolute. */
  absolutePath(runnerPath: string): string {
    return path.isAbsolute(runnerPath)
      ? runnerPath
      : path.resolve(this.workspaceRoot, runnerPath);
  }

  /**
   * Load + validate a runner module. Throws RunnerValidationError on any
   * structural problem (missing file, bad export, wrong signature). The
   * extension surfaces these errors to the user before any agent invocation.
   */
  load(runnerPath: string): AidlcRunner {
    const abs = this.absolutePath(runnerPath);

    if (!fs.existsSync(abs)) {
      throw new RunnerValidationError(`File does not exist: ${abs}`, runnerPath);
    }

    const ext = path.extname(abs).toLowerCase();
    if (ext !== '.js' && ext !== '.cjs' && ext !== '.mjs') {
      throw new RunnerValidationError(
        `Only .js / .cjs / .mjs runners are supported in v1 (got ${ext}). TypeScript runners are planned for v1.1.`,
        runnerPath,
      );
    }

    // Bust require cache so re-loading after edits picks up changes.
    // (.mjs uses dynamic import which has its own cache; we accept that for now.)
    if (ext !== '.mjs') {
      try { delete require.cache[require.resolve(abs)]; } catch { /* ignore */ }
    }

    let mod: unknown;
    try {
      mod = require(abs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RunnerValidationError(`Failed to require: ${msg}`, runnerPath);
    }

    return validateRunnerExport(mod, runnerPath);
  }
}

/**
 * Accepts either:
 *   - module.exports = async function run(ctx) { ... }     (function shorthand)
 *   - module.exports = { run: async (ctx) => { ... } }     (object shorthand)
 *   - module.exports = { default: async function(ctx) {...} }  (ES default)
 *
 * Returns a normalized AidlcRunner. Throws RunnerValidationError otherwise.
 */
export function validateRunnerExport(mod: unknown, runnerPath: string): AidlcRunner {
  if (mod === null || mod === undefined) {
    throw new RunnerValidationError('Module exports nothing', runnerPath);
  }

  // Function shorthand: `module.exports = async function(ctx) { ... }`
  if (typeof mod === 'function') {
    return { run: mod as AidlcRunner['run'] };
  }

  // Object shape
  if (typeof mod === 'object') {
    const o = mod as Record<string, unknown>;
    if (typeof o.run === 'function') {
      return { run: o.run as AidlcRunner['run'] };
    }
    if (typeof o.default === 'function') {
      return { run: o.default as AidlcRunner['run'] };
    }
    if (o.default && typeof (o.default as Record<string, unknown>).run === 'function') {
      return { run: (o.default as { run: AidlcRunner['run'] }).run };
    }
  }

  throw new RunnerValidationError(
    'Module must export a `run(ctx)` async function (or `{ run }` / `{ default: { run } }`)',
    runnerPath,
  );
}
