# @aidlc/core

AIDLC core engine — workspace loader, runner registry, pipeline executor.

**Pure TypeScript.** No `import 'vscode'`. Designed to run standalone (CLI, tests, future cloud) outside the VS Code extension host.

## Status

Phase 0 placeholder. Phase 1 (M2) will land:

- `WorkspaceSchema` — Zod validation for `workspace.yaml`
- `WorkspaceLoader` — find / parse / watch / save
- `SkillLoader` — load builtin + custom skills
- `EnvResolver` — `${env:VAR}` resolution + layering
- `RunnerRegistry` + `DefaultRunner` + `CustomRunnerLoader` — plugin contract
- `PipelineExecutor` — depends_on ordering, on_failure handling, streaming output
