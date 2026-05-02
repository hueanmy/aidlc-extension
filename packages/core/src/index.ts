// AIDLC core — public exports.
//
// Phase 0: this is a placeholder. Phase 1 (M2) will add:
//   WorkspaceSchema, WorkspaceLoader, SkillLoader, EnvResolver,
//   RunnerRegistry, DefaultRunner, CustomRunnerLoader, PipelineExecutor.
//
// Hard rule for everything in this package: no `import 'vscode'`.
// The core must run standalone (CLI, tests, future cloud) without
// the VS Code extension host.

export const AIDLC_CORE_VERSION = '0.0.1';
