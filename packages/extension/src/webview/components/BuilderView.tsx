import { useState, useMemo } from 'react';
import { Plus, FileCode2, Layers, Pencil, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceState, AgentSummary, SkillSummary, AssetScope } from '@/lib/types';
import { AgentCard, KebabMenu } from './AgentCard';
import { PipelineCard } from './PipelineCard';
import { postMessage } from '@/lib/bridge';

type BuilderTab = 'workflows' | 'agents' | 'skills' | 'epics';

const SCOPE_ORDER: AssetScope[] = ['project', 'aidlc', 'global'];

const SCOPE_LABEL: Record<AssetScope, string> = {
  project: 'Project',
  aidlc: 'AIDLC',
  global: 'Global',
};

export function BuilderView({ state }: { state: WorkspaceState }) {
  const [tab, setTab] = useState<BuilderTab>('agents');

  const tabs: { id: BuilderTab; label: string; count: number }[] = [
    { id: 'workflows', label: 'Workflows', count: state.pipelines.length },
    { id: 'agents', label: 'Agents', count: state.agents.length },
    { id: 'skills', label: 'Skills', count: state.skills.length },
    { id: 'epics', label: 'Epics', count: state.epics.length },
  ];

  const addLabel = tab === 'workflows'
    ? 'Add Pipeline'
    : tab === 'agents'
    ? 'Add Agent'
    : tab === 'skills'
    ? 'Add Skill'
    : 'Start Epic';

  const onAdd = () => {
    if (tab === 'workflows') { postMessage({ type: 'addPipeline' }); }
    else if (tab === 'agents') { postMessage({ type: 'addAgent' }); }
    else if (tab === 'skills') { postMessage({ type: 'addSkill' }); }
    else { postMessage({ type: 'startEpic' }); }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">AIDLC Builder</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Workspace</span>
            <span>·</span>
            <span>Agents</span>
            <span>·</span>
            <span>Skills</span>
            <span>·</span>
            <span>Pipelines</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors',
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                tab === t.id ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground',
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'agents' && <AgentsByScope agents={state.agents} />}
      {tab === 'skills' && <SkillsByScope skills={state.skills} />}
      {tab === 'workflows' && <PipelinesGrid state={state} />}
      {tab === 'epics' && <EpicsMiniGrid state={state} />}
    </div>
  );
}

function AgentsByScope({ agents }: { agents: AgentSummary[] }) {
  const grouped = useMemo(() => groupByScope(agents), [agents]);
  return (
    <>
      {SCOPE_ORDER.map((scope) => {
        const list = grouped[scope] || [];
        if (list.length === 0) { return null; }
        return (
          <section key={scope}>
            <ScopeHeader scope={scope} count={list.length} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <AgentCard key={`${a.scope}/${a.id}`} agent={a} />
              ))}
            </div>
          </section>
        );
      })}
      {agents.length === 0 && <EmptyHint kind="agents" />}
    </>
  );
}

function SkillsByScope({ skills }: { skills: SkillSummary[] }) {
  const grouped = useMemo(() => groupByScope(skills), [skills]);
  return (
    <>
      {SCOPE_ORDER.map((scope) => {
        const list = grouped[scope] || [];
        if (list.length === 0) { return null; }
        return (
          <section key={scope}>
            <ScopeHeader scope={scope} count={list.length} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((s) => (
                <SkillCard key={`${s.scope}/${s.id}`} skill={s} />
              ))}
            </div>
          </section>
        );
      })}
      {skills.length === 0 && <EmptyHint kind="skills" />}
    </>
  );
}

function SkillCard({ skill }: { skill: SkillSummary }) {
  const isAidlc = skill.scope === 'aidlc';
  const onClick = () => {
    if (skill.filePath) { postMessage({ type: 'openSkill', filePath: skill.filePath }); }
    else if (isAidlc) { postMessage({ type: 'openYaml' }); }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-3.5 transition-all hover:border-primary/40"
    >
      <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-primary">{skill.id}</div>
        {skill.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{skill.description}</p>
        )}
      </div>
      {isAidlc && (
        <KebabMenu
          items={[
            { label: 'Rename', icon: <Pencil className="h-3 w-3" />, action: 'renameSkill' },
            { label: 'Duplicate', icon: <Copy className="h-3 w-3" />, action: 'duplicateSkill' },
            { label: 'Delete', icon: <Trash2 className="h-3 w-3" />, action: 'deleteSkill', danger: true },
          ]}
          payload={{ id: skill.id }}
        />
      )}
    </div>
  );
}

function PipelinesGrid({ state }: { state: WorkspaceState }) {
  if (state.pipelines.length === 0) { return <EmptyHint kind="pipelines" />; }
  return (
    <div className="space-y-3">
      {state.pipelines.map((p) => (
        <PipelineCard key={p.id} pipeline={p} />
      ))}
    </div>
  );
}

function EpicsMiniGrid({ state }: { state: WorkspaceState }) {
  if (state.epics.length === 0) { return <EmptyHint kind="epics" />; }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {state.epics.map((e) => (
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
          className="cursor-pointer rounded-lg border border-border bg-card p-3.5 transition-all hover:border-primary/40"
        >
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <div className="truncate font-mono text-xs font-bold text-primary">{e.id}</div>
          </div>
          <p className="mt-1.5 truncate text-sm text-foreground">{e.title}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                'h-full rounded-full',
                e.status === 'done' ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${e.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeHeader({ scope, count }: { scope: AssetScope; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {SCOPE_LABEL[scope]}
      </span>
      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

function groupByScope<T extends { scope: AssetScope }>(items: T[]): Record<AssetScope, T[]> {
  const out: Record<AssetScope, T[]> = { project: [], aidlc: [], global: [] };
  for (const it of items) { out[it.scope].push(it); }
  return out;
}

function EmptyHint({ kind }: { kind: 'agents' | 'skills' | 'pipelines' | 'epics' }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface/50 p-6 text-center text-xs text-muted-foreground">
      No {kind} yet.
    </div>
  );
}
