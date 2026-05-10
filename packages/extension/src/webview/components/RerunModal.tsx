import { useEffect, useRef, useState } from 'react';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

interface Props {
  runId: string;
  agent: string;
  rejectReason?: string;
  initialFeedback?: string;
  onSubmit: (feedback: string) => void;
  onClose: () => void;
}

export function RerunModal({
  runId,
  agent,
  rejectReason,
  initialFeedback = '',
  onSubmit,
  onClose,
}: Props) {
  const [feedback, setFeedback] = useState(initialFeedback);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const submit = () => {
    onSubmit(feedback.trim());
    onClose();
  };

  return (
    <Modal
      title="Rerun step"
      subtitle={
        <>
          <span className="font-mono text-foreground/80">{agent}</span> · run{' '}
          <span className="font-mono text-foreground/80">{runId}</span>
        </>
      }
      onClose={onClose}
      onSubmit={submit}
    >
      {rejectReason && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-destructive">
            Last reject reason
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-destructive/90">
            ↳ {rejectReason}
          </div>
        </div>
      )}

      <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        Feedback <span className="font-normal normal-case tracking-normal">(optional — kept on the step)</span>
      </label>
      <textarea
        ref={ref}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={rejectReason ?? 'e.g. address reviewer concern about test coverage'}
        rows={3}
        className="w-full resize-none rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
      />

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label="Rerun" />
      </ModalFooter>
    </Modal>
  );
}
