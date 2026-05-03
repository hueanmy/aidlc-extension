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
} from './schema/WorkspaceSchema';
export type {
  WorkspaceConfig,
  AgentConfig,
  SkillConfig,
  SlashCommandConfig,
  PipelineConfig,
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

export const AIDLC_CORE_VERSION = '0.1.0';
