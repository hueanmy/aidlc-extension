import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Inbox,
  Outdent,
  FileText,
  Terminal,
  Copy,
  Bot,
  User,
  ExternalLink,
  Folder,
  Play,
  History,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  EpicSummary,
  EpicStepDetailFull,
  AgentMeta,
  StepHistoryEntry,
  StepStatus,
  UiStatus,
} from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { RejectModal } from './RejectModal';
import { RerunModal } from './RerunModal';
import { postMessage } from '@/lib/bridge';

function epicUiStatus(status: EpicSummary['status']): UiStatus {
  switch (status) {
    case 'in_progress':
      return 'in_progress';
    case 'done':
      return 'done';
    case 'failed':
      return 'rejected';
    default:
      return 'pending';
  }
}

function runStatusUi(status: StepStatus | null): UiStatus | null {
  if (!status || status === 'pending' || status === 'approved') { return null; }
  if (status === 'awaiting_work') { return 'awaiting_work'; }
  if (status === 'awaiting_auto_review' || status === 'awaiting_review') { return 'awaiting_review'; }
  if (status === 'rejected') { return 'rejected'; }
  return null;
}

const STEP_LABEL: Record<EpicStepDetailFull['status'], string> = {
  pending: 'pending',
  in_progress: 'in progress',
  done: 'done',
  failed: 'failed',
};

interface Props {
  epic: EpicSummary;
  agentMeta: Record<string, AgentMeta>;
  slashCommandsByAgent: Record<string, string>;
}

export function EpicCard({ epic, agentMeta, slashCommandsByAgent }: Props) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(epic.currentStep ?? 0);
  const ui = epicUiStatus(epic.status);
  const total = epic.stepDetails.length;
  const done = epic.stepDetails.filter((s) => s.status === 'done').length;
  const focused = total > 0 ? epic.stepDetails[focusedIdx] : null;
  const inputKeys = Object.keys(epic.inputs || {});

  return (
    <div className="group relative rounded-lg border border-border bg-card transition-all hover:border-primary/30">
      <div
        className={cn(
          'absolute left-0 top-0 h-full w-0.5 rounded-l-lg',
          epic.status === 'in_progress' && 'bg-primary',
          epic.status === 'done' && 'bg-success',
          epic.status === 'failed' && 'bg-destructive',
          epic.status === 'pending' && 'bg-muted-foreground',
        )}
      />

      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 font-mono text-xs font-bold text-primary">{epic.id}</span>
          <span className="truncate text-sm text-foreground">{epic.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  epic.status === 'done' ? 'bg-success' : 'bg-primary',
                )}
                style={{ width: `${epic.progress}%` }}
              />
            </div>
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {epic.progress}%
            </span>
          </div>
          <StatusBadge status={ui} />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label={expanded ? 'Collapse epic' : 'Expand epic'}
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-5 py-4">
          {epic.description && (
            <p className="text-xs italic leading-relaxed text-muted-foreground">
              {epic.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {epic.pipeline && (
              <span>
                Pipeline:{' '}
                <strong className="text-foreground">{epic.pipeline}</strong>
              </span>
            )}
            {!epic.pipeline && epic.agent && (
              <span>
                Agent: <strong className="text-foreground">{epic.agent}</strong>
              </span>
            )}
            {total > 0 && (
              <span>
                · <strong className="text-foreground">{done}/{total}</strong> steps done
              </span>
            )}
            {epic.createdAt && (
              <span>
                · Started{' '}
                <strong className="text-foreground">{epic.createdAt.slice(0, 10)}</strong>
              </span>
            )}
          </div>

          {total > 0 && (
            <Stepper
              steps={epic.stepDetails}
              currentStep={epic.currentStep}
              focusedIdx={focusedIdx}
              onFocus={setFocusedIdx}
            />
          )}

          {focused && (
            <StepDetail
              epic={epic}
              focusedIdx={focusedIdx}
              focused={focused}
              meta={agentMeta[focused.agent]}
              slashCommand={slashCommandsByAgent[focused.agent]}
            />
          )}

          {inputKeys.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Inputs
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
                {inputKeys.map((k) => (
                  <Frag key={k} keyName={k} value={epic.inputs[k]} />
                ))}
              </div>
            </div>
          )}

          <EpicActions epic={epic} hasInputs={inputKeys.length > 0} />
        </div>
      )}
    </div>
  );
}

function Frag({ keyName, value }: { keyName: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{keyName}</span>
      <span className="break-all text-foreground">{value}</span>
    </>
  );
}

function Stepper({
  steps,
  currentStep,
  focusedIdx,
  onFocus,
}: {
  steps: EpicStepDetailFull[];
  currentStep: number;
  focusedIdx: number;
  onFocus: (idx: number) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface/50 p-3">
      <div className="flex min-w-max items-start justify-center gap-0">
        {steps.map((step, i) => {
          const isCurrent = i === currentStep;
          const isFocused = i === focusedIdx;
          const inner =
            step.status === 'done'
              ? <Check className="h-3.5 w-3.5" />
              : step.status === 'failed'
              ? <X className="h-3.5 w-3.5" />
              : i + 1;
          return (
            <div key={`${step.agent}-${i}`} className="flex items-center">
              {i > 0 && (
                <div
                  className={cn(
                    'h-0.5 w-10',
                    step.status === 'done' || steps[i - 1].status === 'done'
                      ? 'bg-primary'
                      : 'bg-border',
                  )}
                />
              )}
              <button
                type="button"
                onClick={() => onFocus(i)}
                className="group flex flex-col items-center gap-1 px-1"
                title={`${step.agent} — ${STEP_LABEL[step.status]}`}
              >
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all',
                    step.status === 'done' && 'bg-primary text-primary-foreground',
                    step.status === 'in_progress' &&
                      'bg-warning text-warning-foreground shadow-[0_0_14px_color-mix(in_oklab,var(--color-warning)_40%,transparent)]',
                    step.status === 'failed' && 'bg-destructive text-destructive-foreground',
                    step.status === 'pending' &&
                      'border-2 border-border bg-card text-muted-foreground',
                    isCurrent && 'scale-110',
                    isFocused && 'ring-4 ring-primary/30',
                  )}
                >
                  {inner}
                </div>
                <span
                  className={cn(
                    'max-w-[80px] truncate text-center text-[9px] font-bold uppercase tracking-wider',
                    isFocused
                      ? 'text-primary'
                      : step.status === 'done' || step.status === 'in_progress'
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {step.agent}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepDetail({
  epic,
  focusedIdx,
  focused,
  meta,
  slashCommand,
}: {
  epic: EpicSummary;
  focusedIdx: number;
  focused: EpicStepDetailFull;
  meta: AgentMeta | undefined;
  slashCommand: string | undefined;
}) {
  const total = epic.stepDetails.length;
  const ui = (() => {
    if (focused.status === 'done') { return 'done' as const; }
    if (focused.status === 'in_progress') { return 'in_progress' as const; }
    if (focused.status === 'failed') { return 'rejected' as const; }
    return 'pending' as const;
  })();
  const m = meta ?? { name: focused.agent, description: '', inputs: '', outputs: '', artifact: '' };
  const artifactExists = m.artifact ? epic.existingArtifacts.includes(m.artifact) : false;

  const accent = (() => {
    switch (focused.status) {
      case 'in_progress':
        return 'border-l-warning';
      case 'done':
        return 'border-l-success';
      case 'failed':
        return 'border-l-destructive';
      default:
        return 'border-l-border';
    }
  })();

  return (
    <div className={cn('rounded-md border border-border border-l-[3px] bg-surface/50 p-4', accent)}>
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Step {focusedIdx + 1}/{total}
        </span>
        <span className="flex-1 truncate text-sm font-bold text-foreground">{m.name}</span>
        <StatusBadge status={ui} />
      </div>

      {m.description && (
        <p className="mt-2 text-[11.5px] italic leading-relaxed text-muted-foreground">
          {m.description}
        </p>
      )}

      <div className="mt-3 grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 text-[11.5px]">
        <DetailLabel icon={<Inbox className="h-3 w-3" />} text="Input" />
        <DetailValue empty={!m.inputs}>{m.inputs || '—'}</DetailValue>

        <DetailLabel icon={<Outdent className="h-3 w-3" />} text="Output" />
        <DetailValue empty={!m.outputs}>{m.outputs || '—'}</DetailValue>

        <DetailLabel icon={<FileText className="h-3 w-3" />} text="Artifact" />
        {m.artifact ? (
          artifactExists ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                postMessage({
                  type: 'openArtifactFile',
                  epicDir: epic.epicDir,
                  filename: m.artifact,
                });
              }}
              className="inline-flex w-fit items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary transition-colors hover:border-primary/50 hover:bg-primary/20"
              title={`Open ${m.artifact} in a new tab`}
            >
              <span>{m.artifact}</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-70" />
            </button>
          ) : (
            <div
              className="inline-flex w-fit items-center rounded border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] italic text-muted-foreground opacity-70"
              title="File not produced yet — will land in artifacts/ when this step runs"
            >
              {m.artifact} · not produced yet
            </div>
          )
        ) : (
          <div className="font-mono text-[11px] italic text-muted-foreground">—</div>
        )}

        {slashCommand && (
          <>
            <DetailLabel icon={<Terminal className="h-3 w-3" />} text="Command" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                postMessage({ type: 'copyCommand', command: slashCommand });
              }}
              title="Click to copy — paste into Claude to run this step"
              className="inline-flex w-fit items-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary transition-colors hover:border-primary/50 hover:bg-primary/20"
            >
              <span>{slashCommand}</span>
              <Copy className="h-2.5 w-2.5 opacity-70" />
            </button>
          </>
        )}
      </div>

      <RunGate epic={epic} focused={focused} slashCommand={slashCommand} />
      <StepHistory step={focused} />
    </div>
  );
}

function DetailLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function StepHistory({ step }: { step: EpicStepDetailFull }) {
  const [open, setOpen] = useState(false);
  const entries = step.history ?? [];
  if (entries.length === 0) { return null; }

  const rejectCount = step.rejectCount ?? 0;
  const rerunCount = entries.filter((e) => e.kind === 'rerun').length;
  const lastReject = [...entries].reverse().find((e) => e.kind === 'reject') as
    | (StepHistoryEntry & { kind: 'reject' })
    | undefined;

  const summary = [
    rejectCount > 0 && `rejected ${rejectCount}×`,
    rerunCount > 0 && `rerun ${rerunCount}×`,
    !rejectCount && entries.some((e) => e.kind === 'approve') && 'approved',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mt-3 rounded-md border border-border bg-secondary/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-accent/40"
      >
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <History className="h-3 w-3 text-muted-foreground" />
        <span className="font-bold uppercase tracking-wider text-muted-foreground">
          History
        </span>
        <span className="text-muted-foreground/80">· {entries.length} entries</span>
        {summary && <span className="text-muted-foreground/80">· {summary}</span>}
        {lastReject?.reason && !open && (
          <span className="ml-auto truncate font-mono text-[10.5px] text-destructive/80 max-w-[55%]">
            ↳ {lastReject.reason}
          </span>
        )}
      </button>

      {open && (
        <ol className="border-t border-border/60 px-3 py-2 space-y-1.5 text-[10.5px]">
          {entries.map((e, i) => (
            <li key={i} className="flex items-start gap-2">
              <HistoryIcon kind={e.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <HistoryLabel entry={e} />
                  <span className="text-[9.5px] text-muted-foreground tabular-nums">
                    rev {e.revision}
                  </span>
                  <span className="ml-auto text-[9.5px] text-muted-foreground/80">
                    {fmtTime(e.at)}
                  </span>
                </div>
                <HistoryBody entry={e} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HistoryIcon({ kind }: { kind: StepHistoryEntry['kind'] }) {
  switch (kind) {
    case 'reject':
      return <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />;
    case 'rerun':
      return <RefreshCw className="mt-0.5 h-3 w-3 shrink-0 text-warning" />;
    case 'auto_review':
      return <Bot className="mt-0.5 h-3 w-3 shrink-0 text-info" />;
    case 'approve':
      return <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />;
  }
}

function HistoryLabel({ entry }: { entry: StepHistoryEntry }) {
  switch (entry.kind) {
    case 'reject':
      return (
        <span className="font-semibold text-destructive">
          Rejected
          {entry.sentBackToIdx !== undefined && (
            <span className="ml-1 font-normal text-muted-foreground">
              → step {entry.sentBackToIdx + 1}
            </span>
          )}
        </span>
      );
    case 'rerun':
      return <span className="font-semibold text-warning">Rerun</span>;
    case 'auto_review':
      return (
        <span className={cn('font-semibold', entry.decision === 'pass' ? 'text-success' : 'text-destructive')}>
          Auto-review {entry.decision === 'pass' ? '✓ pass' : '✕ reject'}
        </span>
      );
    case 'approve':
      return <span className="font-semibold text-success">Approved</span>;
  }
}

function HistoryBody({ entry }: { entry: StepHistoryEntry }) {
  switch (entry.kind) {
    case 'reject':
      return entry.reason ? (
        <div className="font-mono text-foreground/80">↳ {entry.reason}</div>
      ) : null;
    case 'rerun':
      return entry.feedback ? (
        <div className="font-mono text-muted-foreground">↳ {entry.feedback}</div>
      ) : null;
    case 'auto_review':
      return (
        <div className="font-mono text-foreground/80">
          ↳ {entry.reason}
        </div>
      );
    case 'approve':
      return null;
  }
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) { return iso; }
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function DetailValue({ children, empty }: { children: React.ReactNode; empty?: boolean }) {
  return (
    <div className={cn('leading-relaxed', empty ? 'text-muted-foreground italic' : 'text-foreground')}>
      {children}
    </div>
  );
}

function RunGate({
  epic,
  focused,
  slashCommand,
}: {
  epic: EpicSummary;
  focused: EpicStepDetailFull;
  slashCommand: string | undefined;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  if (!epic.runId || !focused.isCurrentRunStep) { return null; }
  const ui = runStatusUi(focused.runStatus);
  if (!ui) { return null; }

  const status = focused.runStatus!;
  const labels: Record<string, string> = {
    awaiting_work: 'Awaiting work',
    awaiting_auto_review: 'Awaiting auto-review',
    awaiting_review: 'Awaiting human review',
    rejected: 'Rejected',
  };
  const messages: Record<string, string> = {
    awaiting_work: 'Run the agent externally, then mark this step done to advance.',
    awaiting_auto_review: 'Auto-reviewer pending. Run it to validate this step.',
    awaiting_review:
      'Step is paused for your approval. Approve to advance, reject to send back.',
    rejected: 'This step was rejected. Rerun to bump revision and try again.',
  };

  const cls = (() => {
    if (status === 'awaiting_work') {
      return 'bg-primary/5 border-primary/30 text-primary';
    }
    if (status === 'awaiting_auto_review' || status === 'awaiting_review') {
      return 'bg-warning/10 border-warning/40 text-warning';
    }
    if (status === 'rejected') {
      return 'bg-destructive/5 border-destructive/40 text-destructive';
    }
    return 'bg-muted border-border text-muted-foreground';
  })();

  const gates: string[] = [];
  if (focused.stepHasAutoReview) { gates.push('🤖 auto-review'); }
  if (focused.stepHasHumanReview) { gates.push('👤 human review'); }

  return (
    <div className={cn('mt-4 space-y-2 rounded-md border p-3 text-[11.5px]', cls)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-wider">
          {labels[status] ?? status}
        </span>
        <span className="flex-1 text-foreground/80">{messages[status]}</span>
      </div>

      {status === 'rejected' && focused.rejectReason && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 font-mono text-[10.5px] text-destructive">
          ↳ {focused.rejectReason}
        </div>
      )}

      {status === 'awaiting_work' && focused.feedback && (
        <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 font-mono text-[10.5px] text-warning">
          ↳ {focused.feedback}
        </div>
      )}

      {focused.autoReviewVerdict && (
        <div
          className={cn(
            'rounded border px-2 py-1.5 text-[11px]',
            focused.autoReviewVerdict.decision === 'pass'
              ? 'border-success/30 bg-success/10'
              : 'border-destructive/40 bg-destructive/10',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-1 font-semibold',
              focused.autoReviewVerdict.decision === 'pass' ? 'text-success' : 'text-destructive',
            )}
          >
            {focused.autoReviewVerdict.decision === 'pass' ? (
              <Bot className="h-3 w-3" />
            ) : (
              <Bot className="h-3 w-3" />
            )}
            <span>
              Auto-review:{' '}
              {focused.autoReviewVerdict.decision === 'pass' ? '✓ pass' : '✕ reject'}
            </span>
          </div>
          {focused.autoReviewVerdict.reason && (
            <div className="text-foreground/80">{focused.autoReviewVerdict.reason}</div>
          )}
        </div>
      )}

      {gates.length > 0 ? (
        <div className="text-[10.5px] italic text-foreground/70">
          Gates after Mark done: {gates.join(' → ')}
        </div>
      ) : status === 'awaiting_work' ? (
        <div className="text-[10.5px] italic text-muted-foreground">
          No review gates configured — Mark done will auto-approve and advance.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === 'awaiting_work' && (
          <>
            <GateButton
              variant="primary"
              onClick={() => postMessage({ type: 'markStepDone', runId: epic.runId! })}
            >
              Mark step done
            </GateButton>
            {focused.feedback && slashCommand && (
              <GateButton
                variant="approve"
                onClick={() =>
                  postMessage({
                    type: 'runStepWithFeedback',
                    runId: epic.runId!,
                    slashCommand,
                    feedback: focused.feedback,
                  })
                }
              >
                <RefreshCw className="h-3 w-3" /> Update with feedback
              </GateButton>
            )}
          </>
        )}
        {status === 'awaiting_auto_review' && (
          <GateButton
            variant="primary"
            onClick={() => postMessage({ type: 'runAutoReview', runId: epic.runId! })}
          >
            Run auto-review
          </GateButton>
        )}
        {status === 'awaiting_review' && (
          <>
            <GateButton
              variant="approve"
              onClick={() => postMessage({ type: 'approveStep', runId: epic.runId! })}
            >
              <Check className="h-3 w-3" /> Approve
            </GateButton>
            <GateButton
              variant="reject"
              onClick={() => setRejectOpen(true)}
            >
              <X className="h-3 w-3" /> Reject
            </GateButton>
          </>
        )}
        {status === 'rejected' && (
          <GateButton variant="primary" onClick={() => setRerunOpen(true)}>
            Rerun
          </GateButton>
        )}
      </div>

      {rejectOpen && epic.runId && (
        <RejectModal
          runId={epic.runId}
          currentStepIdx={epic.currentStep}
          stepAgents={epic.stepDetails.map((d) => d.agent)}
          onClose={() => setRejectOpen(false)}
        />
      )}
      {rerunOpen && epic.runId && (
        <RerunModal
          runId={epic.runId}
          agent={focused.agent}
          rejectReason={focused.rejectReason}
          onSubmit={(feedback) =>
            postMessage({ type: 'rerunStepInline', runId: epic.runId!, feedback })
          }
          onClose={() => setRerunOpen(false)}
        />
      )}
    </div>
  );
}

function GateButton({
  children,
  variant,
  onClick,
}: {
  children: React.ReactNode;
  variant: 'primary' | 'approve' | 'reject';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-semibold transition-colors',
        variant === 'primary' &&
          'border-primary/40 bg-primary/15 text-primary hover:border-primary/60 hover:bg-primary/25',
        variant === 'approve' &&
          'border-success/40 bg-success/15 text-success hover:border-success/60 hover:bg-success/25',
        variant === 'reject' &&
          'border-destructive/40 bg-destructive/15 text-destructive hover:border-destructive/60 hover:bg-destructive/25',
      )}
    >
      {children}
    </button>
  );
}

function EpicActions({ epic, hasInputs }: { epic: EpicSummary; hasInputs: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {!epic.runId && epic.pipeline && (
        <button
          type="button"
          onClick={() =>
            postMessage({
              type: 'startPipelineRunForEpic',
              epicId: epic.id,
              pipelineId: epic.pipeline,
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
        >
          <Play className="h-3 w-3" />
          Start pipeline run
        </button>
      )}
      <button
        type="button"
        onClick={() => postMessage({ type: 'openEpicState', path: epic.statePath })}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <FileText className="h-3 w-3" />
        Open state.json
      </button>
      {hasInputs && (
        <button
          type="button"
          onClick={() => postMessage({ type: 'openInputsJson', epicDir: epic.epicDir })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FileText className="h-3 w-3" />
          Open inputs.json
        </button>
      )}
      <button
        type="button"
        onClick={() => postMessage({ type: 'revealArtifacts', epicDir: epic.epicDir })}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Folder className="h-3 w-3" />
        Reveal artifacts
      </button>
    </div>
  );
}

// Suppress unused-import warnings for icons that are conditionally referenced.
const _ICONS = { ChevronDown, User };
void _ICONS;
