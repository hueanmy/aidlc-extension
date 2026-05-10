/**
 * Token Usage Report — full dashboard rendered in a VS Code webview panel.
 * Mirrors the sections of `monitor.py report` from claude-token-monitor:
 * Overview, By Model, Daily, Top Projects, Heatmap, Efficiency Suggestions.
 */
import { useState } from 'react';
import {
  RefreshCw,
  Loader2,
  TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  TokenReportPanelState,
  TokenReport,
  ModelRow,
  DailyRow,
  ProjectRow,
  HeatmapRow,
  CostSuggestion,
} from '@/lib/types';
import { postMessage } from '@/lib/bridge';
import { Modal } from './Modal';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TokenReportView({ state }: { state: TokenReportPanelState | null }) {
  if (!state || (state.loading && !state.report)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Scanning Claude logs…</span>
        </div>
      </div>
    );
  }
  if (state.error && !state.report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="max-w-lg rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-semibold">Failed to build report</div>
          <div className="mt-1 text-muted-foreground">{state.error}</div>
        </div>
      </div>
    );
  }
  if (!state.report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        No data yet.
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Header state={state} />
        <Overview report={state.report} />
        <ByModelSection rows={state.report.byModel} report={state.report} />
        <DailySection rows={state.report.daily} />
        <TopProjectsSection rows={state.report.topProjects} report={state.report} />
        <HeatmapSection rows={state.report.heatmap} peak={state.report.heatmapPeak} />
        <SuggestionsSection
          suggestions={state.report.suggestions}
          estPotentialSavings={state.report.estPotentialSavings}
        />
        <Footer />
      </div>
    </div>
  );
}

function Header({ state }: { state: TokenReportPanelState }) {
  const generated = state.report
    ? new Date(state.report.generatedAt).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  return (
    <header className="mb-6 flex items-center justify-between border-b border-border pb-3">
      <div>
        <h1 className="text-base font-bold uppercase tracking-widest">
          Claude Code Usage Report
        </h1>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Scanned last {state.windowDays}d · generated {generated}
        </div>
      </div>
      <button
        type="button"
        onClick={() => postMessage({ type: 'refresh' })}
        disabled={state.loading}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-border/80 hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {state.loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        <span>Refresh</span>
      </button>
    </header>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

function Overview({ report }: { report: TokenReport }) {
  const o = report.overview;
  const hitColor = o.cacheHitRate >= 0.7 ? 'text-success' : o.cacheHitRate >= 0.4 ? 'text-warning' : 'text-destructive';
  return (
    <section className="mb-6">
      <ApiEquivBanner />
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md border border-border bg-card/50 px-4 py-3 text-[12px]">
        <Stat label="sessions" value={fmtInt(o.sessions)} valueClass="text-info" />
        <Stat label="projects" value={fmtInt(o.projects)} valueClass="text-primary" />
        <Stat label="calls" value={fmtInt(o.calls)} valueClass="text-info" />
        <Stat label="cache hit" value={`${(o.cacheHitRate * 100).toFixed(1)}%`} valueClass={hitColor} />
        <Stat label="tokens" value={fmtNum(o.totalTokens)} valueClass="font-semibold text-primary" />
        <Stat
          label="API $"
          value={fmtCost(o.totalCost)}
          valueClass="font-semibold text-success"
          hint="Pay-as-you-go API equivalent — not what subscription users actually pay."
        />
      </div>
    </section>
  );
}

function ApiEquivBanner() {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-1.5 text-[10.5px] text-muted-foreground">
      <span className="font-bold uppercase tracking-wider text-info">Note</span>
      <span className="leading-relaxed">
        <span className="font-mono text-foreground">API $</span> columns show the
        pay-as-you-go API equivalent of the usage — useful as a relative measure
        of where token spend goes. Subscription users (Pro / Max / Team) pay a flat
        fee, not this amount.
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={hint}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn('font-mono tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}

// ── By Model ──────────────────────────────────────────────────────────────
function ByModelSection({ rows, report }: { rows: ModelRow[]; report: TokenReport }) {
  if (rows.length === 0) { return null; }
  const total = report.overview;
  const peakModel = Math.max(...rows.map((r) => r.cost), 1);
  return (
    <section className="mb-6">
      <SectionTitle>By Model</SectionTitle>
      <Table>
        <thead>
          <tr>
            <Th>Model</Th>
            <Th align="right">Calls</Th>
            <Th align="right">Input</Th>
            <Th align="right">Output</Th>
            <Th align="right">Cache R</Th>
            <Th align="right">Cache W</Th>
            <Th align="right">Hit %</Th>
            <Th align="right" hint="Pay-as-you-go API equivalent — not what subscription users actually pay.">API $</Th>
            <Th align="right">% API $</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model} className="border-t border-border/50">
              <Td><span className="font-mono text-foreground">{r.model}</span></Td>
              <Td align="right">{fmtInt(r.calls)}</Td>
              <Td align="right">{fmtNum(r.input)}</Td>
              <Td align="right">{fmtNum(r.output)}</Td>
              <Td align="right">{fmtNum(r.cacheRead)}</Td>
              <Td align="right">{fmtNum(r.cacheWrite)}</Td>
              <Td align="right">
                <span className={hitColorClass(r.hitRate)}>{(r.hitRate * 100).toFixed(0)}%</span>
              </Td>
              <Td align="right">
                <CostCell cost={r.cost} peak={peakModel} />
              </Td>
              <Td align="right" mono>{(r.costShare * 100).toFixed(1)}%</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-card/40 font-semibold">
            <Td>TOTAL</Td>
            <Td align="right">{fmtInt(total.calls)}</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right">
              <span className={hitColorClass(total.cacheHitRate)}>
                {(total.cacheHitRate * 100).toFixed(0)}%
              </span>
            </Td>
            <Td align="right" mono><span className="text-success">{fmtCost(total.totalCost)}</span></Td>
            <Td align="right">100%</Td>
          </tr>
        </tbody>
      </Table>
    </section>
  );
}

// ── Daily ─────────────────────────────────────────────────────────────────
function DailySection({ rows }: { rows: DailyRow[] }) {
  if (rows.length === 0) { return null; }
  const peak = Math.max(...rows.map((r) => r.cost), 1);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  return (
    <section className="mb-6">
      <SectionTitle>Daily (last {rows.length})</SectionTitle>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th align="right">Calls</Th>
            <Th align="right">Input</Th>
            <Th align="right">Output</Th>
            <Th align="right">Cache R</Th>
            <Th align="right">Cache W</Th>
            <Th align="right" hint="Pay-as-you-go API equivalent — not what subscription users actually pay.">API $</Th>
            <Th>{''}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-t border-border/50">
              <Td><span className="font-mono">{r.date}</span></Td>
              <Td align="right">{fmtInt(r.calls)}</Td>
              <Td align="right">{fmtNum(r.input)}</Td>
              <Td align="right">{fmtNum(r.output)}</Td>
              <Td align="right">{fmtNum(r.cacheRead)}</Td>
              <Td align="right">{fmtNum(r.cacheWrite)}</Td>
              <Td align="right"><CostCell cost={r.cost} peak={peak} /></Td>
              <Td>
                <Bar fraction={peak > 0 ? r.cost / peak : 0} />
              </Td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-card/40 font-semibold">
            <Td>TOTAL</Td>
            <Td align="right">{fmtInt(totalCalls)}</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right" mono><span className="text-success">{fmtCost(totalCost)}</span></Td>
            <Td>{''}</Td>
          </tr>
        </tbody>
      </Table>
    </section>
  );
}

function Bar({ fraction }: { fraction: number }) {
  // 12-step block bar mirrors monitor.py output (bar_w = 12).
  const w = Math.max(0, Math.min(1, fraction));
  return (
    <div className="h-2 w-32 overflow-hidden rounded-sm bg-secondary/40">
      <div
        className="h-full rounded-sm bg-info"
        style={{ width: `${w * 100}%` }}
      />
    </div>
  );
}

// ── Top Projects ──────────────────────────────────────────────────────────
function TopProjectsSection({ rows, report }: { rows: ProjectRow[]; report: TokenReport }) {
  if (rows.length === 0) { return null; }
  const peak = Math.max(...rows.map((r) => r.cost), 1);
  return (
    <section className="mb-6">
      <SectionTitle>Top {rows.length} Projects</SectionTitle>
      <Table>
        <thead>
          <tr>
            <Th>Project</Th>
            <Th align="right">Calls</Th>
            <Th align="right">Input</Th>
            <Th align="right">Output</Th>
            <Th align="right" hint="Pay-as-you-go API equivalent — not what subscription users actually pay.">API $</Th>
            <Th align="right">% API $</Th>
            <Th align="right">Last active</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.project} className="border-t border-border/50">
              <Td><span className="font-mono text-[11.5px]">{r.displayPath}</span></Td>
              <Td align="right">{fmtInt(r.calls)}</Td>
              <Td align="right">{fmtNum(r.input)}</Td>
              <Td align="right">{fmtNum(r.output)}</Td>
              <Td align="right"><CostCell cost={r.cost} peak={peak} /></Td>
              <Td align="right" mono>{(r.costShare * 100).toFixed(1)}%</Td>
              <Td align="right" mono><span className="text-muted-foreground">{r.lastActive}</span></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {report.topProjects.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No project data.</div>
      )}
    </section>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────
function HeatmapSection({ rows, peak }: { rows: HeatmapRow[]; peak: number }) {
  return (
    <section className="mb-6">
      <SectionTitle>Usage Heatmap (API $ · local time)</SectionTitle>
      <div className="overflow-x-auto rounded-md border border-border bg-card/30 p-3 font-mono text-[10px]">
        <div className="flex items-center gap-1">
          <div className="w-12 shrink-0" />
          {HOURS.map((h) => (
            <div key={h} className="w-3.5 shrink-0 text-center text-muted-foreground">
              {h % 6 === 0 ? h : ''}
            </div>
          ))}
          <div className="ml-3 w-16 text-right text-muted-foreground">Total</div>
        </div>
        {rows.map((row) => (
          <div key={row.dow} className="mt-0.5 flex items-center gap-1">
            <div className="w-12 shrink-0 font-bold uppercase tracking-wider text-foreground">
              {row.label}
            </div>
            {row.hours.map((cost, h) => (
              <HeatCell key={h} cost={cost} peak={peak} hour={h} dow={row.label} />
            ))}
            <div className="ml-3 w-16 shrink-0 text-right tabular-nums">
              {row.rowTotal > 0 ? fmtCost(row.rowTotal) : <span className="text-muted-foreground">—</span>}
            </div>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Cooler ↔ hotter</span>
          <Legend peak={peak} />
        </div>
      </div>
    </section>
  );
}

function HeatCell({ cost, peak, hour, dow }: { cost: number; peak: number; hour: number; dow: string }) {
  const intensity = peak > 0 ? cost / peak : 0;
  const title = cost > 0 ? `${dow} ${hour}:00 — ${fmtCost(cost)}` : `${dow} ${hour}:00 — no activity`;
  // Empty cells render as a faint dot so the grid is still legible.
  const bg = cost === 0
    ? 'bg-secondary/30'
    : intensity < 0.2
    ? 'bg-info/25'
    : intensity < 0.4
    ? 'bg-info/45'
    : intensity < 0.7
    ? 'bg-info/70'
    : 'bg-info';
  return (
    <div
      title={title}
      className={cn('h-3.5 w-3.5 shrink-0 rounded-sm', bg)}
    />
  );
}

function Legend({ peak }: { peak: number }) {
  return (
    <span className="flex items-center gap-1">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <span
          key={f}
          className={cn(
            'h-2.5 w-2.5 rounded-sm',
            f === 0 ? 'bg-secondary/30' : f < 0.4 ? 'bg-info/25' : f < 0.7 ? 'bg-info/45' : f < 1 ? 'bg-info/70' : 'bg-info',
          )}
          title={f === 1 ? `peak ${fmtCost(peak)}` : ''}
        />
      ))}
    </span>
  );
}

// ── Suggestions ──────────────────────────────────────────────────────────
function SuggestionsSection({
  suggestions,
  estPotentialSavings,
}: {
  suggestions: CostSuggestion[];
  estPotentialSavings: number;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const selected = selectedIdx !== null ? suggestions[selectedIdx] ?? null : null;
  const counts = { high: 0, med: 0, low: 0 };
  for (const s of suggestions) { counts[s.severity]++; }

  if (suggestions.length === 0) {
    return (
      <section className="mb-6">
        <SectionTitle>Efficiency Suggestions</SectionTitle>
        <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[12px] text-success">
          <TrendingDown className="h-3 w-3" />
          <span>No efficiency issues detected — looking clean.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <SectionTitle>Efficiency Suggestions</SectionTitle>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">found:</span>
          <span className="font-mono tabular-nums text-info">{suggestions.length}</span>
          {counts.high > 0 && <span className="text-destructive">{counts.high} high</span>}
          {counts.med > 0 && <span className="text-warning">{counts.med} med</span>}
          {counts.low > 0 && <span className="text-muted-foreground">{counts.low} low</span>}
          {estPotentialSavings > 0 && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span
                className="text-muted-foreground"
                title="API-equivalent savings if you switched to the recommended model/workflow. Subscription users won't see this in their bill — but it does free up usage headroom."
              >
                est. savings (API $)
              </span>
              <span className="font-mono tabular-nums text-success">~{fmtCost(estPotentialSavings)}</span>
            </>
          )}
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Sev</Th>
            <Th>Rule</Th>
            <Th>Scope</Th>
            <Th>Evidence</Th>
            <Th align="right" hint="API-equivalent savings — directional, not what subscription users would see on their bill.">Save (API $)</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((s, i) => (
            <tr
              key={`${s.rule}-${i}`}
              onClick={() => setSelectedIdx(i)}
              className="cursor-pointer border-t border-border/50 hover:bg-accent/40"
              title="Click for full detail"
            >
              <Td>
                <span className={cn('rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider', SEV_PILL[s.severity])}>
                  {s.severity}
                </span>
              </Td>
              <Td><span className="font-mono text-[10.5px] text-primary">{s.rule}</span></Td>
              <Td><span className="font-mono text-[10.5px] text-foreground/85">{s.scope}</span></Td>
              <Td><span className="text-muted-foreground">{s.evidence}</span></Td>
              <Td align="right" mono>
                {s.estSavings > 0
                  ? <span className="text-success">{fmtCost(s.estSavings)}</span>
                  : <span className="text-muted-foreground">—</span>}
              </Td>
              <Td><span className="text-foreground/90">{s.action}</span></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {selected !== null && selectedIdx !== null && (
        <SuggestionDetailModal
          suggestion={selected}
          index={selectedIdx}
          total={suggestions.length}
          onPrev={selectedIdx > 0 ? () => setSelectedIdx(selectedIdx - 1) : undefined}
          onNext={selectedIdx < suggestions.length - 1 ? () => setSelectedIdx(selectedIdx + 1) : undefined}
          onClose={() => setSelectedIdx(null)}
        />
      )}
    </section>
  );
}

const SEV_PILL: Record<CostSuggestion['severity'], string> = {
  high: 'bg-destructive/15 text-destructive',
  med: 'bg-warning/15 text-warning',
  low: 'bg-muted text-muted-foreground',
};

function SuggestionDetailModal({
  suggestion,
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  suggestion: CostSuggestion;
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Cost suggestion"
      subtitle={
        <span className="flex items-center gap-2">
          <span className={cn('rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider', SEV_PILL[suggestion.severity])}>
            {suggestion.severity}
          </span>
          <span className="font-mono text-foreground/80">{suggestion.rule}</span>
          <span className="text-muted-foreground/70">·</span>
          <span>{index + 1} / {total}</span>
        </span>
      }
      maxWidth="max-w-xl"
      onClose={onClose}
    >
      <div className="space-y-3 text-[12px]">
        <DetailField label="Scope">
          <span className="font-mono text-[11.5px] text-foreground/90">{suggestion.scope}</span>
        </DetailField>
        <DetailField label="Evidence">
          <span className="text-muted-foreground">{suggestion.evidence}</span>
        </DetailField>
        <DetailField label="Recommended action">
          <span className="leading-relaxed text-foreground">{suggestion.action}</span>
        </DetailField>
        {suggestion.estSavings > 0 && (
          <DetailField label="Estimated savings (API $)">
            <span className="font-mono tabular-nums text-success">
              ~{fmtCost(suggestion.estSavings)}
            </span>
            <div className="mt-1 text-[10.5px] text-muted-foreground">
              API-equivalent — heuristic. Subscription users see this as freed-up
              usage headroom, not a smaller bill.
            </div>
          </DetailField>
        )}
      </div>
      <div className="mt-5 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev}
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:border-border/80 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:border-border/80 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-[11.5px] font-semibold text-primary hover:border-primary hover:bg-primary/25"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="mt-8 border-t border-border pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
      <div>
        <span className="font-bold uppercase tracking-wider">$ are API equivalents:</span>{' '}
        Tokens × API list price for the model that served them. Subscription users
        (Pro / Max / Team) pay a flat fee — the $ here is a relative measure of where
        spend goes, not a bill.
      </div>
      <div className="mt-1.5">
        <span className="font-bold uppercase tracking-wider">How savings are estimated:</span>{' '}
        Opus → Sonnet ≈ 80% (Sonnet is ~5× cheaper across input, output, and cache tiers). ZeroCTX
        assumed to compress spike stdout by ~60%. Directional only, not accounting.
      </div>
      <div className="mt-1.5">
        Source:{' '}
        <a
          href="https://github.com/emtyty/claude-token-monitor"
          className="text-primary hover:underline"
        >
          claude-token-monitor
        </a>
      </div>
    </footer>
  );
}

// ── Table primitives + formatting ─────────────────────────────────────────
function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  );
}

function Th({
  children,
  align,
  hint,
}: {
  children: React.ReactNode;
  align?: 'right';
  hint?: string;
}) {
  return (
    <th
      title={hint}
      className={cn(
        'bg-card/40 px-2.5 py-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  mono,
}: {
  children: React.ReactNode;
  align?: 'right';
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-2.5 py-1 align-middle',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono tabular-nums',
      )}
    >
      {children}
    </td>
  );
}

function CostCell({ cost, peak }: { cost: number; peak: number }) {
  const cls = cost / Math.max(peak, 1) >= 0.8
    ? 'text-destructive'
    : cost / Math.max(peak, 1) >= 0.5
    ? 'text-warning'
    : 'text-success';
  return <span className={cn('font-mono tabular-nums', cls)}>{fmtCost(cost)}</span>;
}

function hitColorClass(rate: number): string {
  if (rate >= 0.7) { return 'text-success'; }
  if (rate >= 0.4) { return 'text-warning'; }
  return 'text-destructive';
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

function fmtInt(n: number): string {
  return n.toLocaleString();
}
