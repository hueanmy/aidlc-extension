import { cn } from '@/lib/utils';
import type { UiStatus } from '@/lib/types';

const statusConfig: Record<UiStatus, { label: string; className: string }> = {
  in_progress: {
    label: 'IN PROGRESS',
    className: 'bg-info/15 text-info border-info/30',
  },
  done: {
    label: 'DONE',
    className: 'bg-success/15 text-success border-success/30',
  },
  rejected: {
    label: 'REJECTED',
    className: 'bg-destructive/15 text-destructive border-destructive/30',
  },
  pending: {
    label: 'PENDING',
    className: 'bg-muted text-muted-foreground border-border',
  },
  awaiting_review: {
    label: 'AWAITING REVIEW',
    className: 'bg-warning/15 text-warning border-warning/30',
  },
  awaiting_work: {
    label: 'AWAITING WORK',
    className: 'bg-primary/15 text-primary border-primary/30',
  },
};

export function StatusBadge({ status }: { status: UiStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold tracking-wider border',
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
