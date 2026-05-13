# AIDLC

AI-driven SDLC + agent workflow runner — drives Claude through any pipeline you
declare in `.aidlc/workspace.yaml`. Use it through the VS Code Builder UI or
straight from the terminal.

This is a **monorepo** managed with [pnpm workspaces](https://pnpm.io/workspaces).

## Packages

| Package | Path | Purpose |
|---|---|---|
| [`aidlc`](packages/extension/) (extension) | `packages/extension/` | VS Code extension. Builder UI for `workspace.yaml`, sidebar for active runs, run-state commands. Marketplace + Open VSX as `hueanmy.aidlc`. |
| [`@aidlc/core`](packages/core/) | `packages/core/` | Pure-TypeScript engine: Zod schema, workspace loader, runner registry (`DefaultRunner` shells out to `claude`), pipeline state machine. **No `import 'vscode'`** — runs identically in CLI / tests / cloud. |
| [`aidlc`](packages/cli/) (CLI) | `packages/cli/` | Standalone terminal CLI. Manages `workspace.yaml`, drives runs end-to-end via Claude, no VS Code required. See [packages/cli/README.md](packages/cli/README.md). |

## Claude Code Skills

AIDLC ships two Claude Code slash-command skills for project onboarding and continuous improvement.

| Skill | Invoke | Purpose |
|---|---|---|
| [`/aidlc-init`](.claude/skills/aidlc-init/SKILL.md) | `/aidlc-init` | Onboard any project: installs the VS Code extension, discovers docs and plan sources, interviews you about your role, generates a role-specific `workspace.<user>.yaml` and skill files. |
| [`/aidlc-suggest`](.claude/skills/aidlc-suggest/SKILL.md) | `/aidlc-suggest` | Analyzes run history, token usage, plan progress, and pipeline performance — produces ranked suggestions to optimize your workflow. |

### When to use each

- **New project or new team member** → `/aidlc-init`
- **Project already has `.aidlc/workspace.yaml`** → `/aidlc-init` reads it and extends with your profile
- **After running pipelines** → `/aidlc-suggest` to find bottlenecks and optimize

### Per-user workspaces

`/aidlc-init` generates `workspace.<username>.yaml` so each team member has their own pipeline profile while sharing a common `workspace.yaml` base. Runs are stored per-user under `.aidlc/runs/<username>/`.

### Plan integration

Both skills read `.aidlc/plan.json` as the project schedule anchor for token attribution. If no plan exists, `/aidlc-init` discovers one automatically from CSV, Markdown tables, llm-wiki, or git signals — then normalizes it to a common schema.

## Quick start

### 1. Install the CLI

```sh
# (when published to npm)
npm install -g aidlc

# (locally during development)
pnpm install && cd packages/cli && npm link
```

### 2. Bootstrap a workspace

```sh
aidlc init                              # scaffolds .aidlc/workspace.yaml
aidlc preset apply code-review          # or: sdlc, release-notes
aidlc validate                          # check schema
aidlc doctor                            # verify claude binary + auth
```

### 3. Start a run, let Claude do the work

```sh
aidlc run start review-pipeline --context epic=ABC-123
aidlc run exec <runId>                  # spawns claude, streams output, advances on success
# or fully unattended:
aidlc run exec <runId> --auto-approve
```

### 4. Watch what's happening

```sh
aidlc watch                             # live-rendered table of all runs
aidlc tail                              # one-line stream of state transitions
aidlc dashboard                         # browser UI on http://127.0.0.1:8787
```

### 5. Watch from VS Code

Install the extension. Edits made by either side update within ~200ms because
both consume the same `.aidlc/workspace.yaml` and `.aidlc/runs/*.json`.

## Repo dev

```sh
pnpm install                            # installs all packages + creates symlinks
pnpm build                              # tsc -r in every package
pnpm test                               # @aidlc/core unit tests
pnpm package:extension                  # build .vsix for the extension
```

## CLI reference (summary)

The full reference lives in [packages/cli/README.md](packages/cli/README.md).

### Workspace bootstrap
```
aidlc init                    # scaffold .aidlc/workspace.yaml + skills/ + runs/
aidlc validate                # parse + Zod-validate workspace.yaml
aidlc doctor                  # workspace + claude binary + auth + env health checks
aidlc list [--json]           # print agents, skills, pipelines
```

### Dynamic config (mirrors the VS Code Builder)
```
aidlc skill    add | list | show | remove           # 5 built-in templates
aidlc agent    add | list | show | remove
aidlc pipeline add | list | show | remove
aidlc preset   apply | save | list                  # built-ins: code-review, release-notes, sdlc
```

### Epic inspection (mirrors the extension's epics panel)
```
aidlc epic list [--status pending|in_progress|done|failed] [--json]
aidlc epic status <id>        # phase-by-phase view of one epic
```

### Run lifecycle (sequential, mirrors the upstream PipelineRunner)
```
aidlc run start <pipeline> [--id …] [--context epic=ABC-123]
aidlc run mark-done <runId>      # validate produces, advance or await review
aidlc run approve  <runId> [--comment …]
aidlc run reject   <runId> --reason …
aidlc run rerun    <runId> [--feedback …]
aidlc run delete   <runId> [--force]
aidlc run open     <runId> [--path]
aidlc run exec     <runId> [--until …] [--auto-approve] [--dry-run]
```

### Step control (jump to any step, any order — bypasses sequential gate)
```
aidlc step start  <runId> <step>          # → awaiting_work, moves pointer
aidlc step done   <runId> <step> [--reason …]
aidlc step skip   <runId> <step>
aidlc step reset  <runId> <step>          # → pending
aidlc step set    <runId> <step> <status> # raw any StepStatus
aidlc step jump   <runId> <step>          # auto-approve earlier pending steps
```

### Live observation
```
aidlc watch [runId]           # cli-table3 view, redraws on any state change
aidlc tail  [runId]           # streams transitions as one-line events
aidlc dashboard [--port …] [--host …]   # browser UI with action buttons
```

### Agent execution (one-shot, no run state)
```
aidlc agent run <agentId> [--message …] [--context epic=ABC-123] [--dry-run]
```

`<step>` accepts a 0-based index or an agent id. Pass `-w <path>` (or
`AIDLC_WORKSPACE=<path>`) to point at a workspace other than `cwd`.

## Architecture

```
                          ┌────────────────────┐
                          │  workspace.yaml    │  ← single source of truth
                          │  (Zod validated)   │
                          └──────────┬─────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
            ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
            │  CLI      │      │ Extension │      │  Future   │
            │  (Node)   │      │  (VS Code)│      │  cloud    │
            └─────┬─────┘      └─────┬─────┘      └───────────┘
                  │                  │
                  └────────┬─────────┘
                           │
                    ┌──────▼──────┐
                    │ @aidlc/core │  ← shared engine
                    │   (no UI)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ DefaultRunner│ → spawns `claude --print --append-system-prompt …`
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │.aidlc/runs/ │  ← state, watched by both UIs (live sync)
                    │  *.json     │
                    └─────────────┘
```

Both surfaces read and write the same files; the OS handles atomic renames so
neither side ever sees a half-written run state.

## Marketplace

- **VS Code Marketplace**: [hueanmy.aidlc](https://marketplace.visualstudio.com/items?itemName=hueanmy.aidlc)
- **Open VSX**: [hueanmy.aidlc](https://open-vsx.org/extension/hueanmy/aidlc)

## License

MIT
