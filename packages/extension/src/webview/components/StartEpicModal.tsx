import { useEffect, useMemo, useRef, useState } from 'react';
import { ListOrdered, User, ChevronRight, FileUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentMeta, AgentSummary, PipelineSummary } from '@/lib/types';
import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';
import { pickAndReadFile } from '@/lib/pickFile';

const ID_PATTERN = /^[A-Z][A-Z0-9-]*$/;

interface CapabilityPrompt {
  prompt: string;
  placeholder: string;
  defaultValue?: string;
}

const CAPABILITY_PROMPTS: Record<string, CapabilityPrompt> = {
  jira: { prompt: 'Jira ticket key or URL', placeholder: 'PROJ-123 or https://acme.atlassian.net/browse/PROJ-123' },
  figma: { prompt: 'Figma file URL or file key', placeholder: 'https://www.figma.com/file/abc123/...' },
  'core-business': { prompt: 'Path to core business docs (relative)', placeholder: 'docs/core', defaultValue: 'docs/core' },
  github: { prompt: 'GitHub repo or PR URL', placeholder: 'owner/repo or https://github.com/owner/repo/pull/42' },
  slack: { prompt: 'Slack channel or thread URL', placeholder: '#engineering or https://slack.com/...' },
  files: { prompt: 'Files glob (relative to project root)', placeholder: 'src/**/*.ts' },
  web: { prompt: 'URLs to fetch (comma-separated, optional)', placeholder: 'https://example.com/...' },
};

export type EpicTargetKind = 'pipeline' | 'agent';

export interface StartEpicDraft {
  target: { kind: EpicTargetKind; id: string };
  epicId: string;
  title: string;
  description: string;
  inputs: Record<string, string>;
}

interface Props {
  pipelines: PipelineSummary[];
  agents: AgentSummary[];
  agentMeta: Record<string, AgentMeta>;
  nextEpicId: string;
  existingEpicIds: string[];
  onSubmit: (draft: StartEpicDraft) => void;
  onClose: () => void;
}

export function StartEpicModal({
  pipelines,
  agents,
  agentMeta,
  nextEpicId,
  existingEpicIds,
  onSubmit,
  onClose,
}: Props) {
  // Default to pipeline tab when any pipelines exist; fall back to agent.
  const [tab, setTab] = useState<EpicTargetKind>(pipelines.length > 0 ? 'pipeline' : 'agent');
  const [pipelineId, setPipelineId] = useState<string>(pipelines[0]?.id ?? '');
  const aidlcAgents = useMemo(() => agents.filter((a) => a.scope === 'aidlc'), [agents]);
  const [agentId, setAgentId] = useState<string>(aidlcAgents[0]?.id ?? '');
  const [epicId, setEpicId] = useState(nextEpicId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const idInputRef = useRef<HTMLInputElement>(null);
  // Load-from-file UX state for the description textarea — null when idle,
  // loading shows a spinner, error/loaded surface a small line under the
  // textarea so the user knows what landed.
  const [descLoading, setDescLoading] = useState(false);
  const [descLoadInfo, setDescLoadInfo] = useState<{
    kind: 'loaded' | 'error';
    text: string;
  } | null>(null);

  const onLoadDescriptionFromFile = async () => {
    setDescLoading(true);
    setDescLoadInfo(null);
    try {
      const result = await pickAndReadFile();
      if (!result) { return; } // cancelled
      setDescription(result.content);
      setDescLoadInfo({
        kind: 'loaded',
        text: `Loaded ${result.fileName} (${formatBytes(result.byteLength)})`,
      });
    } catch (err) {
      setDescLoadInfo({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDescLoading(false);
    }
  };

  useEffect(() => {
    idInputRef.current?.focus();
    idInputRef.current?.select();
  }, []);

  // Combined capability list for the chosen target. Order = first-seen across
  // the agents involved; deduped.
  const capabilities = useMemo<string[]>(() => {
    const targetAgents: string[] =
      tab === 'pipeline'
        ? pipelines.find((p) => p.id === pipelineId)?.steps.map((s) => s.agent) ?? []
        : agentId ? [agentId] : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of targetAgents) {
      const caps = agentMeta[a]?.capabilities ?? [];
      for (const c of caps) {
        if (!seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
    }
    return out;
  }, [tab, pipelineId, agentId, pipelines, agentMeta]);

  // Apply CAPABILITY_PROMPTS defaults the first time a capability appears.
  useEffect(() => {
    setInputs((cur) => {
      const next = { ...cur };
      let changed = false;
      for (const cap of capabilities) {
        if (!(cap in next)) {
          const def = CAPABILITY_PROMPTS[cap]?.defaultValue ?? '';
          if (def) {
            next[cap] = def;
            changed = true;
          }
        }
      }
      return changed ? next : cur;
    });
  }, [capabilities]);

  const trimmedId = epicId.trim();
  const idError = useMemo(() => {
    if (!trimmedId) { return 'Epic id is required'; }
    if (!ID_PATTERN.test(trimmedId)) {
      return 'Uppercase letters / digits / dashes only — must start with a letter';
    }
    if (existingEpicIds.includes(trimmedId)) {
      return `Epic "${trimmedId}" already exists`;
    }
    return null;
  }, [trimmedId, existingEpicIds]);

  const targetError =
    tab === 'pipeline' && !pipelineId
      ? 'Pick a pipeline'
      : tab === 'agent' && !agentId
      ? 'Pick an agent'
      : null;

  const error = idError || targetError;

  const submit = () => {
    if (error) { return; }
    const target = tab === 'pipeline'
      ? { kind: 'pipeline' as const, id: pipelineId }
      : { kind: 'agent' as const, id: agentId };
    const cleanInputs: Record<string, string> = {};
    for (const cap of capabilities) {
      const v = (inputs[cap] ?? '').trim();
      if (v) { cleanInputs[cap] = v; }
    }
    onSubmit({
      target,
      epicId: trimmedId,
      title: title.trim(),
      description: description.trim(),
      inputs: cleanInputs,
    });
    onClose();
  };

  return (
    <Modal title="Start epic" maxWidth="max-w-2xl" onClose={onClose} onSubmit={submit}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Target
          </label>
          <div className="mb-2 flex gap-1.5 rounded-md border border-border bg-secondary/30 p-1">
            <TabButton
              active={tab === 'pipeline'}
              onClick={() => setTab('pipeline')}
              icon={<ListOrdered className="h-3 w-3" />}
              label="Pipeline"
              count={pipelines.length}
            />
            <TabButton
              active={tab === 'agent'}
              onClick={() => setTab('agent')}
              icon={<User className="h-3 w-3" />}
              label="Single agent"
              count={aidlcAgents.length}
            />
          </div>

          {tab === 'pipeline' ? (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border">
              {pipelines.length === 0 ? (
                <Empty hint="No pipelines defined in workspace.yaml." />
              ) : (
                pipelines.map((p) => {
                  const steps = p.steps.map((s) => s.agent);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPipelineId(p.id)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-2.5 py-1.5 text-left last:border-b-0',
                        pipelineId === p.id ? 'bg-primary/10' : 'hover:bg-accent/40',
                      )}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[12px] font-medium text-foreground">
                          {p.id}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {steps.length} agent{steps.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                        {steps.join(' → ')}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border">
              {aidlcAgents.length === 0 ? (
                <Empty hint="No AIDLC agents in workspace.yaml." />
              ) : (
                aidlcAgents.map((a) => {
                  const m = agentMeta[a.id];
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAgentId(a.id)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-2.5 py-1.5 text-left last:border-b-0',
                        agentId === a.id ? 'bg-primary/10' : 'hover:bg-accent/40',
                      )}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[12px] font-medium text-foreground">
                          {a.id}
                        </span>
                        {m?.name && m.name !== a.id && (
                          <span className="text-[10px] text-muted-foreground">{m.name}</span>
                        )}
                      </div>
                      {a.description && (
                        <div className="truncate text-[10.5px] text-muted-foreground">
                          {a.description}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Epic id
            </label>
            <input
              ref={idInputRef}
              type="text"
              value={epicId}
              onChange={(e) => setEpicId(e.target.value)}
              placeholder="EPIC-001"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            {idError && trimmedId && (
              <div className="mt-1 text-[10.5px] text-destructive">{idError}</div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Title <span className="font-normal normal-case tracking-normal text-muted-foreground/80">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Add user profile page"'
              className="w-full rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Description / requirement <span className="font-normal normal-case tracking-normal text-muted-foreground/80">(optional)</span>
            </label>
            <button
              type="button"
              onClick={onLoadDescriptionFromFile}
              disabled={descLoading}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              title="Load contents of a text/markdown file into the description"
            >
              {descLoading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <FileUp className="h-2.5 w-2.5" />
              )}
              <span>Load from file…</span>
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste a requirement / PRD, or load it from a file. The text is snapshotted into the epic at submit time."
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-input/50 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          {descLoadInfo && (
            <div
              className={cn(
                'mt-1 text-[10px]',
                descLoadInfo.kind === 'loaded'
                  ? 'text-muted-foreground'
                  : 'text-destructive',
              )}
            >
              {descLoadInfo.text}
            </div>
          )}
        </div>

        {capabilities.length > 0 && (
          <div>
            <div className="mb-1 flex items-baseline gap-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                Capability inputs
              </span>
              <span className="text-[10px] text-muted-foreground">
                ({capabilities.length} from {tab === 'pipeline' ? 'pipeline' : 'agent'})
              </span>
            </div>
            <div className="space-y-2">
              {capabilities.map((cap) => {
                const meta = CAPABILITY_PROMPTS[cap];
                return (
                  <div key={cap}>
                    <div className="mb-0.5 flex items-baseline gap-1.5">
                      <span className="font-mono text-[10.5px] font-medium text-primary">{cap}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {meta?.prompt ?? `Value for capability \`${cap}\``}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={inputs[cap] ?? ''}
                      onChange={(e) =>
                        setInputs((cur) => ({ ...cur, [cap]: e.target.value }))
                      }
                      placeholder={meta?.placeholder ?? 'Value, or leave blank to skip'}
                      className="w-full rounded-md border border-border bg-input/50 px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label="Start epic" disabled={!!error} />
      </ModalFooter>
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums',
          active ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
      <ChevronRight className="h-3 w-3 shrink-0" />
      <span>{hint}</span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
