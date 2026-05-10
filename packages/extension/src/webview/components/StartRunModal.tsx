import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PipelineRef } from '@/lib/types';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface Props {
  pipelines: PipelineRef[];
  /** When provided, the picker is locked to this pipeline (e.g. PipelineCard "Run"). */
  preselectedPipelineId?: string;
  existingRunIds: string[];
  onStart: (pipelineId: string, runId: string) => void;
  onClose: () => void;
}

export function StartRunModal({
  pipelines,
  preselectedPipelineId,
  existingRunIds,
  onStart,
  onClose,
}: Props) {
  const [pipelineId, setPipelineId] = useState<string>(
    preselectedPipelineId ?? pipelines[0]?.id ?? '',
  );
  const [runId, setRunId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = runId.trim();
  const error = useMemo(() => {
    if (!pipelineId) { return 'Pick a pipeline'; }
    if (!trimmed) { return 'Run id is required'; }
    if (!RUN_ID_PATTERN.test(trimmed)) {
      return 'Letters, digits, dot, dash, underscore — must start with letter/digit';
    }
    if (existingRunIds.includes(trimmed)) {
      return `Run "${trimmed}" already exists`;
    }
    return null;
  }, [pipelineId, trimmed, existingRunIds]);

  const submit = () => {
    if (error) { return; }
    onStart(pipelineId, trimmed);
    onClose();
  };

  const lockedPipeline = preselectedPipelineId
    ? pipelines.find((p) => p.id === preselectedPipelineId)
    : null;

  return (
    <Modal title="Start pipeline run" onClose={onClose} onSubmit={submit}>
      {lockedPipeline ? (
        <div className="mb-3 rounded-md border border-border bg-secondary/50 px-3 py-2">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Pipeline
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-mono text-[12.5px] font-semibold text-primary">
              {lockedPipeline.id}
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              {lockedPipeline.stepCount} step{lockedPipeline.stepCount === 1 ? '' : 's'} ·
              on_failure: {lockedPipeline.onFailure}
            </span>
          </div>
        </div>
      ) : (
        <>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Pipeline
          </label>
          <div className="mb-3 max-h-44 overflow-y-auto rounded-md border border-border">
            {pipelines.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-muted-foreground">
                No pipelines defined in workspace.yaml.
              </div>
            ) : (
              pipelines.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPipelineId(p.id)}
                  className={cn(
                    'flex w-full items-baseline gap-2 border-b border-border/50 px-2.5 py-1.5 text-left last:border-b-0',
                    pipelineId === p.id ? 'bg-primary/10' : 'hover:bg-accent/40',
                  )}
                >
                  <span className="font-mono text-[12px] font-medium text-foreground">
                    {p.id}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {p.stepCount} step{p.stepCount === 1 ? '' : 's'} · on_failure: {p.onFailure}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        Run id
      </label>
      <input
        ref={inputRef}
        type="text"
        value={runId}
        onChange={(e) => setRunId(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Typically the work key — e.g. DRM-2100"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      {error && trimmed && (
        <div className="mt-1.5 text-[10.5px] text-destructive">{error}</div>
      )}

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label="Start run" disabled={!!error} />
      </ModalFooter>
    </Modal>
  );
}
