import { useEffect, useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';
import { pickAndReadFile } from '@/lib/pickFile';

interface Props {
  agent: string;
  runId: string;
  slashCommand: string;
  /** Carried feedback from a prior reject — pre-fills the textarea so the
   * user can keep, edit, or clear it. */
  carriedFeedback?: string;
  onSubmit: (feedback: string) => void;
  onClose: () => void;
}

export function RunWithFeedbackModal({
  agent,
  runId,
  slashCommand,
  carriedFeedback,
  onSubmit,
  onClose,
}: Props) {
  const [feedback, setFeedback] = useState(carriedFeedback ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadInfo, setLoadInfo] = useState<{ kind: 'loaded' | 'error'; text: string } | null>(
    null,
  );

  const onLoadFromFile = async () => {
    setLoading(true);
    setLoadInfo(null);
    try {
      const result = await pickAndReadFile();
      if (!result) { return; }
      // Append (rather than overwrite) when there's already typed feedback —
      // user is more often layering hints than swapping them.
      setFeedback((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${result.content}` : result.content));
      setLoadInfo({ kind: 'loaded', text: `Loaded ${result.fileName}` });
    } catch (err) {
      setLoadInfo({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    ref.current?.focus();
    // Place caret at end so the user can keep typing additional feedback
    // without having to click into the textarea.
    if (ref.current) {
      ref.current.setSelectionRange(feedback.length, feedback.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = feedback.trim();
  const submit = () => {
    onSubmit(trimmed);
    onClose();
  };

  // Preview the prompt that will land in Claude's REPL so the user knows
  // exactly what's about to be sent.
  const previewPrompt = trimmed
    ? `${slashCommand} ${runId} — Update artifact per feedback: "${trimmed}"`
    : `${slashCommand} ${runId}`;

  return (
    <Modal
      title="Run with feedback"
      subtitle={
        <>
          <span className="font-mono text-foreground/80">{agent}</span> · run{' '}
          <span className="font-mono text-foreground/80">{runId}</span>
        </>
      }
      onClose={onClose}
      onSubmit={submit}
    >
      {carriedFeedback && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-warning">
            Carried feedback
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-warning/90">
            ↳ {carriedFeedback}
          </div>
          <div className="mt-1 text-[10px] italic text-warning/70">
            Pre-filled below — edit or clear if you want to send something else.
          </div>
        </div>
      )}

      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Feedback for the agent <span className="font-normal normal-case tracking-normal">(optional)</span>
        </label>
        <button
          type="button"
          onClick={onLoadFromFile}
          disabled={loading}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Append the contents of a text/markdown file to the feedback"
        >
          {loading ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <FileUp className="h-2.5 w-2.5" />
          )}
          <span>Load from file…</span>
        </button>
      </div>
      <textarea
        ref={ref}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="e.g. include rate-limit policy from PRD §4.2; format as a checklist"
        rows={5}
        className="w-full resize-y rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      {loadInfo && (
        <div
          className={cn(
            'mt-1 text-[10px]',
            loadInfo.kind === 'loaded' ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {loadInfo.text}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Will run in Claude
        </div>
        <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 font-mono text-[10.5px] text-foreground/80 break-all">
          {previewPrompt}
        </div>
      </div>

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label="Run in Claude" />
      </ModalFooter>
    </Modal>
  );
}
