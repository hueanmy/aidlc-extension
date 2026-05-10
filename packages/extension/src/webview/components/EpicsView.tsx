import { useEffect, useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceState, EpicSummary, EpicFilter } from '@/lib/types';
import { EpicCard } from './EpicCard';
import { StartEpicModal } from './StartEpicModal';
import { postMessage, onHostMessage } from '@/lib/bridge';

const FILTERS: { id: EpicFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'pending', label: 'Pending' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Failed' },
];

function matches(epic: EpicSummary, filter: EpicFilter): boolean {
  if (filter === 'all') { return true; }
  return epic.status === filter;
}

export function EpicsView({ state }: { state: WorkspaceState }) {
  const [filter, setFilter] = useState<EpicFilter>('all');
  const [startEpicOpen, setStartEpicOpen] = useState(false);

  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.type === 'triggerStartEpic') {
        setStartEpicOpen(true);
      }
    });
  }, []);

  const counts = useMemo(() => {
    const out: Record<EpicFilter, number> = {
      all: state.epics.length,
      in_progress: 0,
      pending: 0,
      done: 0,
      failed: 0,
    };
    for (const e of state.epics) { out[e.status] = (out[e.status] ?? 0) + 1; }
    return out;
  }, [state.epics]);

  const visible = useMemo(
    () => state.epics.filter((e) => matches(e, filter)),
    [state.epics, filter],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">AIDLC Epics</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Workflow runs</span>
            <span>·</span>
            <span>progress</span>
            <span>·</span>
            <span>inputs</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStartEpicOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Start Epic
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent',
            )}
          >
            {f.label}
            <span
              className={cn(
                'text-[10px] tabular-nums',
                filter === f.id ? 'text-primary-foreground/70' : 'text-muted-foreground',
              )}
            >
              {counts[f.id]}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface/50 p-6 text-center text-xs text-muted-foreground">
          {filter === 'all' ? 'No epics yet.' : `No ${filter.replace('_', ' ')} epics.`}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((e) => (
            <EpicCard
              key={e.id}
              epic={e}
              agentMeta={state.agentMeta}
              slashCommandsByAgent={state.slashCommandsByAgent}
            />
          ))}
        </div>
      )}

      {startEpicOpen && (
        <StartEpicModal
          pipelines={state.pipelines}
          agents={state.agents}
          agentMeta={state.agentMeta}
          nextEpicId={state.nextEpicId}
          existingEpicIds={state.existingEpicIds}
          onSubmit={(draft) => postMessage({ type: 'startEpicInline', draft })}
          onClose={() => setStartEpicOpen(false)}
        />
      )}
    </div>
  );
}
