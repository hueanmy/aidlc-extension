import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/lib/types';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

interface Props {
  pipelineId: string;
  agents: AgentSummary[];
  /** agent ids already in the pipeline — surfaced as "already in pipeline" hints. */
  existingAgentIds: string[];
  onPick: (agentId: string) => void;
  onClose: () => void;
}

export function StepPickerModal({ pipelineId, agents, existingAgentIds, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) { return agents; }
    return agents.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [agents, query]);

  useEffect(() => {
    if (selectedIdx >= filtered.length) { setSelectedIdx(0); }
  }, [filtered.length, selectedIdx]);

  const submit = (agentId?: string) => {
    const id = agentId ?? filtered[selectedIdx]?.id;
    if (!id) { return; }
    onPick(id);
    onClose();
  };

  return (
    <Modal
      title="Add step"
      subtitle={
        <>
          Append to <span className="font-mono text-foreground/80">{pipelineId}</span>
        </>
      }
      onClose={onClose}
      maxWidth="max-w-lg"
      onSubmit={() => submit()}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Search agents..."
          spellCheck={false}
          className="w-full rounded-md border border-border bg-input/50 py-2 pl-8 pr-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">No agents match.</div>
        ) : (
          filtered.map((a, i) => {
            const inPipeline = existingAgentIds.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => submit(a.id)}
                onMouseEnter={() => setSelectedIdx(i)}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b border-border/50 px-2.5 py-2 text-left last:border-b-0',
                  i === selectedIdx ? 'bg-primary/10' : 'bg-transparent hover:bg-accent/40',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[12px] font-medium text-foreground">
                      {a.id}
                    </span>
                    {inPipeline && (
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                        already in pipeline
                      </span>
                    )}
                  </div>
                  {a.description && (
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {a.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton
          onClick={() => submit()}
          label="Add step"
          disabled={filtered.length === 0}
        />
      </ModalFooter>
    </Modal>
  );
}
