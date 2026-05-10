/**
 * Aggregations for the Token Usage Report webview.
 *
 * Mirrors the report rendered by upstream
 * https://github.com/emtyty/claude-token-monitor `monitor.py report`:
 *   - Overview totals (sessions, projects, calls, cache hit, cost)
 *   - By-model table
 *   - Daily breakdown (last 30 active days)
 *   - Top-N projects
 *   - 7×24 cost heatmap (day-of-week × hour, local time)
 *   - Efficiency suggestions (already in costSuggestions.ts)
 *
 * All numbers are derived from the per-call records yielded by
 * tokenRecords.ts so a single full scan supplies every section.
 */
import {
  type CallRecord,
  decodeProject,
  shortenPath,
} from './tokenRecords';
import { analyzeSuggestions, type Suggestion } from './costSuggestions';

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  calls: number;
}

export interface OverviewStats {
  sessions: number;
  projects: number;
  calls: number;
  cacheHitRate: number;
  /** Sum of input + output + cache_read + cache_write across all records.
   * Primary number for subscription users — the $ is API-equivalent only. */
  totalTokens: number;
  /** API-equivalent cost (USD). Subscription users don't pay this. */
  totalCost: number;
}

export interface ModelRow extends UsageTotals {
  model: string;
  hitRate: number;
  costShare: number;
}

export interface DailyRow extends UsageTotals {
  date: string;
}

export interface ProjectRow extends UsageTotals {
  project: string;
  /** Decoded + shortened (~/Documents/...) for display. */
  displayPath: string;
  /** ISO date of the most recent call. */
  lastActive: string;
  costShare: number;
}

export interface HeatmapRow {
  /** 0 = Mon, 6 = Sun. */
  dow: number;
  label: string;
  /** 24 cells, dow × hour cost (USD). */
  hours: number[];
  rowTotal: number;
}

export interface TokenReport {
  generatedAt: string;
  windowDays: number;
  overview: OverviewStats;
  byModel: ModelRow[];
  daily: DailyRow[];
  topProjects: ProjectRow[];
  heatmap: HeatmapRow[];
  /** Peak per-cell cost across the heatmap — UI uses this to scale colour. */
  heatmapPeak: number;
  suggestions: Suggestion[];
  /** Total estimated savings from all suggestions, USD. */
  estPotentialSavings: number;
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };
}

function addRecord(t: UsageTotals, r: CallRecord): void {
  t.input += r.usage.input_tokens;
  t.output += r.usage.output_tokens;
  t.cacheRead += r.usage.cache_read_input_tokens;
  t.cacheWrite += r.usage.cache_creation_input_tokens;
  t.cost += r.cost;
  t.calls += 1;
}

function hitRate(t: UsageTotals): number {
  const denom = t.input + t.cacheRead + t.cacheWrite;
  return denom > 0 ? t.cacheRead / denom : 0;
}

export function buildReport(records: CallRecord[], windowDays: number): TokenReport {
  const total = emptyTotals();
  const sessions = new Set<string>();
  const projects = new Set<string>();
  for (const r of records) {
    addRecord(total, r);
    if (r.sessionId) { sessions.add(r.sessionId); }
    if (r.project) { projects.add(r.project); }
  }
  const heat = heatmap(records);
  const suggestions = analyzeSuggestions(records);

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    overview: {
      sessions: sessions.size,
      projects: projects.size,
      calls: total.calls,
      cacheHitRate: hitRate(total),
      totalTokens: total.input + total.output + total.cacheRead + total.cacheWrite,
      totalCost: total.cost,
    },
    byModel: byModel(records, total.cost),
    daily: daily(records, 30),
    topProjects: topProjects(records, total.cost, 15),
    heatmap: heat.rows,
    heatmapPeak: heat.peak,
    suggestions,
    estPotentialSavings: suggestions.reduce((s, x) => s + x.estSavings, 0),
  };
}

// ── By model ──────────────────────────────────────────────────────────────
function byModel(records: CallRecord[], totalCost: number): ModelRow[] {
  const map = new Map<string, UsageTotals>();
  for (const r of records) {
    let t = map.get(r.model);
    if (!t) { t = emptyTotals(); map.set(r.model, t); }
    addRecord(t, r);
  }
  const out: ModelRow[] = [];
  for (const [model, t] of map) {
    out.push({
      model,
      ...t,
      hitRate: hitRate(t),
      costShare: totalCost > 0 ? t.cost / totalCost : 0,
    });
  }
  out.sort((a, b) => b.cost - a.cost);
  return out;
}

// ── Daily ─────────────────────────────────────────────────────────────────
function dayKey(ts: string): string | null {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) { return null; }
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daily(records: CallRecord[], topN: number): DailyRow[] {
  const map = new Map<string, UsageTotals>();
  for (const r of records) {
    const k = dayKey(r.timestamp);
    if (!k) { continue; }
    let t = map.get(k);
    if (!t) { t = emptyTotals(); map.set(k, t); }
    addRecord(t, r);
  }
  const days = [...map.keys()].sort().reverse().slice(0, topN);
  return days.map((d) => ({ date: d, ...map.get(d)! }));
}

// ── Top projects ──────────────────────────────────────────────────────────
function topProjects(records: CallRecord[], totalCost: number, topN: number): ProjectRow[] {
  const map = new Map<string, UsageTotals>();
  const lastSeen = new Map<string, number>();
  for (const r of records) {
    if (!r.project) { continue; }
    let t = map.get(r.project);
    if (!t) { t = emptyTotals(); map.set(r.project, t); }
    addRecord(t, r);
    const ts = Date.parse(r.timestamp);
    if (Number.isFinite(ts)) {
      const cur = lastSeen.get(r.project) ?? 0;
      if (ts > cur) { lastSeen.set(r.project, ts); }
    }
  }
  const rows: ProjectRow[] = [];
  for (const [project, t] of map) {
    const ms = lastSeen.get(project);
    rows.push({
      project,
      displayPath: shortenPath(decodeProject(project)),
      ...t,
      lastActive: ms ? isoDate(ms) : '—',
      costShare: totalCost > 0 ? t.cost / totalCost : 0,
    });
  }
  rows.sort((a, b) => b.cost - a.cost);
  return rows.slice(0, topN);
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Heatmap ───────────────────────────────────────────────────────────────
function heatmap(records: CallRecord[]): { rows: HeatmapRow[]; peak: number } {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of records) {
    const ms = Date.parse(r.timestamp);
    if (!Number.isFinite(ms)) { continue; }
    const d = new Date(ms);
    // JS getDay: 0=Sun..6=Sat. We want Mon=0..Sun=6 to match upstream label order.
    const dow = (d.getDay() + 6) % 7;
    grid[dow][d.getHours()] += r.cost;
  }
  let peak = 0;
  for (const row of grid) {
    for (const c of row) { if (c > peak) { peak = c; } }
  }
  const rows: HeatmapRow[] = grid.map((hours, dow) => ({
    dow,
    label: DOW_LABELS[dow],
    hours,
    rowTotal: hours.reduce((s, x) => s + x, 0),
  }));
  return { rows, peak };
}

