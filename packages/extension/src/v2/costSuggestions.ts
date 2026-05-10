/**
 * Cost-saving suggestion engine — port of `analyze_suggestions` from
 * https://github.com/emtyty/claude-token-monitor (monitor.py:1981).
 *
 * Each rule scans the per-call records produced by `tokenRecords.ts` and
 * emits zero or more `Suggestion`s with severity, scope, evidence and a
 * concrete recommended action. The estimated USD savings are heuristic —
 * good enough to rank rules, not a guarantee.
 *
 * The 10 rules and their rationale ride on the upstream comments. Keep
 * thresholds in sync with monitor.py when the upstream changes.
 */
import { modelPrice } from './tokenPricing';
import {
  type CallRecord,
  decodeProject,
  shortenPath,
} from './tokenRecords';

export type Severity = 'high' | 'med' | 'low';

export interface Suggestion {
  rule: string;
  severity: Severity;
  scope: string;
  evidence: string;
  action: string;
  /** USD; 0 when the rule doesn't quantify a saving. */
  estSavings: number;
}

// Opus → Sonnet swap saves ~80% (uniform Sonnet/Opus price ratio of ~0.2
// across input, output, cache-read and cache-write).
const OPUS_TO_SONNET_SAVINGS = 0.80;

// ast-graph language coverage (https://github.com/emtyty/ast-graph).
const ASTGRAPH_EXTS = new Set([
  '.rs', '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.cs', '.java',
]);

const EXPLORE_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LSP',
  'NotebookRead', 'Agent', 'Task',
]);
const MUTATE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

function isOpus(model: string): boolean { return (model || '').toLowerCase().includes('opus'); }
function isSonnet(model: string): boolean { return (model || '').toLowerCase().includes('sonnet'); }
void isSonnet; // reserved for future rules

function projectLangSupported(records: CallRecord[]): boolean {
  const paths: string[] = [];
  for (const r of records) { paths.push(...r.readPaths); }
  if (paths.length === 0) { return false; }
  let supported = 0;
  for (const p of paths) {
    const dot = p.lastIndexOf('.');
    if (dot < 0) { continue; }
    if (ASTGRAPH_EXTS.has(p.slice(dot).toLowerCase())) { supported++; }
  }
  return supported / paths.length >= 0.5;
}

function shortScopeProject(project: string): string {
  return `project ${shortenPath(decodeProject(project))}`;
}

function fmtCost(c: number): string {
  if (c >= 1) { return `$${c.toFixed(2)}`; }
  if (c === 0) { return '$0'; }
  return `$${c.toFixed(4)}`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) { return `${(n / 1_000_000_000).toFixed(2)}B`; }
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(2)}M`; }
  if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}K`; }
  return String(Math.trunc(n));
}

function groupBy<T, K>(items: T[], key: (x: T) => K | null): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === null) { continue; }
    const arr = out.get(k);
    if (arr) { arr.push(it); } else { out.set(k, [it]); }
  }
  return out;
}

function rankSeverity(savings: number, hi: number, med: number): Severity {
  if (savings >= hi) { return 'high'; }
  if (savings >= med) { return 'med'; }
  return 'low';
}

// ── Rule 1: project where Opus dominates cost but avg output is small ──
function ruleOpusHeavyProject(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [project, recs] of groupBy(records, (r) => r.project)) {
    const totalCost = recs.reduce((s, r) => s + r.cost, 0);
    if (totalCost < 10) { continue; }
    const opusRecs = recs.filter((r) => isOpus(r.model));
    const opusCost = opusRecs.reduce((s, r) => s + r.cost, 0);
    if (!opusRecs.length || opusCost / totalCost < 0.6) { continue; }
    const opusOut = opusRecs.reduce((s, r) => s + r.usage.output_tokens, 0);
    const avgOutput = opusOut / opusRecs.length;
    if (avgOutput >= 500 || opusRecs.length < 20) { continue; }
    const savings = opusCost * OPUS_TO_SONNET_SAVINGS;
    out.push({
      rule: 'opus-heavy-project',
      severity: rankSeverity(savings, 50, 10),
      scope: shortScopeProject(project),
      evidence:
        `Opus ${fmtCost(opusCost)} / ${opusRecs.length} calls · ` +
        `avg output ${Math.trunc(avgOutput)} tok · ` +
        `Opus share ${Math.round(opusCost / totalCost * 100)}%`,
      action:
        "Set default model to Sonnet for this project " +
        "(routine edits don't need Opus reasoning).",
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 2: long all-Opus session with small outputs ───────────────────
function ruleOpusRoutineSession(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [sess, recs] of groupBy(records, (r) => r.sessionId || null)) {
    if (recs.length < 20) { continue; }
    if (!recs.every((r) => isOpus(r.model))) { continue; }
    const cost = recs.reduce((s, r) => s + r.cost, 0);
    if (cost < 5) { continue; }
    const totalOut = recs.reduce((s, r) => s + r.usage.output_tokens, 0);
    const avgOut = totalOut / recs.length;
    if (avgOut >= 500) { continue; }
    const projects = new Set(recs.map((r) => decodeProject(r.project)));
    const proj = projects.size === 1
      ? shortenPath([...projects][0])
      : 'multiple';
    const savings = cost * OPUS_TO_SONNET_SAVINGS;
    out.push({
      rule: 'opus-routine-session',
      severity: rankSeverity(savings, 30, 5),
      scope: `session ${sess.slice(0, 8)} (${proj})`,
      evidence:
        `${recs.length} calls · all Opus · ` +
        `avg output ${Math.trunc(avgOut)} tok · ${fmtCost(cost)}`,
      action: 'Rerun this kind of work on Sonnet — outputs were small, likely routine.',
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 3: spendy project with low cache hit rate ─────────────────────
function ruleLowCacheHit(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [project, recs] of groupBy(records, (r) => r.project)) {
    const cost = recs.reduce((s, r) => s + r.cost, 0);
    if (cost < 10) { continue; }
    const inp = recs.reduce((s, r) => s + r.usage.input_tokens, 0);
    const cr = recs.reduce((s, r) => s + r.usage.cache_read_input_tokens, 0);
    const cw = recs.reduce((s, r) => s + r.usage.cache_creation_input_tokens, 0);
    const denom = inp + cr + cw;
    if (denom === 0) { continue; }
    const hit = cr / denom;
    if (hit >= 0.4) { continue; }
    let savings = 0;
    for (const r of recs) {
      const p = modelPrice(r.model);
      const shiftable = r.usage.input_tokens * 0.5;
      savings += shiftable * (p.in - p.cr) / 1_000_000;
    }
    out.push({
      rule: 'low-cache-hit',
      severity: savings >= 5 ? 'med' : 'low',
      scope: shortScopeProject(project),
      evidence:
        `cache hit ${Math.round(hit * 100)}% · ${fmtCost(cost)} spent · many short sessions likely`,
      action:
        'Keep related work in one session; avoid frequent `/clear`. ' +
        'Each new session rebuilds the prefix cache.',
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 4: individual calls with huge raw input_tokens ────────────────
function ruleRawInputSpike(records: CallRecord[]): Suggestion[] {
  const spikes = records.filter((r) => r.usage.input_tokens >= 50_000);
  const out: Suggestion[] = [];
  for (const [project, recs] of groupBy(spikes, (r) => r.project)) {
    if (recs.length < 3) { continue; }
    const spikeTokens = recs.reduce((s, r) => s + r.usage.input_tokens, 0);
    let savings = 0;
    for (const r of recs) {
      const p = modelPrice(r.model);
      savings += r.usage.input_tokens * 0.6 * p.in / 1_000_000;
    }
    const maxRaw = Math.max(...recs.map((r) => r.usage.input_tokens));
    out.push({
      rule: 'raw-input-spike',
      severity: rankSeverity(savings, 20, 5),
      scope: shortScopeProject(project),
      evidence:
        `${recs.length} calls with >50K raw input · ` +
        `peak ${fmtNum(maxRaw)} · ${fmtNum(spikeTokens)} total`,
      action:
        'Pipe build/test/diff commands through `zero rewrite-exec -- …` ' +
        "so ZeroCTX compresses noisy stdout before it hits Claude's context.",
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 5: day cost > 3× median of last 30 active days ────────────────
function ruleDaySpike(records: CallRecord[]): Suggestion[] {
  const byDay = new Map<string, number>();
  for (const r of records) {
    const ts = Date.parse(r.timestamp);
    if (!Number.isFinite(ts)) { continue; }
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    byDay.set(key, (byDay.get(key) ?? 0) + r.cost);
  }
  if (byDay.size < 7) { return []; }
  const days = [...byDay.keys()].sort().slice(-30);
  const costs = days.map((d) => byDay.get(d) ?? 0).filter((c) => c > 0).sort((a, b) => a - b);
  if (costs.length === 0) { return []; }
  const median = costs[Math.floor(costs.length / 2)];
  const out: Suggestion[] = [];
  for (const d of days) {
    const c = byDay.get(d) ?? 0;
    if (median <= 0 || c < median * 3 || c < 20) { continue; }
    out.push({
      rule: 'day-spike',
      severity: c >= 100 ? 'high' : 'med',
      scope: `day ${d}`,
      evidence: `${fmtCost(c)} on ${d} · ${(c / median).toFixed(1)}× median (${fmtCost(median)})`,
      action:
        "Investigate this day's top session — likely a runaway context or " +
        'a long session that would have benefited from `/clear` + resume.',
      estSavings: 0,
    });
  }
  return out;
}

// ── Rule 6: many short sessions on same project same day ───────────────
function ruleSessionFragmentation(records: CallRecord[]): Suggestion[] {
  const buckets = new Map<string, Map<string, number>>();
  const cwCost = new Map<string, number>();
  for (const r of records) {
    if (!r.sessionId) { continue; }
    const ts = Date.parse(r.timestamp);
    if (!Number.isFinite(ts)) { continue; }
    const d = new Date(ts);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const key = `${r.project}\0${day}`;
    let sess = buckets.get(key);
    if (!sess) { sess = new Map(); buckets.set(key, sess); }
    sess.set(r.sessionId, (sess.get(r.sessionId) ?? 0) + 1);
    const p = modelPrice(r.model);
    const cost = r.usage.cache_creation_input_tokens * p.cw / 1_000_000;
    cwCost.set(key, (cwCost.get(key) ?? 0) + cost);
  }
  const out: Suggestion[] = [];
  for (const [key, sessCounts] of buckets) {
    const sep = key.indexOf('\0');
    const project = key.slice(0, sep);
    const day = key.slice(sep + 1);
    const shortSess = [...sessCounts.values()].filter((n) => n < 5).length;
    if (shortSess < 3) { continue; }
    if (sessCounts.size < 4) { continue; }
    const totalCw = cwCost.get(key) ?? 0;
    const savings = totalCw * shortSess / Math.max(1, sessCounts.size) * 0.5;
    out.push({
      rule: 'session-fragmentation',
      severity: savings >= 3 ? 'med' : 'low',
      scope: `${shortScopeProject(project)} on ${day}`,
      evidence:
        `${sessCounts.size} sessions (${shortSess} with <5 calls) · ` +
        `cache-write ${fmtCost(totalCw)}`,
      action:
        'Keep related work in a single session; starting fresh for every ' +
        'small task pays the cache-write cost again.',
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 7: session with cache_write ≫ cache_read ──────────────────────
function ruleCacheRebuild(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [sess, recs] of groupBy(records, (r) => r.sessionId || null)) {
    if (recs.length < 10) { continue; }
    const cost = recs.reduce((s, r) => s + r.cost, 0);
    if (cost < 5) { continue; }
    const cr = recs.reduce((s, r) => s + r.usage.cache_read_input_tokens, 0);
    const cw = recs.reduce((s, r) => s + r.usage.cache_creation_input_tokens, 0);
    if (cr === 0 || cw / cr < 0.2) { continue; }
    const excessCw = cw - cr * 0.05;
    if (excessCw <= 0) { continue; }
    const totalCostCw = recs.reduce(
      (s, r) => s + r.usage.cache_creation_input_tokens * modelPrice(r.model).cw / 1_000_000,
      0,
    );
    const rate = totalCostCw / Math.max(1, cw);
    const savings = excessCw * rate;
    const projects = new Set(recs.map((r) => decodeProject(r.project)));
    const proj = projects.size === 1 ? shortenPath([...projects][0]) : 'multiple';
    out.push({
      rule: 'cache-rebuild',
      severity: savings >= 5 ? 'med' : 'low',
      scope: `session ${sess.slice(0, 8)} (${proj})`,
      evidence:
        `${recs.length} calls · cache-write/read ratio ${(cw / cr).toFixed(2)} ` +
        `(healthy <0.1) · ${fmtCost(cost)}`,
      action:
        'Context thrashed — likely long session with growing history. ' +
        'Break into smaller tasks with `/clear` between unrelated goals.',
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 8: session with many Read calls on ast-graph languages ────────
function ruleManyReads(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [sess, recs] of groupBy(records, (r) => r.sessionId || null)) {
    const cost = recs.reduce((s, r) => s + r.cost, 0);
    if (cost < 5) { continue; }
    const allTools = recs.flatMap((r) => r.tools);
    if (allTools.length === 0) { continue; }
    const reads = allTools.filter((t) => t === 'Read').length;
    if (reads < 30) { continue; }
    if (reads / allTools.length < 0.4) { continue; }
    if (!projectLangSupported(recs)) { continue; }
    const inputCost = recs.reduce(
      (s, r) =>
        s +
        (r.usage.input_tokens + r.usage.cache_read_input_tokens) *
          modelPrice(r.model).cr / 1_000_000,
      0,
    );
    const savings = inputCost * 0.4;
    const projects = new Set(recs.map((r) => decodeProject(r.project)));
    const proj = projects.size === 1 ? shortenPath([...projects][0]) : 'multiple';
    out.push({
      rule: 'many-reads',
      severity: savings >= 3 ? 'med' : 'low',
      scope: `session ${sess.slice(0, 8)} (${proj})`,
      evidence:
        `${reads} Read calls (${Math.floor(reads * 100 / allTools.length)}% of tool use) · ` +
        `${fmtCost(cost)}`,
      action:
        'Use ast-graph (`scan` + `symbol`/`blast-radius`) for structural ' +
        'lookups — one query replaces many whole-file Reads.',
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 9: Opus session dominated by exploration tools ────────────────
function ruleExploreOnOpus(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [sess, recs] of groupBy(records, (r) => r.sessionId || null)) {
    if (recs.length < 10) { continue; }
    const opusRecs = recs.filter((r) => isOpus(r.model));
    if (opusRecs.length / recs.length < 0.7) { continue; }
    const cost = recs.reduce((s, r) => s + r.cost, 0);
    if (cost < 5) { continue; }
    const allTools = recs.flatMap((r) => r.tools);
    if (allTools.length === 0) { continue; }
    const explore = allTools.filter((t) => EXPLORE_TOOLS.has(t)).length;
    const mutate = allTools.filter((t) => MUTATE_TOOLS.has(t)).length;
    if (explore + mutate === 0) { continue; }
    if (explore / (explore + mutate) < 0.85) { continue; }
    const opusCost = opusRecs.reduce((s, r) => s + r.cost, 0);
    const savings = opusCost * OPUS_TO_SONNET_SAVINGS;
    const projects = new Set(recs.map((r) => decodeProject(r.project)));
    const proj = projects.size === 1 ? shortenPath([...projects][0]) : 'multiple';
    const langOk = projectLangSupported(recs);
    let action =
      'Exploration on Opus is expensive — plan/analyze on Sonnet (or Haiku), ' +
      'switch to Opus only for synthesis/implementation.';
    if (langOk) {
      action += ' Pair with ast-graph for structural queries instead of Read-spray.';
    }
    out.push({
      rule: 'explore-on-opus',
      severity: rankSeverity(savings, 20, 5),
      scope: `session ${sess.slice(0, 8)} (${proj})`,
      evidence:
        `${recs.length} calls · ${opusRecs.length} Opus · ` +
        `${Math.floor(explore * 100 / (explore + mutate))}% explore tools · ${fmtCost(cost)}`,
      action,
      estSavings: savings,
    });
  }
  return out;
}

// ── Rule 10: plan-mode session on Opus ─────────────────────────────────
function rulePlanModeOpus(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [sess, recs] of groupBy(records, (r) => r.sessionId || null)) {
    const tools = recs.flatMap((r) => r.tools);
    const planTurns = tools.filter((t) => t === 'ExitPlanMode').length;
    if (planTurns === 0) { continue; }
    const opusRecs = recs.filter((r) => isOpus(r.model));
    if (!opusRecs.length || opusRecs.length / recs.length < 0.7) { continue; }
    const cost = recs.reduce((s, r) => s + r.cost, 0);
    if (cost < 3) { continue; }
    const opusCost = opusRecs.reduce((s, r) => s + r.cost, 0);
    const savings = opusCost * 0.4;
    const projects = new Set(recs.map((r) => decodeProject(r.project)));
    const proj = projects.size === 1 ? shortenPath([...projects][0]) : 'multiple';
    const langOk = projectLangSupported(recs);
    let action =
      'Plan mode on Opus — draft the plan on Sonnet/Haiku, switch to Opus ' +
      'only for the implementation turns.';
    if (langOk) {
      action +=
        ' Feed ast-graph `symbol` / `hotspots` / `blast-radius` / `dead-code` ' +
        'output into the plan instead of letting Claude Read/Grep the codebase ' +
        'to discover structure.';
    }
    out.push({
      rule: 'plan-mode-opus',
      severity: rankSeverity(savings, 20, 5),
      scope: `session ${sess.slice(0, 8)} (${proj})`,
      evidence:
        `${recs.length} calls · ${planTurns} plan-mode turn(s) · ` +
        `${opusRecs.length} Opus · ${fmtCost(cost)}`,
      action,
      estSavings: savings,
    });
  }
  return out;
}

const RULES: Array<(r: CallRecord[]) => Suggestion[]> = [
  ruleOpusHeavyProject,
  ruleOpusRoutineSession,
  ruleLowCacheHit,
  ruleRawInputSpike,
  ruleDaySpike,
  ruleSessionFragmentation,
  ruleCacheRebuild,
  ruleManyReads,
  ruleExploreOnOpus,
  rulePlanModeOpus,
];

const SEV_ORDER: Record<Severity, number> = { high: 0, med: 1, low: 2 };

export function analyzeSuggestions(records: CallRecord[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const rule of RULES) { out.push(...rule(records)); }
  out.sort((a, b) => {
    const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    if (s !== 0) { return s; }
    return b.estSavings - a.estSavings;
  });
  return out;
}
