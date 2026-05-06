// AIDLC core — public exports.
//
// This package is pure TypeScript. No `import 'vscode'`. The extension layer
// (packages/extension) imports from here; the core has zero knowledge of the
// VS Code API and runs identically inside the extension host, a CLI, or a
// future test harness / cloud worker.

export {
  WorkspaceSchema,
  validateWorkspace,
  WorkspaceValidationError,
  normalizeStep,
  stepAgentId,
} from './schema/WorkspaceSchema';
export type {
  WorkspaceConfig,
  AgentConfig,
  SkillConfig,
  SlashCommandConfig,
  PipelineConfig,
  PipelineStepConfig,
  NormalizedStep,
  StateConfig,
  SidebarConfig,
  SidebarView,
} from './schema/WorkspaceSchema';

export {
  WorkspaceLoader,
  WorkspaceNotFoundError,
  WorkspaceParseError,
  WORKSPACE_FILENAME,
  WORKSPACE_DIR,
} from './loader/WorkspaceLoader';
export type {
  LoadedWorkspace,
  WorkspaceLoaderOptions,
} from './loader/WorkspaceLoader';

export {
  EnvResolver,
  EnvVarMissingError,
} from './loader/EnvResolver';
export type { EnvResolverOptions } from './loader/EnvResolver';

export {
  SkillLoader,
  SkillNotFoundError,
} from './loader/SkillLoader';
export type { SkillLoaderOptions } from './loader/SkillLoader';

export {
  discoverAssets,
  scopePaths,
  targetPath,
} from './loader/AssetDiscovery';
export type {
  AssetScope,
  AssetKind,
  DiscoveredAsset,
  DiscoveryResult,
} from './loader/AssetDiscovery';

export { RunnerRegistry } from './runner/RunnerRegistry';
export { DefaultRunner } from './runner/DefaultRunner';
export type { DefaultRunnerOptions } from './runner/DefaultRunner';
export {
  CustomRunnerLoader,
  validateRunnerExport,
} from './runner/CustomRunnerLoader';
export {
  RunnerValidationError,
} from './runner/types';
export type {
  AidlcRunner,
  RunnerContext,
  RunnerResult,
  ClaudeCliWrapper,
} from './runner/types';

// ── Pipeline runs (phase 1) ────────────────────────────────────────
export { RunStateStore, RUN_ID_PATTERN } from './runs/RunStateStore';
export {
  startRun,
  canStartStep,
  markStepDone,
  approveStep,
  rejectStep,
  rerunStep,
  submitAutoReviewVerdict,
  PipelineRunError,
} from './runs/PipelineRunner';
export { runAutoReview, AutoReviewerError } from './runs/AutoReviewer';
export type { AutoReviewerContext, AutoReviewerFn } from './runs/AutoReviewer';
export { resolvePath } from './runs/RunState';
export type {
  RunState,
  StepRecord,
  StepStatus,
  RunStatus,
  AutoReviewVerdict,
} from './runs/RunState';

export const AIDLC_CORE_VERSION = '0.1.0';
