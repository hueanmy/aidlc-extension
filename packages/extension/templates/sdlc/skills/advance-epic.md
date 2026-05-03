---
name: advance-epic
description: Full-auto orchestrated run of the SDLC pipeline for an epic. The Orchestrator agent dispatches workers, runs auto-review, and stops at the 4 human gates (plan, design, test-plan, implement) for human approval.
argument-hint: <{{EPIC_PREFIX}}-XXXX> [--skip-gates]
---

# Advance Epic $0

You are about to run the **full-auto orchestrator** for epic `$0`.

## What this does

The Orchestrator agent (loaded from `.claude/agents/orchestrator.md`) runs this loop until it hits a stopping condition:

```
next_step → dispatch worker → auto-review → pass? ─┬─ gate phase → pause for human
                                                   └─ else → advance
                                  └─ reject? → retry (≤2) or cascade upstream
```

Stopping conditions:
- ✅ `completed` — all phases passed
- 🔔 `paused_at_gate` — waiting for human approve/reject (plan, design, test-plan, implement)
- ⛔ `halted` — auto-reviewer exhausted retries, human must intervene

## Prerequisites

- `docs/sdlc/epics/$0/epic.json` must exist with required fields (`epic_id`, `project`, `brief`, `affected_modules`).
  - If missing: run `/epic $0` first to scaffold, or call the `init_epic` MCP tool, or edit `epic.json` by hand following `.claude/schemas/epic.schema.md`.
- The MCP server `sdlc` (or whatever name you bound it to) must be configured in `.claude/settings.json`.

## Steps

1. **Verify epic.json exists.**
   ```
   Read docs/sdlc/epics/$0/epic.json
   ```
   If not found → tell the user to run `/epic $0` first and STOP.

2. **Check if affected_modules is populated.**
   If the array is empty:
   - Call MCP tool `list_project_modules` (with the workspace path) to see what modules the workspace defines under `docs/core-business/`.
   - Show them to the user with a short blurb for each. If the list is empty, tell the user the orchestrator can still run but workers will only see the epic brief and upstream artifacts — they may want to populate `docs/core-business/` first.
   - Ask the user to edit `epic.json` and list the modules this epic affects (or leave empty intentionally).
   - STOP. Re-running `/advance-epic` after editing will continue.

3. **Dispatch the Orchestrator agent** via the `Task` tool:
   ```
   subagent_type: orchestrator
   prompt:
     Run the full-auto SDLC loop for epic $0.
     Workspace: <absolute path to the user's project root>
     Skip gates: <true if "--skip-gates" present in arguments, else false>

     Follow the core loop in your persona (.claude/agents/orchestrator.md).
     Use the MCP tools: epic_status, phase_context, start_phase,
     set_phase_status, reject_gate, amend_affected_modules.
     Dispatch workers via the Task tool.

     Stop when you hit completed, paused_at_gate, or halted. Return a
     one-line summary of the stop reason.
   ```

4. **Relay the orchestrator's summary** back to the user. Do not add commentary.

## If the user is running `/advance-epic` after approving a gate

Just re-invoke step 3 — the orchestrator picks up from wherever `next_step` points.

## If the user passes `--skip-gates`

Set `skip_gates: true` in the dispatch prompt. The orchestrator will not pause at human gates; it will run every phase through auto-review only. Use this for hotfixes, not normal epics.

## Anti-patterns (do not do in this skill)

- ❌ Running workers directly here. The whole point of `/advance-epic` is to delegate to the Orchestrator.
- ❌ Skipping the affected_modules check. Without it, context packaging is empty.
- ❌ Bypassing the MCP tool set and writing `status.json` files by hand.
