import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal,
  FileText,
  GitBranch,
  MessageSquare,
  Pencil,
  Copy,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/lib/types';
import { postMessage } from '@/lib/bridge';

const scopeLabel: Record<AgentSummary['scope'], string> = {
  project: 'PROJECT',
  aidlc: 'AIDLC',
  global: 'GLOBAL',
};

const typeBadgeClass: Record<AgentSummary['scope'], string> = {
  project: 'bg-warning/15 text-warning border-warning/30',
  aidlc: 'bg-primary/15 text-primary border-primary/30',
  global: 'bg-success/15 text-success border-success/30',
};

const integrationIcons: Record<string, React.ReactNode> = {
  files: <FileText className="h-3 w-3" />,
  github: <GitBranch className="h-3 w-3" />,
  slack: <MessageSquare className="h-3 w-3" />,
};

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const isAidlc = agent.scope === 'aidlc';
  const onCardClick = () => {
    if (isAidlc) {
      postMessage({ type: 'openYaml' });
    } else if (agent.filePath) {
      postMessage({ type: 'openAgent', filePath: agent.filePath });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCardClick();
        }
      }}
      className="group flex flex-col rounded-lg border border-border bg-card p-3.5 transition-all hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-primary">{agent.id}</h4>
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider border',
                typeBadgeClass[agent.scope],
              )}
            >
              {scopeLabel[agent.scope]}
            </span>
          </div>
          {agent.description && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{agent.description}</p>
          )}
        </div>
        {isAidlc && (
          <KebabMenu
            items={[
              { label: 'Rename', icon: <Pencil className="h-3 w-3" />, action: 'renameAgent' },
              { label: 'Duplicate', icon: <Copy className="h-3 w-3" />, action: 'duplicateAgent' },
              { label: 'Delete', icon: <Trash2 className="h-3 w-3" />, action: 'deleteAgent', danger: true },
            ]}
            payload={{ id: agent.id }}
          />
        )}
      </div>

      {(agent.skill || agent.model) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.skill && (
            <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
              {agent.skill}
            </span>
          )}
          {agent.model && (
            <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
              {agent.model}
            </span>
          )}
        </div>
      )}

      {agent.integrations && agent.integrations.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {agent.integrations.map((i) => (
            <span
              key={i}
              className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
            >
              {integrationIcons[i] || null}
              {i}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface KebabItem {
  label: string;
  icon: React.ReactNode;
  action: string;
  danger?: boolean;
}

export function KebabMenu({
  items,
  payload,
}: {
  items: KebabItem[];
  payload: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) { return; }
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) { return; }
      if (!ref.current.contains(e.target as Node)) { setOpen(false); }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative ml-2" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="More actions"
        title="More actions"
        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                postMessage({ type: item.action, ...payload });
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                item.danger
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-foreground hover:bg-accent',
              )}
            >
              <span className="opacity-70">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
