# aidlc

Terminal CLI for AIDLC — drives Claude through pipelines you declare in
`.aidlc/workspace.yaml`. Manages the workspace, executes runs end-to-end via
the `claude` CLI, and shares state with the VS Code extension over the
filesystem (no daemon, no IPC).

**Claude only.** The CLI shells out to `claude --print --append-system-prompt
<skill>`. No Anthropic SDK calls, no other model runners.

## Install

```sh
# From npm (when published)
npm install -g aidlc

# From source (development)
pnpm install                                 # at repo root
cd packages/cli && npm link                  # makes `aidlc` available globally
```

## Prerequisites

- **Node.js ≥ 18**
- **`claude` CLI** on PATH — install from https://github.com/anthropics/claude-code
- **Authentication** — either `ANTHROPIC_API_KEY` env var, or `claude config list` returning ok

Run `aidlc doctor` to verify all of the above.

## Five-minute walkthrough

```sh
# 1. New workspace from scratch
mkdir my-pipeline && cd my-pipeline
aidlc init
aidlc doctor                                 # confirm claude is wired up

# 2. Drop in a built-in preset (or build manually with skill/agent/pipeline add)
aidlc preset apply code-review
aidlc list                                   # see the agents, skills, pipeline you got

# 3. Kick off a run and let Claude do the work
aidlc run start review-pipeline --context diff=$(git diff HEAD~1)
aidlc run exec <runId>                       # streams claude output, advances on success
```

## Command reference

Global flags available on every subcommand:

| Flag | Default | Purpose |
|---|---|---|
| `-w, --workspace <path>` | `cwd` | Workspace root (containing `.aidlc/`). Also reads `AIDLC_WORKSPACE` env. |

### `init` — bootstrap a workspace

```
aidlc init [--name "Workspace Name"]
```

Creates `.aidlc/workspace.yaml` (commented starter), `.aidlc/skills/`, `.aidlc/runs/`.
Idempotent — skips anything that already exists.

### `doctor` — health check

```
aidlc doctor
```

Verifies `workspace.yaml` parses + Zod-validates, `claude` binary is on PATH,
authentication works, all skill paths exist, custom runner files exist, and
run-state JSON files are parseable. Exit 1 on any failure.

### `validate` — schema-only check

```
aidlc validate
```

Stricter than the `doctor` workspace section: enumerates every Zod issue with
its `path[]` for editor jump-to-line.

### `list` — print workspace contents

```
aidlc list [--json]
```

Pretty table by default, structured JSON for piping into `jq`.

---

### Skills

```
aidlc skill add --id <id> --template <name>            # bundled template (5 available)
aidlc skill add --id <id> --path .aidlc/skills/my.md   # reference your own .md
aidlc skill list [--json] [--templates]                # `--templates` lists the 5 built-ins
aidlc skill show <id>                                  # prints the rendered .md content
aidlc skill remove <id>                                # removes from yaml (does NOT delete .md)
```

Built-in templates: `hello-world`, `code-reviewer`, `test-converter`,
`doc-writer`, `release-notes`. Run `aidlc skill list --templates` for a one-line
description of each.

### Agents

```
aidlc agent add --id <id> --name <n> --skill <skillId>
                [--model claude-sonnet-4-5]
                [--capabilities files,github,jira]
                [--description "…"]
                [--runner default|custom] [--runner-path .aidlc/runners/foo.js]
aidlc agent list [--json]
aidlc agent show <id>
aidlc agent remove <id>
aidlc agent run <id> [--message "…"] [--context k=v,…] [--dry-run]
```

`agent run` is one-shot — spawns `claude` with the agent's skill + your
message, streams to stdout, no run state created. Useful for quick checks and
piping into shell scripts.

### Pipelines

```
aidlc pipeline add --id <id> --steps agent1,agent2,agent3
                   [--human-review]                        # mark all steps as gated
                   [--produces "p1.md:p2.md,p3.md"]        # colon between steps, comma between artifacts
                   [--on-failure stop|continue]
aidlc pipeline list [--json]
aidlc pipeline show <id>                                   # numbered step graph
aidlc pipeline remove <id>
```

### Presets

```
aidlc preset list [--json]                # shows built-ins and saved snapshots
aidlc preset apply <name>                 # merges into current workspace (no overwrite)
aidlc preset save <name>                  # snapshot current workspace to .aidlc/presets/<name>.json
```

Built-in presets: `code-review`, `release-notes`, `sdlc` (full 9-phase SDLC
pipeline ported from the legacy AIDLC).

---

### `run` — pipeline lifecycle

These wrap `@aidlc/core`'s `PipelineRunner` and write atomically through
`RunStateStore`. The VS Code sidebar updates within ~200ms.

```
aidlc run start <pipelineId> [--id <runId>] [--context k=v,k=v]
aidlc run mark-done <runId>             # validates produces paths, advances or awaits review
aidlc run approve   <runId> [--comment "…"]
aidlc run reject    <runId> --reason "…"
aidlc run rerun     <runId> [--feedback "…"]
aidlc run delete    <runId> [--force]
aidlc run open      <runId> [--path]    # prints state.json content (or just file path)
aidlc run exec      <runId> [--until <step>] [--auto-approve] [--message "…"] [--dry-run]
```

**`run exec`** is the unique unlock: it spawns `claude` for the current step,
streams stdout to your terminal, validates the produced artifacts, and advances
to the next step automatically. With `--auto-approve` it also clears
`human_review` gates without pausing — a single command then drives the entire
pipeline end-to-end.

`run start` defaults `runId` to `<pipelineId>-<timestamp>` if `--id` is omitted.

### `step` — direct step control

The `run` commands operate on the current step. `step` operates on **any**
step regardless of pipeline order, for when reality doesn't match the
pipeline (work done outside the tool, phases that don't apply this time,
hopping back to redo something).

```
aidlc step start  <runId> <step>          # → awaiting_work, moves pointer (demotes the old current step to pending)
aidlc step done   <runId> <step> [--reason "…"]   # → approved (no produces validation)
aidlc step skip   <runId> <step>          # → approved with skip note
aidlc step reset  <runId> <step>          # → pending (no cascade)
aidlc step set    <runId> <step> <status> # raw — any of: pending | awaiting_work | awaiting_review | approved | rejected
aidlc step jump   <runId> <step>          # moves pointer + auto-approves earlier pending steps
```

`<step>` accepts a 0-based index (`0`, `1`, `2`) or an agent id (`reviewer`,
`planner`) — whichever is easier in context.

`step done` and `step skip` only advance the pointer when the step they touch
is the **current** step; touching an earlier step won't drag the pointer
backward.

### `status` — list runs / inspect one

```
aidlc status                              # all runs in .aidlc/runs/
aidlc status <runId>                      # detailed view of one run
aidlc status [runId] --json               # raw RunState JSON
```

## Recipes

### Drive a complete SDLC pipeline end-to-end

```sh
aidlc preset apply sdlc
aidlc run start sdlc-pipeline --id ABC-123 --context epic=ABC-123
aidlc run exec ABC-123 --auto-approve     # claude works through every phase
```

### Manually mark a phase done that you completed outside AIDLC

```sh
aidlc step done <runId> implement --reason "merged via PR #42"
aidlc run exec <runId>                    # resumes from the next step
```

### Restart a single phase without cascading

```sh
aidlc step reset <runId> review
aidlc step start <runId> review            # → awaiting_work
aidlc run exec <runId>
```

### One-shot ask, no run state

```sh
aidlc agent run reviewer --message "Review the diff in /tmp/patch.diff"
```

### Pipe runs into another tool

```sh
aidlc list --json | jq '.pipelines[].id'
aidlc status <runId> --json | jq '.steps[] | select(.status=="rejected")'
```

## Filesystem layout

The CLI never holds in-memory state — everything lives in your workspace:

```
my-project/
├── .aidlc/
│   ├── workspace.yaml          # agents, skills, pipelines (Zod validated)
│   ├── skills/                 # custom skill .md files
│   │   └── code-reviewer.md
│   ├── runs/                   # one JSON per run
│   │   └── ABC-123.json        # full RunState (steps, status, context)
│   └── presets/                # saved workspace snapshots
│       └── my-preset.json
└── docs/                       # produces paths from your pipelines land here
    └── …
```

Runs and presets are local-only — gitignore `.aidlc/runs/` and
`.aidlc/presets/` if you want, the rest is meant to be committed.

## Troubleshooting

| Problem | Likely fix |
|---|---|
| `aidlc doctor` says "Not authenticated" | `claude login` (Claude Code) or set `ANTHROPIC_API_KEY` |
| `aidlc run exec` fails with "missing artifacts" | The agent didn't produce the files declared in `pipeline.steps[].produces`. Check the paths or fix the agent's skill. |
| `aidlc run start` rejects the runId | RunIds must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. No spaces, no leading dashes. |
| Pipeline step appears as a string in YAML, but I edited it as an object | Both forms are valid. The CLI writes string form when there's no metadata, object form when there's `human_review` or `produces`. |
| Custom runner not loading | `runner_path` must be `.js` / `.cjs` / `.mjs` (no TypeScript yet). Run `aidlc doctor` to check the file resolves. |

## License

MIT
