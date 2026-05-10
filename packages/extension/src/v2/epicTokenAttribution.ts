/**
 * Per-epic token usage attribution.
 *
 * Walks `~/.claude/projects/<encoded>/*.jsonl` once per workspace refresh
 * and attributes each assistant call to (epic, step) by matching:
 *   - `cwd` field == workspace root
 *   - `timestamp` ∈ [step.startedAt, next-step.startedAt) — last step
 *     extends to the run's `updatedAt`.
 *
 * Cache is keyed on the runs' state mtimes so a sidebar refresh that
 * doesn't change any run state file is essentially free.
 *
 * Cost calculation mirrors `tokenMonitor.ts` (and upstream
 * https://github.com/emtyty/claude-token-monitor).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

import type { RunState, StepRecord } from '@aidlc/core';

interface ModelPrice { in: number; out: number; cr: number; cw: number }

const PRICING: Record<string, ModelPrice> = {
  'claude-opus-4':     { in: 15.0, out: 75.0, cr: 1.50, cw: 18.75 },
  'claude-sonnet-4':   { in:  3.0, out: 15.0, cr: 0.30, cw:  3.75 },
  'claude-haiku-4':    { in:  1.0, out:  5.0, cr: 0.10, cw:  1.25 },
  'claude-3-5-sonnet': { in:  3.0, out: 15.0, cr: 0.30, cw:  3.75 },
  'claude-3-5-haiku':  { in:  0.8, out:  4.0, cr: 0.08, cw:  1.00 },
  'claude-3-opus':     { in: 15.0, out: 75.0, cr: 1.50, cw: 18.75 },
  'claude-3-haiku':    { in: 0.25, out: 1.25, cr: 0.03, cw:  0.30 },
};
const DEFAULT_PRICE: ModelPrice = { in: 3.0, out: 15.0, cr: 0.30, cw: 3.75 };

function modelPrice(model: string): ModelPrice {
  const m = (model || '').toLowerCase();
  for (const [prefix, price] of Object.entries(PRICING)) {
    if (m.includes(prefix)) return price;
  }
  return DEFAULT_PRICE;
}

export interface StepUsage {
  agent: string;
  startedAt: string | null;
  endedAt: string | null;
  cost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

export interface EpicUsage {
  total: { cost: number; totalTokens: number; calls: number };
  steps: StepUsage[];
  /** True when another run in this workspace overlaps any step window —
   * usage in the overlap is double-counted. */
  hasOverlap: boolean;
  /** ms timestamp when this snapshot was computed. */
  computedAt: number;
}

interface StepWindow {
  agent: string;
  startMs: number;
  endMs: number;
  startedAt: string | null;
  endedAt: string | null;
}

function emptyStep(agent: string, startedAt: string | null, endedAt: string | null): StepUsage {
  return {
    agent, startedAt, endedAt,
    cost: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0,
  };
}

/**
 * Convert run.steps[] into time windows. Last step extends to run.updatedAt.
 * Steps without `startedAt` get a zero-length window — they collect no usage.
 */
function buildStepWindows(run: RunState): StepWindow[] {
  const updatedMs = Date.parse(run.updatedAt);
  const windows: StepWindow[] = [];
  for (let i = 0; i < run.steps.length; i++) {
    const step = run.steps[i];
    const startedAt = stepStartedAt(step);
    if (!startedAt) {
      windows.push({ agent: step.agent, startMs: NaN, endMs: NaN, startedAt: null, endedAt: null });
      continue;
    }
    const startMs = Date.parse(startedAt);
    let endMs = updatedMs;
    let endedAt: string | null = run.updatedAt;
    for (let j = i + 1; j < run.steps.length; j++) {
      const nextStarted = stepStartedAt(run.steps[j]);
      if (nextStarted) {
        const nextMs = Date.parse(nextStarted);
        if (Number.isFinite(nextMs) && nextMs >= startMs) {
          endMs = nextMs;
          endedAt = nextStarted;
          break;
        }
      }
    }
    windows.push({ agent: step.agent, startMs, endMs, startedAt, endedAt });
  }
  return windows;
}

function stepStartedAt(step: StepRecord): string | null {
  // The schema doesn't always have `startedAt` set; the earliest history
  // entry's `at` is a reliable proxy (the first kind of activity on the step).
  if ((step as { startedAt?: string }).startedAt) {
    return (step as { startedAt: string }).startedAt;
  }
  const history = step.history;
  if (history && history.length > 0) {
    return history[0].at;
  }
  return null;
}

interface ComputeInput {
  workspaceRoot: string;
  run: RunState;
  /** Other runs in the same workspace — used to detect parallel overlap. */
  otherRuns: RunState[];
}

const cache = new Map<string, EpicUsage>();

function cacheKey(input: ComputeInput, mtimes: number[]): string {
  return `${input.workspaceRoot}::${input.run.runId}::${mtimes.join(':')}`;
}

/**
 * Get cached usage if available, else null. Sync — safe to call from
 * `listEpics` without making it async. Caller should later trigger
 * `computeWorkspaceEpicUsage` to populate cache for next refresh.
 */
export function getCachedEpicUsage(input: ComputeInput, mtimes: number[]): EpicUsage | null {
  return cache.get(cacheKey(input, mtimes)) ?? null;
}

/**
 * Compute (and cache) usage for every run in a workspace. Single jsonl
 * pass attributes records to whichever (run, step) window contains them.
 *
 * Returns a `Map<runId, EpicUsage>`.
 */
export async function computeWorkspaceEpicUsage(
  workspaceRoot: string,
  runs: RunState[],
): Promise<Map<string, EpicUsage>> {
  const result = new Map<string, EpicUsage>();
  if (runs.length === 0) return result;

  const normalized = path.resolve(workspaceRoot);

  // Per-run pre-computation: windows + accumulators.
  interface RunCtx {
    run: RunState;
    windows: StepWindow[];
    steps: StepUsage[];
    earliestMs: number;
    latestMs: number;
    /** Run-level fallback window for runs without per-step startedAt
     * timestamps. Used to compute epic-level total only (per-step stays 0). */
    fallbackStartMs: number;
    fallbackEndMs: number;
    fallbackTotal: { cost: number; tokens: number; calls: number };
  }
  const ctxByRun: RunCtx[] = runs.map((run) => {
    const windows = buildStepWindows(run);
    const steps = windows.map((w) =>
      emptyStep(w.agent, w.startedAt, w.endedAt),
    );
    const validStarts = windows.map((w) => w.startMs).filter(Number.isFinite);
    const validEnds = windows.map((w) => w.endMs).filter(Number.isFinite);
    const runStartMs = Date.parse(run.startedAt || '');
    const runEndMs = Date.parse(run.updatedAt || '');
    const runWindowValid = Number.isFinite(runStartMs) && Number.isFinite(runEndMs)
      && runEndMs >= runStartMs;
    // Earliest scan boundary covers BOTH per-step windows and the run-level
    // fallback so we never miss records that fall between collapsed step
    // windows but inside the run lifetime.
    const earliest = Math.min(
      ...(validStarts.length > 0 ? [Math.min(...validStarts)] : []),
      ...(runWindowValid ? [runStartMs] : []),
    );
    const latest = Math.max(
      ...(validEnds.length > 0 ? [Math.max(...validEnds)] : []),
      ...(runWindowValid ? [runEndMs] : []),
    );
    return {
      run,
      windows,
      steps,
      earliestMs: Number.isFinite(earliest) ? earliest : Infinity,
      latestMs: Number.isFinite(latest) ? latest : -Infinity,
      // Run-level window is ALWAYS used for the epic-level total — per-step
      // windows are a best-effort breakdown that may not cover the whole run
      // when steps lack `startedAt`.
      fallbackStartMs: runWindowValid ? runStartMs : NaN,
      fallbackEndMs: runWindowValid ? runEndMs : NaN,
      fallbackTotal: { cost: 0, tokens: 0, calls: 0 },
    };
  });

  const overallEarliest = Math.min(...ctxByRun.map((c) => c.earliestMs));
  if (!Number.isFinite(overallEarliest)) {
    // No usable timestamps — return empty results for every run.
    for (const ctx of ctxByRun) {
      result.set(ctx.run.runId, {
        total: { cost: 0, totalTokens: 0, calls: 0 },
        steps: ctx.steps,
        hasOverlap: false,
        computedAt: Date.now(),
      });
    }
    return result;
  }

  // Walk all jsonl files; skip files older than the earliest run start.
  const seen = new Set<string>();
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(projectsRoot)) {
    let projectDirs: fs.Dirent[];
    try {
      projectDirs = await fs.promises.readdir(projectsRoot, { withFileTypes: true });
    } catch {
      projectDirs = [];
    }
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) continue;
      const projectDir = path.join(projectsRoot, dirent.name);
      let files: string[];
      try {
        files = await fs.promises.readdir(projectDir);
      } catch { continue; }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(projectDir, name);
        let stat: fs.Stats;
        try { stat = await fs.promises.stat(file); } catch { continue; }
        if (stat.mtimeMs < overallEarliest) continue;
        await processJsonl(file, normalized, ctxByRun, seen);
      }
    }
  }

  // Detect overlap between run-level windows. Two epics in the same project
  // whose lifetimes overlap will double-count usage during the overlap.
  const overlapByRunId = new Map<string, boolean>();
  for (let i = 0; i < ctxByRun.length; i++) {
    const a = ctxByRun[i];
    if (!Number.isFinite(a.fallbackStartMs)) {
      overlapByRunId.set(a.run.runId, false);
      continue;
    }
    let overlap = false;
    for (let j = 0; j < ctxByRun.length; j++) {
      if (i === j) continue;
      const b = ctxByRun[j];
      if (!Number.isFinite(b.fallbackStartMs)) continue;
      if (a.fallbackStartMs < b.fallbackEndMs && b.fallbackStartMs < a.fallbackEndMs) {
        overlap = true;
        break;
      }
    }
    overlapByRunId.set(a.run.runId, overlap);
  }

  // Finalize per-run totals. The run-level window is the source of truth
  // for the epic total; per-step usage is a best-effort breakdown.
  for (const ctx of ctxByRun) {
    result.set(ctx.run.runId, {
      total: {
        cost: ctx.fallbackTotal.cost,
        totalTokens: ctx.fallbackTotal.tokens,
        calls: ctx.fallbackTotal.calls,
      },
      steps: ctx.steps,
      hasOverlap: overlapByRunId.get(ctx.run.runId) ?? false,
      computedAt: Date.now(),
    });
  }

  // Cache by mtimes of state.json files (caller passes them in via cacheKey).
  // We don't have direct access to mtimes here, so the caller holds the cache.
  return result;
}

interface RunCtxLike {
  run: RunState;
  windows: StepWindow[];
  steps: StepUsage[];
  earliestMs: number;
  latestMs: number;
  fallbackStartMs: number;
  fallbackEndMs: number;
  fallbackTotal: { cost: number; tokens: number; calls: number };
}

async function processJsonl(
  file: string,
  workspaceRoot: string,
  ctxByRun: RunCtxLike[],
  seen: Set<string>,
): Promise<void> {
  let stream: fs.ReadStream;
  try { stream = fs.createReadStream(file, { encoding: 'utf8' }); }
  catch { return; }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line || line[0] !== '{') continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'assistant') continue;

      const cwd = typeof entry.cwd === 'string' ? path.resolve(entry.cwd) : '';
      if (cwd !== workspaceRoot) continue;

      const msg = entry.message as Record<string, unknown> | undefined;
      if (!msg || !msg.usage) continue;
      const sessionId = (entry.sessionId as string) || '';
      const msgId = (msg.id as string) || '';
      const dedupKey = `${sessionId}\0${msgId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const tsRaw = entry.timestamp as string | undefined;
      const ts = tsRaw ? Date.parse(tsRaw) : NaN;
      if (!Number.isFinite(ts)) continue;

      const u = msg.usage as Record<string, unknown>;
      const inp = Number(u.input_tokens) || 0;
      const out = Number(u.output_tokens) || 0;
      const cr = Number(u.cache_read_input_tokens) || 0;
      const cw = Number(u.cache_creation_input_tokens) || 0;
      const model = (msg.model as string) || '';
      const p = modelPrice(model);
      const cost = inp * p.in / 1e6 + out * p.out / 1e6
                 + cr * p.cr / 1e6 + cw * p.cw / 1e6;

      // Attribute to every run that overlaps this timestamp. Two passes per
      // run: (1) run-level window populates the always-correct epic total,
      // (2) per-step window populates the best-effort breakdown when
      // `step.startedAt` is available. Overlapping runs double-count by
      // design (flagged via hasOverlap).
      for (const ctx of ctxByRun) {
        if (ts < ctx.earliestMs || ts >= ctx.latestMs) continue;
        // Run-level total — the source of truth for epic.tokenUsage.total.
        if (Number.isFinite(ctx.fallbackStartMs)
            && ts >= ctx.fallbackStartMs && ts < ctx.fallbackEndMs) {
          ctx.fallbackTotal.cost += cost;
          ctx.fallbackTotal.tokens += inp + out + cr + cw;
          ctx.fallbackTotal.calls += 1;
        }
        // Per-step breakdown — only when the step has a real startedAt.
        for (let i = 0; i < ctx.windows.length; i++) {
          const w = ctx.windows[i];
          if (!Number.isFinite(w.startMs)) continue;
          if (w.endMs <= w.startMs) continue;
          if (ts >= w.startMs && ts < w.endMs) {
            const s = ctx.steps[i];
            s.cost += cost;
            s.inputTokens += inp;
            s.outputTokens += out;
            s.cacheReadTokens += cr;
            s.cacheWriteTokens += cw;
            s.totalTokens += inp + out + cr + cw;
            s.calls += 1;
            break;
          }
        }
      }
    }
  } finally {
    rl.close();
    stream.close();
  }
}

/**
 * Caller-facing wrapper: caches the result across calls, recomputing only
 * when the run state mtimes change.
 *
 * Pass the resolved mtime list (parallel to `runs`) so the cache key is
 * stable across processes.
 */
export async function getOrComputeWorkspaceEpicUsage(
  workspaceRoot: string,
  runs: RunState[],
  mtimes: number[],
): Promise<Map<string, EpicUsage>> {
  const allCached = runs.length > 0 && runs.every((run) => {
    const key = `${path.resolve(workspaceRoot)}::${run.runId}::${mtimes.join(':')}`;
    return cache.has(key);
  });
  if (allCached) {
    const m = new Map<string, EpicUsage>();
    for (const run of runs) {
      const key = `${path.resolve(workspaceRoot)}::${run.runId}::${mtimes.join(':')}`;
      m.set(run.runId, cache.get(key)!);
    }
    return m;
  }

  const computed = await computeWorkspaceEpicUsage(workspaceRoot, runs);
  for (const [runId, usage] of computed) {
    const key = `${path.resolve(workspaceRoot)}::${runId}::${mtimes.join(':')}`;
    cache.set(key, usage);
  }
  return computed;
}

export function fmtCost(c: number): string {
  if (c >= 100) return `$${c.toFixed(0)}`;
  if (c >= 10) return `$${c.toFixed(1)}`;
  return `$${c.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
