import { useEffect, useRef, useState } from 'react';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

interface Props {
  kind: 'agent' | 'skill';
  currentId: string;
  existingIds: string[];
  onRename: (newId: string) => void;
  onClose: () => void;
}

export function RenameModal({ kind, currentId, existingIds, onRename, onClose }: Props) {
  const [value, setValue] = useState(currentId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const error =
    !trimmed
      ? 'ID cannot be empty'
      : trimmed !== currentId && existingIds.includes(trimmed)
      ? `${kind === 'agent' ? 'Agent' : 'Skill'} with this ID already exists`
      : null;
  const canSubmit = !error && trimmed !== currentId;

  const submit = () => {
    if (!canSubmit) { return; }
    onRename(trimmed);
    onClose();
  };

  return (
    <Modal
      title={`Rename ${kind}`}
      subtitle={
        <>
          Current: <span className="font-mono text-foreground/80">{currentId}</span>
        </>
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        New ID
      </label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            submit();
          }
        }}
        spellCheck={false}
        className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      {error && (
        <div className="mt-1.5 text-[10.5px] text-destructive">{error}</div>
      )}
      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label="Rename" disabled={!canSubmit} />
      </ModalFooter>
    </Modal>
  );
}
