/**
 * Webview-side type definitions mirroring the host's @aidlc/core shapes.
 * Copied (not imported) because @aidlc/core targets Node and is bundled
 * into the host. The types are stable enough to keep in sync manually.
 */

export type ThemeMode = 'auto' | 'light' | 'dark';

export type StepStatus =
  | 'pending'
  | 'awaiting_work'
  | 'awaiting_auto_review'
  | 'awaiting_review'
  | 'approved'
  | 'rejected';

export type RunStatus = 'running' | 'completed' | 'failed';

/** Status normalized for the StatusBadge UI component. */
export type UiStatus =
  | 'in_progress'
  | 'done'
  | 'rejected'
  | 'pending'
  | 'awaiting_review'
  | 'awaiting_work';

export interface ArtifactPath {
  path: string;
  exists: boolean;
}

export interface ActiveRun {
  runId: string;
  pipelineId: string;
  currentStepIdx: number;
  totalSteps: number;
  currentAgent: string;
  stepAgents: string[];
  currentStepStatus: StepStatus | string;
  revision: number;
  rejectReason?: string;
  produces: ArtifactPath[];
  requires: ArtifactPath[];
  currentSlashCommand?: string;
}

export interface RecentEpicRef {
  id: string;
  title: string;
  status: string;
  statePath: string;
}

export interface SlashCommandRef {
  name: string;
  target: string;
}

export interface TemplateRef {
  id: string;
  name: string;
  description: string;
}

export interface PipelineRef {
  id: string;
  stepCount: number;
  onFailure: 'stop' | 'continue';
}

export interface SkillTemplateRef {
  id: string;
  description: string;
}

export interface SidebarState {
  hasFolder: boolean;
  workspaceName: string;
  configExists: boolean;
  agentsCount: number;
  skillsCount: number;
  pipelinesCount: number;
  epicsCount: number;
  recentEpics: RecentEpicRef[];
  slashCommands: SlashCommandRef[];
  builtinTemplates: TemplateRef[];
  projectTemplates: TemplateRef[];
  activeRuns: ActiveRun[];
  /** Lightweight pipeline list for the inline Start-Run modal. */
  pipelines: PipelineRef[];
  /** All existing run ids (any status) — used by the modal to validate uniqueness. */
  runIds: string[];
}

export type AssetScope = 'project' | 'aidlc' | 'global';

export interface AgentSummary {
  id: string;
  scope: AssetScope;
  filePath: string;
  description?: string;
  skill?: string;
  model?: string;
  integrations?: string[];
}

export interface SkillSummary {
  id: string;
  scope: AssetScope;
  filePath: string;
  description?: string;
}

export interface PipelineStepSummary {
  agent: string;
  name?: string;
  enabled: boolean;
  produces: string[];
  requires: string[];
  human_review: boolean;
  auto_review: boolean;
  auto_review_runner?: string;
}

export interface PipelineSummary {
  id: string;
  steps: PipelineStepSummary[];
  on_failure: 'stop' | 'continue';
}

export interface AutoReviewVerdict {
  decision: 'pass' | 'reject';
  reason: string;
  at: string;
  runner: string;
}

export interface EpicStepDetailFull {
  agent: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  runStatus: StepStatus | null;
  isCurrentRunStep: boolean;
  rejectReason?: string;
  autoReviewVerdict?: AutoReviewVerdict;
  stepHasAutoReview: boolean;
  stepHasHumanReview: boolean;
  startedAt?: string;
  finishedAt?: string;
}

export interface EpicSummary {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  progress: number;
  statePath: string;
  stepDetails: EpicStepDetailFull[];
  currentStep: number;
  pipeline: string | null;
  agent: string | null;
  runId: string | null;
  inputs: Record<string, string>;
  epicDir: string;
  existingArtifacts: string[];
  createdAt: string;
}

export interface AgentMeta {
  name: string;
  description: string;
  inputs: string;
  outputs: string;
  artifact: string;
}

export interface WorkspaceState {
  hasFolder: boolean;
  workspaceName: string;
  configExists: boolean;
  agents: AgentSummary[];
  skills: SkillSummary[];
  pipelines: PipelineSummary[];
  epics: EpicSummary[];
  /** id → display metadata (pulled from workspace.yaml) for the step-detail card. */
  agentMeta: Record<string, AgentMeta>;
  /** id → slash command string (with leading /). First wins on duplicates. */
  slashCommandsByAgent: Record<string, string>;
  /** Counts for the tab badges. */
  agentsCount: number;
  skillsCount: number;
  pipelinesCount: number;
  epicsCount: number;
  /** All existing run ids (any status) — for inline Start-Run modal uniqueness check. */
  runIds: string[];
  /** Built-in skill templates surfaced for the inline AddSkill modal. */
  skillTemplates: SkillTemplateRef[];
  /** Initial view to render when the panel first opens. */
  initialView?: WorkspaceView;
}

export type WorkspaceView = 'builder' | 'epics';

export type EpicFilter = 'all' | 'in_progress' | 'pending' | 'done' | 'failed';

declare global {
  interface Window {
    __AIDLC_INITIAL_STATE__?: SidebarState | WorkspaceState;
    __AIDLC_INITIAL_THEME__?: ThemeMode;
    BRAND_ICON_URI?: string;
    EXTENSION_VERSION?: string;
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export interface VsCodeApi {
  postMessage(message: unknown): void;
  setState<T>(state: T): T;
  getState<T>(): T | undefined;
}

export {};
