import { useState } from 'react';
import {
  Play,
  Plus,
  X,
  ArrowUp,
  ArrowDown,
  Settings,
  Bot,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PipelineSummary, PipelineStepSummary } from '@/lib/types';
import { postMessage } from '@/lib/bridge';

export function PipelineCard({ pipeline }: { pipeline: PipelineSummary }) {
  const total = pipeline.steps.length;
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <div className="font-mono text-xs font-bold text-primary">{pipeline.id}</div>
        <span className="text-[10px] text-muted-foreground">{total} steps</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => postMessage({ type: 'runPipeline', pipelineId: pipeline.id })}
          title="Start a pipeline run for this workflow"
          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary hover:border-primary/60 hover:bg-primary/25"
        >
          <Play className="h-2.5 w-2.5" />
          Run
        </button>
        <button
          type="button"
          onClick={() => postMessage({ type: 'togglePipelineFailure', pipelineId: pipeline.id })}
          title="Click to toggle on_failure between stop and continue"
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            pipeline.on_failure === 'stop'
              ? 'border-warning/40 bg-warning/15 text-warning'
              : 'border-border bg-secondary text-muted-foreground',
          )}
        >
          on_failure: {pipeline.on_failure}
        </button>
        <button
          type="button"
          onClick={() => postMessage({ type: 'deletePipeline', id: pipeline.id })}
          title="Delete workflow"
          className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto py-3">
        {pipeline.steps.map((step, i) => (
          <FlowNode
            key={`${pipeline.id}-${i}-${step.agent}`}
            step={step}
            idx={i}
            total={total}
            pipelineId={pipeline.id}
            isDragging={dragSrc === i}
            isDragOver={dragOver === i && dragSrc !== null && dragSrc !== i}
            onDragStart={() => setDragSrc(i)}
            onDragEnd={() => {
              setDragSrc(null);
              setDragOver(null);
            }}
            onDragEnter={() => {
              if (dragSrc !== null && dragSrc !== i) setDragOver(i);
            }}
            onDrop={() => {
              if (dragSrc !== null && dragSrc !== i) {
                postMessage({
                  type: 'reorderStep',
                  pipelineId: pipeline.id,
                  fromIdx: dragSrc,
                  toIdx: i,
                });
              }
              setDragSrc(null);
              setDragOver(null);
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => postMessage({ type: 'addStepToPipeline', pipelineId: pipeline.id })}
          title="Append a step to this workflow"
          className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-dashed border-primary/40 bg-primary/5 text-primary transition-all hover:scale-110 hover:border-primary/70 hover:border-solid hover:bg-primary/15"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FlowNode({
  step,
  idx,
  total,
  pipelineId,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
}: {
  step: PipelineStepSummary;
  idx: number;
  total: number;
  pipelineId: string;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
}) {
  const requires = step.requires.length;
  const produces = step.produces.length;
  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragEnter={onDragEnter}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
        className={cn(
          'group relative flex min-w-[150px] max-w-[240px] shrink-0 cursor-grab flex-col gap-1.5 rounded-lg border-2 bg-gradient-to-br from-primary/5 to-transparent p-2 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:from-primary/10 active:cursor-grabbing',
          step.enabled
            ? 'border-primary/25'
            : 'border-dashed border-primary/20 opacity-60',
          isDragging && 'opacity-35',
          isDragOver && '-translate-y-0.5 border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="w-3.5 shrink-0 font-mono text-[9.5px] text-muted-foreground">
            {idx + 1}
          </span>
          <span className="flex-1 truncate font-mono text-[11.5px] font-bold text-primary">
            {step.agent}
          </span>
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <NodeIcon
              title="Configure step (human review, auto review, requires, produces)"
              onClick={() => postMessage({ type: 'editStepConfig', pipelineId, idx })}
            >
              <Settings className="h-2.5 w-2.5" />
            </NodeIcon>
            {idx > 0 && (
              <NodeIcon
                title="Move up"
                onClick={() =>
                  postMessage({ type: 'reorderStep', pipelineId, fromIdx: idx, toIdx: idx - 1 })
                }
              >
                <ArrowUp className="h-2.5 w-2.5" />
              </NodeIcon>
            )}
            {idx < total - 1 && (
              <NodeIcon
                title="Move down"
                onClick={() =>
                  postMessage({ type: 'reorderStep', pipelineId, fromIdx: idx, toIdx: idx + 1 })
                }
              >
                <ArrowDown className="h-2.5 w-2.5" />
              </NodeIcon>
            )}
            <NodeIcon
              title="Remove from workflow"
              danger
              onClick={() => postMessage({ type: 'deleteStep', pipelineId, idx })}
            >
              <X className="h-2.5 w-2.5" />
            </NodeIcon>
          </div>
        </div>

        {(requires > 0 || produces > 0 || step.auto_review || step.human_review || !step.enabled) && (
          <div className="flex flex-wrap gap-1">
            {!step.enabled && (
              <Badge title="enabled: false — runner skips this step">disabled</Badge>
            )}
            {requires > 0 && (
              <Badge title={`${requires} upstream artifact path(s) the step is gated on`}>
                ⤴ {requires} req
              </Badge>
            )}
            {produces > 0 && (
              <Badge title={`${produces} artifact path(s) this step writes`}>
                ⤵ {produces} out
              </Badge>
            )}
            {step.auto_review && (
              <Badge
                color="info"
                title={`auto_review: true${step.auto_review_runner ? ` — runs ${step.auto_review_runner}` : ''}`}
              >
                <Bot className="mr-0.5 inline h-2.5 w-2.5" /> auto
              </Badge>
            )}
            {step.human_review && (
              <Badge
                color="warning"
                title="human_review: true — pauses for approve/reject after the step is marked done"
              >
                <User className="mr-0.5 inline h-2.5 w-2.5" /> human
              </Badge>
            )}
          </div>
        )}
      </div>
      {idx < total - 1 && (
        <div className="relative h-0.5 w-6 shrink-0 rounded-full bg-gradient-to-r from-primary/55 to-primary/20">
          <span
            aria-hidden
            className="absolute -right-px top-1/2 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent border-l-primary/45"
          />
        </div>
      )}
    </>
  );
}

function NodeIcon({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors',
        danger
          ? 'hover:bg-destructive/15 hover:text-destructive'
          : 'hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  title,
  color,
}: {
  children: React.ReactNode;
  title: string;
  color?: 'info' | 'warning';
}) {
  return (
    <span
      title={title}
      className={cn(
        'whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9.5px]',
        color === 'info' && 'border-info/30 bg-info/10 text-info',
        color === 'warning' && 'border-warning/30 bg-warning/10 text-warning',
        !color && 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}
