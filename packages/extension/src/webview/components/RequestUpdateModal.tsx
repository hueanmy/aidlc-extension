import { useEffect, useRef, useState } from 'react';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

interface Props {
  agent: string;
  runId: string;
  stepIdx: number;
  /** How many steps will be reset to pending downstream. Surfaced so the
   * user knows the blast radius before submitting. */
  downstreamCount: number;
  onSubmit: (feedback: string) => void;
  onClose: () => void;
}

export function RequestUpdateModal({
  agent,
  runId,
  stepIdx,
  downstreamCount,
  onSubmit,
  onClose,
}: Props) {
  const [feedback, setFeedback] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const trimmed = feedback.trim();
  const submit = () => {
    if (!trimmed) { return; }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal
      title={`Request update — step ${stepIdx + 1}`}
      subtitle={
        <>
          <span className="font-mono text-foreground/80">{agent}</span> · run{' '}
          <span className="font-mono text-foreground/80">{runId}</span>
        </>
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] text-warning/90">
        <div className="font-semibold">
          This step will rewind to "awaiting work" with revision++.
        </div>
        {downstreamCount > 0 && (
          <div className="mt-0.5">
            {downstreamCount} downstream step{downstreamCount === 1 ? '' : 's'} will reset to
            pending — their history is preserved so you can see they were "previously done".
          </div>
        )}
      </div>

      <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        What changed? <span className="font-normal normal-case tracking-normal">(required)</span>
      </label>
      <textarea
        ref={ref}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="e.g. PRD must add rate-limit policy from new requirements doc"
        rows={4}
        className="w-full resize-none rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
      />

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label="Request update" disabled={!trimmed} />
      </ModalFooter>
    </Modal>
  );
}
