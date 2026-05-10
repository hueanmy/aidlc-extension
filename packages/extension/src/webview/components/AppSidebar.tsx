import { useEffect, useState, useCallback } from 'react';
import {
  Bot,
  GitBranch,
  Zap,
  Layers,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Beaker,
  FileCode2,
  Play,
  Copy,
  X,
  CheckCircle2,
  Circle,
  AlertCircle,
  Sparkles,
  Diamond,
  RefreshCw,
  Plug,
  Loader2,
  Lightbulb,
  TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  SidebarState,
  ActiveRun,
  RecentEpicRef,
  SlashCommandRef,
  TemplateRef,
  ArtifactPath,
  McpServerInfo,
  CostSuggestion,
} from '@/lib/types';
import { RejectModal } from './RejectModal';
import { ConfirmModal } from './ConfirmModal';
import { StartRunModal } from './StartRunModal';
import { RerunModal } from './RerunModal';
import { RunWithFeedbackModal } from './RunWithFeedbackModal';
import { SavePresetModal } from './SavePresetModal';
import { LoadDemoModal } from './LoadDemoModal';
import { Modal } from './Modal';
import { ThemeToggle } from './ThemeToggle';
import { postMessage, getPersistedUi, setPersistedUi } from '@/lib/bridge';

interface CollapseState {
  recentEpics: boolean;
  slashCommands: boolean;
  workflows: boolean;
  pipelineRuns: boolean;
  mcpServers: boolean;
  costSuggestions: boolean;
}

interface PersistedUi {
  collapsed?: Partial<CollapseState>;
  collapsedRuns?: Record<string, boolean>;
}

const DEFAULT_COLLAPSED: CollapseState = {
  recentEpics: false,
  slashCommands: true,
  workflows: false,
  pipelineRuns: false,
  mcpServers: true,
  costSuggestions: false,
};

function isRunCollapsed(
  runId: string,
  status: string,
  overrides: Record<string, boolean>,
): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, runId)) { return overrides[runId]; }
  return status === 'rejected';
}

export function AppSidebar({ state }: { state: SidebarState | null }) {
  const seed = (getPersistedUi<PersistedUi>() ?? {});
  const [collapsed, setCollapsed] = useState<CollapseState>({
    ...DEFAULT_COLLAPSED,
    ...(seed.collapsed ?? {}),
  });
  const [collapsedRuns, setCollapsedRuns] = useState<Record<string, boolean>>(
    seed.collapsedRuns ?? {},
  );

  const persist = useCallback(
    (next: { collapsed?: CollapseState; collapsedRuns?: Record<string, boolean> }) => {
      const merged: PersistedUi = {
        collapsed: next.collapsed ?? collapsed,
        collapsedRuns: next.collapsedRuns ?? collapsedRuns,
      };
      setPersistedUi(merged);
    },
    [collapsed, collapsedRuns],
  );

  // Prune overrides for runs that no longer exist.
  useEffect(() => {
    if (!state) { return; }
    const live = new Set(state.activeRuns.map((r) => r.runId));
    let changed = false;
    const next: Record<string, boolean> = {};
    for (const [id, val] of Object.entries(collapsedRuns)) {
      if (live.has(id)) { next[id] = val; } else { changed = true; }
    }
    if (changed) {
      setCollapsedRuns(next);
      persist({ collapsedRuns: next });
    }
  }, [state, collapsedRuns, persist]);

  const toggleSection = (key: keyof CollapseState) => {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    persist({ collapsed: next });
  };

  const toggleRun = (runId: string, status: string) => {
    const wasCollapsed = isRunCollapsed(runId, status, collapsedRuns);
    const next = { ...collapsedRuns, [runId]: !wasCollapsed };
    setCollapsedRuns(next);
    persist({ collapsedRuns: next });
  };

  if (!state) {
    return (
      <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <BrandIcon />
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold tracking-widest uppercase">AIDLC</h2>
            <p className="truncate text-[10px] text-muted-foreground">Agent workflow runner</p>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {!state.hasFolder ? (
          <EmptyNoFolder demoProjectExists={state.demoProjectExists} />
        ) : (
          <>
            <ProjectBar workspaceName={state.workspaceName} configExists={state.configExists} />
            {state.configExists && (
              <button
                type="button"
                onClick={() => postMessage({ type: 'openYaml' })}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <FileCode2 className="h-3.5 w-3.5" />
                <span>Open workspace.yaml</span>
              </button>
            )}

            {!state.configExists && (
              <div className="rounded-md border border-dashed border-border bg-surface/50 p-3 text-[11px] text-muted-foreground leading-relaxed">
                No <code className="rounded bg-primary/10 px-1 py-0.5 font-mono text-primary">workspace.yaml</code> yet — open the Builder from the title bar to scaffold one.
              </div>
            )}

            {state.configExists && (
              <>
                <button
                  type="button"
                  onClick={() => postMessage({ type: 'requestStartEpic' })}
                  className="flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Start Epic</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-70" />
                </button>

                <StatsGrid state={state} />

                <ActiveRunsSection
                  runs={state.activeRuns}
                  pipelines={state.pipelines}
                  runIds={state.runIds}
                  collapsed={collapsed.pipelineRuns}
                  onToggleSection={() => toggleSection('pipelineRuns')}
                  isRunCollapsed={(runId, status) => isRunCollapsed(runId, status, collapsedRuns)}
                  onToggleRun={toggleRun}
                />

                {state.recentEpics.length > 0 && (
                  <RecentEpicsSection
                    epics={state.recentEpics}
                    epicsCount={state.epicsCount}
                    collapsed={collapsed.recentEpics}
                    onToggle={() => toggleSection('recentEpics')}
                  />
                )}

                {state.slashCommands.length > 0 && (
                  <SlashCommandsSection
                    commands={state.slashCommands}
                    collapsed={collapsed.slashCommands}
                    onToggle={() => toggleSection('slashCommands')}
                  />
                )}
              </>
            )}

            <WorkflowsSection
              builtins={state.builtinTemplates}
              project={state.projectTemplates}
              configExists={state.configExists}
              workspaceName={state.workspaceName}
              collapsed={collapsed.workflows}
              onToggle={() => toggleSection('workflows')}
            />

            <McpServersSection
              servers={state.mcpServers}
              loading={state.mcpLoading}
              error={state.mcpError}
              collapsed={collapsed.mcpServers}
              onToggle={() => toggleSection('mcpServers')}
            />

            <CostSuggestionsSection
              suggestions={state.costSuggestions}
              loading={state.costSuggestionsLoading}
              error={state.costSuggestionsError}
              windowDays={state.costSuggestionsWindowDays}
              collapsed={collapsed.costSuggestions}
              onToggle={() => toggleSection('costSuggestions')}
            />
          </>
        )}
      </div>

      <Footer hasFolder={state.hasFolder} />
    </aside>
  );
}

function BrandIcon() {
  const uri = typeof window !== 'undefined' ? window.BRAND_ICON_URI : undefined;
  if (uri) {
    return (
      <img
        src={uri}
        alt="AIDLC"
        className="h-7 w-7 shrink-0 rounded-md object-cover shadow-md shadow-primary/20"
      />
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
      <Bot className="h-3.5 w-3.5" />
    </div>
  );
}

function ProjectBar({
  workspaceName,
  configExists,
}: {
  workspaceName: string;
  configExists: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => postMessage({ type: 'openBuilder' })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          postMessage({ type: 'openBuilder' });
        }
      }}
      className="group flex cursor-pointer items-center gap-2 rounded-md border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 px-3 py-2 transition-all hover:border-primary/40 hover:from-primary/20 hover:to-primary/10"
      title="Click to open Builder"
    >
      <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold tracking-wide text-primary">{workspaceName}</div>
        {!configExists && (
          <div className="text-[10px] text-muted-foreground">no workspace.yaml</div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          postMessage({ type: 'openProject' });
        }}
        title="Switch project"
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-primary/20 hover:text-primary"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          postMessage({ type: 'closeProject' });
        }}
        title="Close project"
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyNoFolder({ demoProjectExists }: { demoProjectExists: boolean }) {
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const onLoadDemo = () => {
    if (demoProjectExists) {
      // Pop the inline picker — replaces the VS Code notification chrome
      // that the host would otherwise show when the dir already exists.
      setDemoModalOpen(true);
    } else {
      // Fresh install — just create + open. No prompt needed.
      postMessage({ type: 'loadDemoProject' });
    }
  };
  return (
    <div className="rounded-md border border-dashed border-border bg-surface/50 p-4 text-center">
      <h3 className="mb-1.5 text-xs font-bold tracking-wide">No project open</h3>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Open a folder to start building agents and workflows — or load the demo project.
      </p>
      <button
        type="button"
        onClick={() => postMessage({ type: 'openProject' })}
        className="flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span>Open Project</span>
        <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-70" />
      </button>
      <button
        type="button"
        onClick={onLoadDemo}
        className="mt-2 flex w-full items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Beaker className="h-3.5 w-3.5" />
        <span>Load Demo Project</span>
      </button>
      {demoModalOpen && (
        <LoadDemoModal
          onChoose={(mode) => postMessage({ type: 'loadDemoProject', mode })}
          onClose={() => setDemoModalOpen(false)}
        />
      )}
    </div>
  );
}

function StatsGrid({ state }: { state: SidebarState }) {
  const stats: { label: string; value: number }[] = [
    { label: 'Agents', value: state.agentsCount },
    { label: 'Skills', value: state.skillsCount },
    { label: 'Flows', value: state.pipelinesCount },
    { label: 'Epics', value: state.epicsCount },
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-center gap-0.5 rounded-md border border-border bg-card/50 px-1 py-2"
        >
          <span className="font-mono text-base font-bold tabular-nums text-primary leading-none">
            {s.value}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
  trailing,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', collapsed && '-rotate-90')}
        />
        <span>{label}</span>
      </button>
      {trailing}
    </div>
  );
}

function RecentEpicsSection({
  epics,
  epicsCount,
  collapsed,
  onToggle,
}: {
  epics: RecentEpicRef[];
  epicsCount: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <SectionHeader
        label="Recent Epics"
        collapsed={collapsed}
        onToggle={onToggle}
        trailing={
          <button
            type="button"
            onClick={() => postMessage({ type: 'openEpicsList' })}
            className="text-[10px] text-muted-foreground hover:text-primary"
          >
            All {epicsCount} →
          </button>
        }
      />
      {!collapsed && (
        <div className="mt-1.5 space-y-1">
          {epics.map((e) => (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => postMessage({ type: 'openEpicState', path: e.statePath })}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  postMessage({ type: 'openEpicState', path: e.statePath });
                }
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent"
            >
              <EpicDot status={e.status} />
              <span className="font-mono text-[10px] font-bold text-primary truncate">{e.id}</span>
              {e.title && (
                <span className="truncate text-muted-foreground">· {e.title}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EpicDot({ status }: { status: string }) {
  const cls = (() => {
    switch (status) {
      case 'in_progress':
        return 'bg-warning shadow-[0_0_4px_var(--color-warning)]';
      case 'done':
        return 'bg-success';
      case 'failed':
        return 'bg-destructive';
      default:
        return 'bg-muted-foreground/40';
    }
  })();
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cls)} />;
}

function SlashCommandsSection({
  commands,
  collapsed,
  onToggle,
}: {
  commands: SlashCommandRef[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <SectionHeader label="Slash commands" collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <div className="mt-1.5 space-y-1">
          {commands.map((c) => (
            <div
              key={c.name}
              className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-[11px]"
            >
              <span className="font-mono text-[10px] font-semibold text-primary">{c.name}</span>
              <span className="truncate text-muted-foreground">→ {c.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function McpServersSection({
  servers,
  loading,
  error,
  collapsed,
  onToggle,
}: {
  servers: McpServerInfo[] | null;
  loading: boolean;
  error: string | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Show counts in the header so users can glance the connected total
  // without expanding. servers === null means the list hasn't loaded yet.
  const total = servers?.length ?? 0;
  const connected = servers?.filter((s) => s.status === 'connected').length ?? 0;
  return (
    <div>
      <SectionHeader
        label="MCP servers"
        collapsed={collapsed}
        onToggle={onToggle}
        trailing={
          <div className="flex items-center gap-1.5">
            {servers && (
              <span className="text-[10px] text-muted-foreground">
                {connected}/{total}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                postMessage({ type: 'refreshMcp' });
              }}
              title="Re-run claude mcp list"
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
          </div>
        }
      />
      {!collapsed && (
        <div className="mt-1.5 space-y-1">
          {error && (
            <div className="rounded border-l-2 border-destructive bg-destructive/5 px-2 py-1.5 text-[10px] text-muted-foreground">
              {error}
            </div>
          )}
          {servers === null && !error && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Querying claude mcp list…</span>
            </div>
          )}
          {servers && servers.length === 0 && !error && (
            <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground">
              No MCP servers configured.
            </div>
          )}
          {servers?.map((s) => <McpRow key={s.name} server={s} />)}
        </div>
      )}
    </div>
  );
}

const MCP_DOT: Record<McpServerInfo['status'], string> = {
  connected: 'bg-success shadow-[0_0_4px_var(--color-success)]',
  needs_auth: 'bg-warning',
  failed: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
};

function McpRow({ server }: { server: McpServerInfo }) {
  const titleParts = [server.statusText];
  if (server.transport) { titleParts.push(server.transport); }
  if (server.endpoint) { titleParts.push(server.endpoint); }
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-[11px]"
      title={titleParts.join(' · ')}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', MCP_DOT[server.status])} />
      <Plug className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium text-foreground">{server.name}</span>
      <span className="ml-auto shrink-0 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
        {server.status === 'needs_auth' ? 'auth' : server.status}
      </span>
    </div>
  );
}

function CostSuggestionsSection({
  suggestions,
  loading,
  error,
  windowDays,
  collapsed,
  onToggle,
}: {
  suggestions: CostSuggestion[] | null;
  loading: boolean;
  error: string | null;
  windowDays: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Header surfaces the most actionable summary: total estimated savings
  // across all surfaced rules, plus a sev-count breakdown so users can
  // tell at a glance whether anything is high-severity without expanding.
  const totalSavings = suggestions?.reduce((s, x) => s + x.estSavings, 0) ?? 0;
  const counts = countBySeverity(suggestions);
  // Click a row to open the detail modal — the inline expand was too
  // cramped in the narrow sidebar to read evidence + action comfortably.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const selected = selectedIdx !== null && suggestions ? suggestions[selectedIdx] ?? null : null;
  return (
    <div>
      <SectionHeader
        label="Cost suggestions"
        collapsed={collapsed}
        onToggle={onToggle}
        trailing={
          <div className="flex items-center gap-1.5">
            {suggestions && suggestions.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] tabular-nums">
                {counts.high > 0 && (
                  <span className="text-destructive">{counts.high}h</span>
                )}
                {counts.med > 0 && (
                  <span className="text-warning">{counts.med}m</span>
                )}
                {counts.low > 0 && (
                  <span className="text-muted-foreground">{counts.low}l</span>
                )}
                {totalSavings > 0 && (
                  <span className="text-success">· save ~{fmtUsd(totalSavings)}</span>
                )}
              </span>
            )}
            {suggestions && suggestions.length === 0 && !loading && !error && (
              <span className="text-[10px] text-success">all clean</span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                postMessage({ type: 'refreshCostSuggestions' });
              }}
              title={`Re-scan last ${windowDays} day(s) of Claude logs`}
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
          </div>
        }
      />
      {!collapsed && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
            <Lightbulb className="h-2.5 w-2.5" />
            <span>Heuristic scan of last {windowDays}d · ported from claude-token-monitor</span>
          </div>
          {error && (
            <div className="rounded border-l-2 border-destructive bg-destructive/5 px-2 py-1.5 text-[10px] text-muted-foreground">
              {error}
            </div>
          )}
          {suggestions === null && !error && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Scanning Claude logs…</span>
            </div>
          )}
          {suggestions && suggestions.length === 0 && !error && (
            <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/5 px-2.5 py-1.5 text-[11px] text-success">
              <TrendingDown className="h-3 w-3" />
              <span>No efficiency issues detected — looking clean.</span>
            </div>
          )}
          {suggestions?.map((s, i) => (
            <CostSuggestionRow
              key={`${s.rule}-${i}`}
              s={s}
              onOpen={() => setSelectedIdx(i)}
            />
          ))}
        </div>
      )}
      {selected && suggestions && (
        <CostSuggestionDetailModal
          suggestion={selected}
          index={selectedIdx ?? 0}
          total={suggestions.length}
          onPrev={selectedIdx !== null && selectedIdx > 0
            ? () => setSelectedIdx(selectedIdx - 1)
            : undefined}
          onNext={selectedIdx !== null && selectedIdx < suggestions.length - 1
            ? () => setSelectedIdx(selectedIdx + 1)
            : undefined}
          onClose={() => setSelectedIdx(null)}
        />
      )}
    </div>
  );
}

function countBySeverity(
  suggestions: CostSuggestion[] | null,
): { high: number; med: number; low: number } {
  const out = { high: 0, med: 0, low: 0 };
  if (!suggestions) { return out; }
  for (const s of suggestions) { out[s.severity]++; }
  return out;
}

const SEV_PILL: Record<CostSuggestion['severity'], string> = {
  high: 'bg-destructive/15 text-destructive',
  med: 'bg-warning/15 text-warning',
  low: 'bg-muted text-muted-foreground',
};

function CostSuggestionRow({
  s,
  onOpen,
}: {
  s: CostSuggestion;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open suggestion detail"
      className={cn(
        'flex w-full items-center gap-2 rounded-md border bg-card/50 px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/40',
        s.severity === 'high'
          ? 'border-destructive/40'
          : s.severity === 'med'
          ? 'border-warning/40'
          : 'border-border',
      )}
    >
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider',
          SEV_PILL[s.severity],
        )}
      >
        {s.severity}
      </span>
      <span className="font-mono text-[10px] font-semibold text-primary truncate">
        {s.rule}
      </span>
      <span className="truncate text-[10px] text-muted-foreground">· {s.scope}</span>
      {s.estSavings > 0 && (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-success">
          ~{fmtUsd(s.estSavings)}
        </span>
      )}
    </button>
  );
}

function CostSuggestionDetailModal({
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
  // Modal lives at fixed inset-0 z-50, so it floats above the sidebar
  // panel (which is constrained to the activity-bar column). Wider
  // breakpoint than the default Modal so action text doesn't wrap awkwardly.
  return (
    <Modal
      title="Cost suggestion"
      subtitle={
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider',
              SEV_PILL[suggestion.severity],
            )}
          >
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
          <DetailField label="Estimated savings">
            <span className="font-mono tabular-nums text-success">
              ~{fmtUsd(suggestion.estSavings)} (heuristic)
            </span>
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

function fmtUsd(n: number): string {
  if (n >= 100) { return `$${n.toFixed(0)}`; }
  if (n >= 10) { return `$${n.toFixed(1)}`; }
  if (n >= 1) { return `$${n.toFixed(2)}`; }
  return `$${n.toFixed(3)}`;
}

function WorkflowsSection({
  builtins,
  project,
  configExists,
  workspaceName,
  collapsed,
  onToggle,
}: {
  builtins: TemplateRef[];
  project: TemplateRef[];
  configExists: boolean;
  workspaceName: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState<TemplateRef | null>(null);

  if (builtins.length === 0 && project.length === 0 && !configExists) { return null; }

  const onApplyClick = (template: TemplateRef) => {
    if (configExists) {
      setPendingApply(template);
    } else {
      postMessage({ type: 'applyTemplate', id: template.id, skipConfirm: true });
    }
  };

  return (
    <div>
      <SectionHeader label="Workflows" collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <div className="mt-1.5 space-y-1.5">
          {configExists && (
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Diamond className="h-3 w-3" />
              <span>Save current as template</span>
            </button>
          )}
          {builtins.length > 0 && (
            <>
              <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                Common
              </div>
              {builtins.map((t) => (
                <TemplateRow key={t.id} template={t} builtin onApply={onApplyClick} />
              ))}
            </>
          )}
          {project.length > 0 && (
            <>
              <div className="mt-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                Custom
              </div>
              {project.map((t) => (
                <TemplateRow key={t.id} template={t} builtin={false} onApply={onApplyClick} />
              ))}
            </>
          )}
        </div>
      )}

      {saveOpen && (
        <SavePresetModal
          existingProjectIds={project.map((p) => p.id)}
          builtinIds={builtins.map((b) => b.id)}
          defaultId={workspaceName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')}
          defaultName={workspaceName}
          onSubmit={(draft) => postMessage({ type: 'savePresetInline', draft })}
          onClose={() => setSaveOpen(false)}
        />
      )}
      {pendingApply && (
        <ConfirmModal
          title="Apply template"
          danger
          confirmLabel="Overwrite & apply"
          message={
            <>
              This project already has <span className="font-mono">.aidlc/workspace.yaml</span>.
              Overwrite with template <span className="font-mono">{pendingApply.id}</span>?
            </>
          }
          onConfirm={() =>
            postMessage({ type: 'applyTemplate', id: pendingApply.id, skipConfirm: true })
          }
          onClose={() => setPendingApply(null)}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template,
  builtin,
  onApply,
}: {
  template: TemplateRef;
  builtin: boolean;
  onApply: (template: TemplateRef) => void;
}) {
  const Icon = builtin ? Sparkles : Diamond;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onApply(template)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onApply(template);
        }
      }}
      title={`Apply template ${template.id}`}
      className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent"
    >
      <Icon className="h-3 w-3 shrink-0 text-primary opacity-80" />
      <span className="shrink-0 font-semibold text-primary truncate max-w-[40%]">
        {template.name}
      </span>
      <span className="truncate text-muted-foreground">· {template.description || template.id}</span>
    </div>
  );
}

function ActiveRunsSection({
  runs,
  pipelines,
  runIds,
  collapsed,
  onToggleSection,
  isRunCollapsed,
  onToggleRun,
}: {
  runs: ActiveRun[];
  pipelines: SidebarState['pipelines'];
  runIds: string[];
  collapsed: boolean;
  onToggleSection: () => void;
  isRunCollapsed: (runId: string, status: string) => boolean;
  onToggleRun: (runId: string, status: string) => void;
}) {
  const [startOpen, setStartOpen] = useState(false);
  const canStart = pipelines.length > 0;
  if (runs.length === 0 && !canStart) { return null; }

  return (
    <div>
      <SectionHeader label="Pipeline runs" collapsed={collapsed} onToggle={onToggleSection} />
      {!collapsed && (
        <div className="mt-1.5 space-y-2">
          {runs.map((r) => (
            <RunCard
              key={r.runId}
              run={r}
              collapsed={isRunCollapsed(r.runId, r.currentStepStatus)}
              onToggle={() => onToggleRun(r.runId, r.currentStepStatus)}
            />
          ))}
          {canStart && (
            <button
              type="button"
              onClick={() => setStartOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Play className="h-3 w-3" />
              <span>Start pipeline run</span>
              <ChevronRight className="ml-auto h-3 w-3 opacity-60" />
            </button>
          )}
        </div>
      )}
      {startOpen && (
        <StartRunModal
          pipelines={pipelines}
          existingRunIds={runIds}
          onStart={(pipelineId, runId) =>
            postMessage({ type: 'startRunInline', pipelineId, runId })
          }
          onClose={() => setStartOpen(false)}
        />
      )}
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  awaiting_work: 'bg-primary/15 text-primary',
  awaiting_auto_review: 'bg-info/15 text-info',
  awaiting_review: 'bg-warning/15 text-warning',
  rejected: 'bg-destructive/15 text-destructive',
};

function RunCard({
  run,
  collapsed,
  onToggle,
}: {
  run: ActiveRun;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const stepLabel = `${run.currentStepIdx + 1}/${run.totalSteps}: ${run.currentAgent}`;
  const pillCls = STATUS_PILL[run.currentStepStatus] ?? 'bg-muted text-muted-foreground';
  const [runOpen, setRunOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-card/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? 'Expand run' : 'Collapse run'}
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', collapsed && '-rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={() => postMessage({ type: 'openRunState', runId: run.runId })}
          className="flex flex-1 items-baseline gap-1.5 truncate text-left"
          title="Open run state JSON"
        >
          <span className="font-mono text-[11px] font-bold text-primary">{run.runId}</span>
          <span className="truncate text-[10px] text-muted-foreground">{run.pipelineId}</span>
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
            <span className="text-muted-foreground truncate">
              Step {stepLabel}
              {run.revision > 1 && (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-destructive/10 px-1.5 py-px text-[9px] text-destructive">
                  rev {run.revision}
                </span>
              )}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider',
                pillCls,
              )}
            >
              {run.currentStepStatus.replace(/_/g, ' ')}
            </span>
          </div>

          {run.currentSlashCommand && (
            <div className="mt-1.5 flex items-stretch gap-1">
              <button
                type="button"
                onClick={() =>
                  postMessage({ type: 'copyCommand', command: run.currentSlashCommand })
                }
                title="Click to copy — paste into Claude manually if you prefer"
                className="flex flex-1 items-center gap-1.5 rounded bg-primary/10 px-1.5 py-1 font-mono text-[10px] text-primary hover:bg-primary/20"
              >
                <span className="flex-1 truncate text-left">{run.currentSlashCommand}</span>
                <Copy className="h-2.5 w-2.5 opacity-70" />
              </button>
              {run.currentStepStatus === 'awaiting_work' && (
                <button
                  type="button"
                  onClick={() => setRunOpen(true)}
                  title="Run in Claude with optional feedback for the agent"
                  className="flex shrink-0 items-center justify-center rounded bg-primary px-2 text-primary-foreground hover:bg-primary/90"
                >
                  <Play className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {run.currentStepStatus === 'rejected' && run.rejectReason && (
            <div className="mt-1.5 rounded border-l-2 border-destructive bg-destructive/5 px-2 py-1 text-[10px] text-muted-foreground">
              ↳ {run.rejectReason}
            </div>
          )}

          <ArtifactList
            label="Produces"
            paths={run.produces}
            highlightMissing={run.currentStepStatus === 'awaiting_work'}
          />
          <ArtifactList label="Requires" paths={run.requires} highlightMissing={false} />

          <RunActions run={run} />
        </>
      )}

      {runOpen && run.currentSlashCommand && (
        <RunWithFeedbackModal
          agent={run.currentAgent}
          runId={run.runId}
          slashCommand={run.currentSlashCommand}
          carriedFeedback={run.feedback}
          onSubmit={(feedback) =>
            postMessage({
              type: 'runStepWithFeedback',
              runId: run.runId,
              slashCommand: run.currentSlashCommand,
              feedback,
            })
          }
          onClose={() => setRunOpen(false)}
        />
      )}
    </div>
  );
}

function ArtifactList({
  label,
  paths,
  highlightMissing,
}: {
  label: string;
  paths: ArtifactPath[];
  highlightMissing: boolean;
}) {
  if (paths.length === 0) { return null; }
  return (
    <div className="mt-1.5">
      <div className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="space-y-px">
        {paths.map((p) => {
          const Icon = p.exists ? CheckCircle2 : highlightMissing ? AlertCircle : Circle;
          const cls = p.exists
            ? 'text-primary'
            : highlightMissing
            ? 'text-destructive'
            : 'text-muted-foreground';
          return (
            <button
              type="button"
              key={p.path}
              onClick={() => postMessage({ type: 'openArtifact', path: p.path })}
              title={p.exists ? 'Open file' : 'Reveal in file explorer (file not yet created)'}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent text-left"
            >
              <Icon className={cn('h-2.5 w-2.5 shrink-0', cls)} />
              <span className={cn('truncate', p.exists ? 'text-muted-foreground' : cls)}>
                {p.path}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RunActions({ run }: { run: ActiveRun }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  return (
    <div className="mt-2 flex gap-1">
      {run.currentStepStatus === 'awaiting_work' && (
        <ActionBtn
          variant="primary"
          onClick={() => postMessage({ type: 'markStepDone', runId: run.runId })}
        >
          Mark step done
        </ActionBtn>
      )}
      {run.currentStepStatus === 'awaiting_auto_review' && (
        <ActionBtn
          variant="primary"
          onClick={() => postMessage({ type: 'runAutoReview', runId: run.runId })}
        >
          Run auto-review
        </ActionBtn>
      )}
      {run.currentStepStatus === 'awaiting_review' && (
        <>
          <ActionBtn
            variant="primary"
            onClick={() => postMessage({ type: 'approveStep', runId: run.runId })}
          >
            Approve
          </ActionBtn>
          <ActionBtn variant="destructive" onClick={() => setRejectOpen(true)}>
            Reject
          </ActionBtn>
        </>
      )}
      {run.currentStepStatus === 'rejected' && (
        <ActionBtn variant="primary" onClick={() => setRerunOpen(true)}>
          Rerun
        </ActionBtn>
      )}
      <button
        type="button"
        onClick={() => setDeleteOpen(true)}
        title="Delete run"
        className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </button>
      {rejectOpen && (
        <RejectModal
          runId={run.runId}
          currentStepIdx={run.currentStepIdx}
          stepAgents={run.stepAgents}
          onClose={() => setRejectOpen(false)}
        />
      )}
      {deleteOpen && (
        <ConfirmModal
          title="Delete run"
          danger
          confirmLabel="Delete"
          message={
            <>
              Delete run <span className="font-mono">{run.runId}</span>? The run state
              file is removed; produced artifacts on disk are kept.
            </>
          }
          onConfirm={() =>
            postMessage({ type: 'deleteRun', runId: run.runId, confirmed: true })
          }
          onClose={() => setDeleteOpen(false)}
        />
      )}
      {rerunOpen && (
        <RerunModal
          runId={run.runId}
          agent={run.currentAgent}
          rejectReason={run.rejectReason}
          onSubmit={(feedback) =>
            postMessage({ type: 'rerunStepInline', runId: run.runId, feedback })
          }
          onClose={() => setRerunOpen(false)}
        />
      )}
    </div>
  );
}

function ActionBtn({
  children,
  variant,
  onClick,
}: {
  children: React.ReactNode;
  variant: 'primary' | 'destructive';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
        variant === 'primary' &&
          'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
        variant === 'destructive' &&
          'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20',
      )}
    >
      {children}
    </button>
  );
}

function Footer({ hasFolder }: { hasFolder: boolean }) {
  const v = typeof window !== 'undefined' ? window.EXTENSION_VERSION : undefined;
  return (
    <div className="border-t border-sidebar-border px-3 py-2 text-center text-[10px] text-muted-foreground">
      {v && <span className="font-mono">v{v}</span>}
      {v && hasFolder && <span className="mx-1.5">·</span>}
      {hasFolder ? (
        <>
          <button
            type="button"
            onClick={() => postMessage({ type: 'openBuilder' })}
            className="hover:text-primary"
          >
            Builder
          </button>
          <span className="mx-1.5">·</span>
          <button
            type="button"
            onClick={() => postMessage({ type: 'refresh' })}
            className="hover:text-primary"
          >
            <RefreshCw className="inline h-2.5 w-2.5 align-text-bottom" /> Refresh
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => postMessage({ type: 'openProject' })}
          className="hover:text-primary"
        >
          Open Project
        </button>
      )}
    </div>
  );
}

// Suppress unused-import warning when GitBranch / Zap are not directly used
// (they may be used by future stat icons; keeping references to avoid churn).
const _ICON_REFS = { GitBranch, Zap };
void _ICON_REFS;
