# AIDLC

AI-driven SDLC + agent workflow runner for VS Code.

This is a **monorepo** managed with [pnpm workspaces](https://pnpm.io/workspaces).

## Packages

| Package | Path | Purpose |
|---|---|---|
| [`aidlc-flow`](packages/extension/) | `packages/extension/` | VS Code extension. Published to Marketplace + Open VSX as `aidlc-io.aidlc-flow` ("AIDLC Flow"). |
| [`@aidlc/core`](packages/core/) | `packages/core/` | Pure-TypeScript engine: workspace loader, runner registry, pipeline executor. **No `import 'vscode'`** — runs standalone in CLI / tests / future cloud. |

## Getting started

```sh
pnpm install        # at repo root, installs all packages + creates symlinks
pnpm compile        # tsc -r in every package
pnpm package:extension   # build .vsix
```

## Marketplace

- **VS Code Marketplace**: [aidlc-io.aidlc-flow](https://marketplace.visualstudio.com/items?itemName=aidlc-io.aidlc-flow)
- **Open VSX**: [aidlc-io.aidlc-flow](https://open-vsx.org/extension/aidlc-io/aidlc-flow)

The legacy `hueanmy.aidlc` listing remains published but is no longer updated.

## Status

- [x] Phase 0 — monorepo scaffold (`packages/extension`, `packages/core` placeholder)
- [ ] Phase 1 — core engine (`WorkspaceSchema`, `WorkspaceLoader`, `RunnerRegistry`, `PipelineExecutor`)
- [ ] Phase 2 — extension shell rewrite (consume `@aidlc/core`, replace tree view with workspace.yaml driven UI)
- [ ] Phase 3 — Config UI (4-tab webview: Agents / Skills / Env / Pipelines)
- [ ] Phase 4 — AIDLC Terminal + slash command router
- [ ] Phase 5 — bundled templates + onboarding wizard

See [docs/sdlc/epics/](docs/) (when present) for the full v2 product spec.
