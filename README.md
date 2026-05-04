# AIDLC

AI-driven SDLC + agent workflow runner for VS Code.

This is a **monorepo** managed with [pnpm workspaces](https://pnpm.io/workspaces).

## Packages

| Package | Path | Purpose |
|---|---|---|
| [`aidlc`](packages/extension/) | `packages/extension/` | VS Code extension. Published to Marketplace + Open VSX as `hueanmy.aidlc`. |
| [`@aidlc/core`](packages/core/) | `packages/core/` | Pure-TypeScript engine: workspace loader, runner registry, pipeline executor. **No `import 'vscode'`** — runs standalone in CLI / tests / future cloud. |
| [`@aidlc/cli`](packages/cli/) | `packages/cli/` | Terminal CLI (`aidlc`) — read-only commands today (`validate`, `list`, `status`); `run` / `approve` / `tail` land in a follow-up. |

## Getting started

```sh
pnpm install        # at repo root, installs all packages + creates symlinks
pnpm compile        # tsc -r in every package
pnpm package:extension   # build .vsix
```

## Marketplace

- **VS Code Marketplace**: [hueanmy.aidlc](https://marketplace.visualstudio.com/items?itemName=hueanmy.aidlc)
- **Open VSX**: [hueanmy.aidlc](https://open-vsx.org/extension/hueanmy/aidlc)

## Status

- [x] Phase 0 — monorepo scaffold (`packages/extension`, `packages/core` placeholder)
- [x] Phase 1 — core engine: `WorkspaceSchema` (Zod), `WorkspaceLoader`, `EnvResolver`, `SkillLoader`, `RunnerRegistry` + `DefaultRunner` (claude CLI shell-out) + `CustomRunnerLoader`. 24 tests pass. **`PipelineExecutor` deferred to Phase 1.5.**
- [ ] Phase 2 — extension shell rewrite (consume `@aidlc/core`, replace tree view with workspace.yaml driven UI)
- [ ] Phase 3 — Config UI (4-tab webview: Agents / Skills / Env / Pipelines)
- [ ] Phase 4 — AIDLC Terminal + slash command router
- [ ] Phase 5 — bundled templates + onboarding wizard

See [docs/sdlc/epics/](docs/) (when present) for the full v2 product spec.

## CLI

A minimal `@aidlc/cli` package ships read-only inspection commands today:

```sh
pnpm aidlc validate                       # check .aidlc/workspace.yaml
pnpm aidlc list                           # agents, skills, pipelines
pnpm aidlc status [runId] [--json]        # list runs or show one
```

Pass `-w <path>` (or `AIDLC_WORKSPACE=<path>`) to point at a workspace other than `cwd`. Run-orchestration commands (`run`, `approve`, `reject`, `rerun`, `tail`) are tracked under Phase 4 and will land alongside the slash command router.
