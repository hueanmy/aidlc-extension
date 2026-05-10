import { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { postMessage } from '@/lib/bridge';

interface Props {
  runId: string;
  currentStepIdx: number;
  stepAgents: string[];
  onClose: () => void;
}

export function RejectModal({ runId, currentStepIdx, stepAgents, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [targetIdx, setTargetIdx] = useState(currentStepIdx);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason, targetIdx]);

  const submit = () => {
    postMessage({
      type: 'rejectStepInline',
      runId,
      reason: reason.trim(),
      targetIdx,
    });
    onClose();
  };

  const currentAgent = stepAgents[currentStepIdx] ?? '';
  const upstreamOptions = stepAgents
    .map((agent, i) => ({ idx: i, agent }))
    .filter((s) => s.idx < currentStepIdx);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-popover p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="reject-modal-title" className="text-sm font-semibold text-foreground">
              Reject step
            </h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Step {currentStepIdx + 1} —{' '}
              <span className="font-mono text-foreground/80">{currentAgent}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Cancel (Esc)"
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Reason <span className="font-normal normal-case tracking-normal">(optional)</span>
        </label>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. PRD missing performance acceptance criteria"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        />

        {upstreamOptions.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Send work back to
            </div>
            <div className="space-y-1">
              <RadioOption
                checked={targetIdx === currentStepIdx}
                onSelect={() => setTargetIdx(currentStepIdx)}
                label={`Stay on step ${currentStepIdx + 1}`}
                detail={`Rerun in place — ${currentAgent}`}
                hint="Default"
              />
              {upstreamOptions
                .slice()
                .reverse()
                .map((s) => (
                  <RadioOption
                    key={s.idx}
                    checked={targetIdx === s.idx}
                    onSelect={() => setTargetIdx(s.idx)}
                    label={`Send back to step ${s.idx + 1}`}
                    detail={s.agent}
                    hint={`Resets ${s.idx + 2}–${currentStepIdx + 1} to pending`}
                  />
                ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:border-border/80 hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md border border-destructive/50 bg-destructive/15 px-3 py-1.5 text-[11.5px] font-semibold text-destructive hover:border-destructive hover:bg-destructive/25"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function RadioOption({
  checked,
  onSelect,
  label,
  detail,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  detail: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
        checked
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-transparent hover:border-border/80 hover:bg-accent/50',
      )}
    >
      <div
        className={cn(
          'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-2',
          checked ? 'border-primary' : 'border-muted-foreground/40',
        )}
      >
        {checked && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-foreground">{label}</span>
          {hint && (
            <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
              {hint}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">{detail}</div>
      </div>
    </button>
  );
}
