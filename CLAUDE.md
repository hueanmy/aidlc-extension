# AIDLC — Claude Code Project Instructions

## Project overview

AIDLC is a monorepo with three packages:

| Package | Path | Role |
|---|---|---|
| `@aidlc/core` | `packages/core/` | Pure TS engine — schema, loader, runner, state machine. No `vscode` imports. |
| `aidlc` (extension) | `packages/extension/` | VS Code extension — Builder UI, sidebar, token tracking, webviews. |
| `aidlc` (CLI) | `packages/cli/` | Terminal CLI — drives runs without VS Code. |

## Where things go

### Adding a new Claude Code skill
- Create `.claude/skills/<skill-name>/SKILL.md`
- Document in `README.md` under the **Claude Code Skills** section
- Skills are invokable via `/<skill-name>` in Claude Code chat

### Adding a new agent template
- Add to `packages/extension/templates/sdlc/agents/<role>.md`
- Reference in `packages/extension/src/v2/builtinPresets.ts` if it's a preset agent

### Adding a new skill template
- Add to `packages/extension/templates/sdlc/skills/<skill>.md`
- Reference in `packages/extension/src/v2/skillTemplates.ts`

### Adding a new VS Code command
- Register in `packages/extension/src/extension.ts`
- Implement in `packages/extension/src/v2/workspaceCommands.ts` or `runCommands.ts`

### Modifying the workspace schema
- Edit `packages/core/src/schema/WorkspaceSchema.ts` — single source of truth
- Zod schema changes auto-propagate to loader, runner, sidebar
- Add tests in `packages/core/test/schema.test.ts`

### Modifying pipeline state machine
- Edit `packages/core/src/runs/PipelineRunner.ts`
- State types live in `packages/core/src/runs/RunState.ts`
- Add tests in `packages/core/test/runs.test.ts`

### Modifying the runner
- `DefaultRunner`: `packages/core/src/runner/DefaultRunner.ts` — spawns `claude --print --append-system-prompt`
- Custom runners: implement `AidlcRunner` interface from `packages/core/src/runner/types.ts`

### Token tracking
- Monitor: `packages/extension/src/v2/tokenMonitor.ts`
- Attribution: `packages/extension/src/v2/epicTokenAttribution.ts`
- Pricing: `packages/extension/src/v2/tokenPricing.ts`
- Records: `packages/extension/src/v2/tokenRecords.ts`
- Report webview: `packages/extension/src/v2/tokenReportWebview.ts`

### Webview components
- React components: `packages/extension/src/webview/components/`
- Bridge (extension ↔ webview): `packages/extension/src/webview/lib/bridge.ts`
- Sidebar entry: `packages/extension/src/webview/sidebar/main.tsx`
- Builder entry: `packages/extension/src/webview/workspace/main.tsx`

### Per-user workspace profiles
- Convention: `.aidlc/workspace.<username>.yaml`
- Shared base: `.aidlc/workspace.yaml` (agents + skills only, no pipelines)
- Runs per user: `.aidlc/runs/<username>/*.json`
- Plan: `.aidlc/plan.json` (normalized from any source — CSV, MD, llm-wiki, JSON)

## Build

```bash
pnpm install          # install all packages
pnpm build            # tsc -r in every package
pnpm test             # @aidlc/core unit tests
pnpm package:extension  # build .vsix
```

Always use `pnpm package:extension` to build the extension — never `tsc` alone (bundling via esbuild is required).

## Release

Use the `/publish` skill: `/publish [patch|minor|major]`

## Key conventions

- `@aidlc/core` must never import from `vscode` — keep it runtime-agnostic
- Artifact paths in `workspace.yaml` support `{context-key}` placeholders resolved at run time
- Run state files are append-only JSON — never mutate history entries
- Per-user workspace files are gitignored by convention (`.aidlc/workspace.*.yaml` except `workspace.yaml`)
