import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** tailwind max-width — defaults to max-w-md. */
  maxWidth?: string;
  /** Optional Cmd/Ctrl+Enter handler. */
  onSubmit?: () => void;
  /** When true, suppresses Esc / backdrop-click handlers. Used by the
   * outer modal in a stacked-modal pair so the inner modal's Esc doesn't
   * also dismiss the outer one. */
  inactive?: boolean;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = 'max-w-md',
  onSubmit,
  inactive = false,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inactive) { return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSubmit, inactive]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={inactive ? undefined : onClose}
    >
      <div
        ref={panelRef}
        className={cn('w-full rounded-lg border border-border bg-popover p-5 shadow-2xl', maxWidth)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Cancel (Esc)"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>;
}

export function ModalCancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:border-border/80 hover:bg-accent hover:text-foreground"
    >
      Cancel
    </button>
  );
}

export function ModalConfirmButton({
  onClick,
  label,
  danger,
  disabled,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border px-3 py-1.5 text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'border-destructive/50 bg-destructive/15 text-destructive enabled:hover:border-destructive enabled:hover:bg-destructive/25'
          : 'border-primary/50 bg-primary/15 text-primary enabled:hover:border-primary enabled:hover:bg-primary/25',
      )}
    >
      {label}
    </button>
  );
}
