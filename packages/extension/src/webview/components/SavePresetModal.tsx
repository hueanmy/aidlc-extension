import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface SavePresetDraft {
  id: string;
  name: string;
  description: string;
}

interface Props {
  /** Project preset ids — would be overwritten if user picks the same id. */
  existingProjectIds: string[];
  /** Built-in preset ids — reserved, blocked. */
  builtinIds: string[];
  /** Suggested defaults from the active workspace.yaml. */
  defaultId?: string;
  defaultName?: string;
  onSubmit: (draft: SavePresetDraft) => void;
  onClose: () => void;
}

export function SavePresetModal({
  existingProjectIds,
  builtinIds,
  defaultId = '',
  defaultName = '',
  onSubmit,
  onClose,
}: Props) {
  const [id, setId] = useState(defaultId);
  const [name, setName] = useState(defaultName || defaultId);
  const [description, setDescription] = useState('');
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    idRef.current?.focus();
    idRef.current?.select();
  }, []);

  const trimmedId = id.trim();
  const idInfo = useMemo(() => {
    if (!trimmedId) { return { kind: 'error' as const, msg: 'Preset id is required' }; }
    if (!ID_PATTERN.test(trimmedId)) {
      return {
        kind: 'error' as const,
        msg: 'Lowercase letters / digits / dashes only — must start with a letter',
      };
    }
    if (builtinIds.includes(trimmedId)) {
      return { kind: 'error' as const, msg: `"${trimmedId}" is reserved for a built-in template` };
    }
    if (existingProjectIds.includes(trimmedId)) {
      return {
        kind: 'warn' as const,
        msg: `Project template "${trimmedId}" already exists — saving will overwrite it`,
      };
    }
    return null;
  }, [trimmedId, existingProjectIds, builtinIds]);

  const nameError = !name.trim() ? 'Display name is required' : null;
  const blocked = idInfo?.kind === 'error' || !!nameError;

  const submit = () => {
    if (blocked) { return; }
    onSubmit({
      id: trimmedId,
      name: name.trim(),
      description: description.trim(),
    });
    onClose();
  };

  return (
    <Modal title="Save workspace as template" maxWidth="max-w-lg" onClose={onClose} onSubmit={submit}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Template id
          </label>
          <input
            ref={idRef}
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. qa-automation"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          {idInfo && trimmedId && (
            <div
              className={
                idInfo.kind === 'error'
                  ? 'mt-1 text-[10.5px] text-destructive'
                  : 'mt-1 text-[10.5px] text-warning'
              }
            >
              {idInfo.msg}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Display name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "QA Automation Pipeline"'
            className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          {nameError && name && (
            <div className="mt-1 text-[10.5px] text-destructive">{nameError}</div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Description <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "Cypress → Playwright converter + doc writer"'
            className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton
          onClick={submit}
          label={idInfo?.kind === 'warn' ? 'Overwrite & save' : 'Save template'}
          danger={idInfo?.kind === 'warn'}
          disabled={blocked}
        />
      </ModalFooter>
    </Modal>
  );
}
