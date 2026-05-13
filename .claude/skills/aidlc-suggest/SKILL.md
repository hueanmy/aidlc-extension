---
name: aidlc-suggest
description: Analyzes existing AIDLC runs, token usage, plan progress, and pipeline performance to suggest improvements. Reads CLAUDE.md and workspace config to understand project context. Invoke via /aidlc-suggest.
---

# /aidlc-suggest — Analyze and improve your AIDLC setup

Reads all available data from the current project and produces actionable suggestions. No writes without confirmation.

## 0. Parse args

Optional args:
- `--user <name>` — scope analysis to one user (default: all users)
- `--since <date>` — only analyze runs after this date (ISO format, e.g. `2026-05-01`)
- `--pipeline <id>` — scope to one pipeline
- `--json` — output raw JSON report instead of formatted text

## 1. Load project context

Read in parallel:

- `CLAUDE.md` — project conventions and instructions
- `.aidlc/workspace.yaml` — shared base config
- `.aidlc/workspace.*.yaml` — all per-user profiles (glob)
- `.aidlc/plan.json` — project plan if exists
- `README.md` — project overview

Build a context summary:
```
users: [luke, john, ...]
pipelines: [api-feature, code-review, ...]
plan_tasks_total: N
plan_tasks_done: M
```

## 2. Collect run data

Scan `.aidlc/runs/**/*.json` (all users, or scoped by `--user`).

For each run file, extract:
```json
{
  "runId": "...",
  "user": "...",
  "pipelineId": "...",
  "startedAt": "...",
  "status": "running|completed|failed",
  "duration_ms": 0,
  "steps": [
    {
      "agent": "...",
      "status": "approved|rejected|...",
      "revision": 1,
      "rejectReason": "...",
      "history": [...]
    }
  ]
}
```

If run files have `meta.tokenUsage`, collect:
```json
{
  "runId": "...",
  "tokenUsage": {
    "input": 0,
    "output": 0,
    "cost_usd": 0.0
  }
}
```

## 3. Collect token data

Check for token records from the AIDLC extension:
- `.aidlc/index/token-ledger.json` — aggregated token data if exists
- `~/.claude/log.md` — session logs for unattributed token estimates

Cross-reference with plan.json task IDs where possible.

## 4. Compute metrics

Calculate the following in parallel:

### 4a. Pipeline performance

For each pipeline:
```
completion_rate    = completed_runs / total_runs
avg_duration_ms    = avg of (completedAt - startedAt)
rejection_rate     = steps_rejected / total_step_executions
most_rejected_step = step with highest rejection count
revision_avg       = avg revision number across all steps
```

### 4b. Token attribution

For each pipeline / task:
```
token_total        = sum of input + output tokens
cost_usd           = sum of cost per run
token_per_step     = breakdown by agent/step
unattributed_pct   = tokens with no task match / total tokens
```

### 4c. Plan progress

If `.aidlc/plan.json` exists:
```
tasks_total        = len(plan.tasks)
tasks_with_pipeline = tasks where pipeline != null
tasks_completed    = tasks where status == "done"
tasks_overdue      = tasks where scheduled_end < today and status != "done"
coverage_gap       = tasks_total - tasks_with_pipeline
```

### 4d. Skill health

For each skill file in `.aidlc/skills/`:
- Count how many times the skill was used (via run data)
- Flag skills with high rejection rates (> 2 rejections avg)
- Flag skills that were never used

## 5. Generate suggestions

Produce ranked suggestions based on metrics. Each suggestion has:
- `priority`: HIGH / MEDIUM / LOW
- `type`: pipeline | skill | plan | token | workflow
- `title`: one-line summary
- `detail`: explanation with evidence
- `action`: concrete next step

**Suggestion templates:**

```
[HIGH] Skill optimization needed: <agent>
  Evidence: <N> rejections in <M> runs, avg revision <R>
  Action: Review .aidlc/skills/<user>/<agent>.md — 
          the rejection reasons suggest the prompt is missing: <common patterns from rejectReason>

[HIGH] Plan coverage gap: <N> tasks have no pipeline
  Evidence: plan.json has <total> tasks, only <covered> mapped to pipelines
  Action: Run /aidlc-init to generate pipelines for uncovered task types

[MEDIUM] Token cost concentration: <pipeline> uses <X>% of total tokens
  Evidence: <pipeline> avg <N> tokens/run, est. $<cost> per run
  Action: Consider splitting <step> into smaller steps or refining the skill prompt

[MEDIUM] Overdue tasks detected: <N> tasks past scheduled_end
  Evidence: <list of task titles>
  Action: Update plan.json status or adjust scheduled dates

[LOW] Unused skill detected: <skill>
  Evidence: skill file exists but never used in any run
  Action: Remove or integrate into a pipeline

[LOW] High unattributed token usage: <X>%
  Evidence: <X>% of session tokens not matched to any plan task
  Action: Ensure pipelines are started via AIDLC runs (not manual chat) for attribution
```

## 6. Report

### Default (formatted) output:

```
📊 AIDLC Analysis Report
Project: <name>  |  Users: <N>  |  Period: <since>–today

── Plan Progress ──────────────────────────────────
  Tasks total:      <N>
  Completed:        <M> (<pct>%)
  Overdue:          <K>
  Without pipeline: <J>

── Pipeline Performance ───────────────────────────
  <pipeline>
    Runs: <N>  Completed: <M>  Avg duration: <T>
    Most rejected step: <step> (<R> avg revisions)
    Token cost: ~$<cost>/run

── Token Usage ────────────────────────────────────
  Total this period:  <N> tokens  (~$<cost>)
  By pipeline:
    <pipeline-1>:  <N> tokens  (<pct>%)
    <pipeline-2>:  <N> tokens  (<pct>%)
  Unattributed:   <N> tokens  (<pct>%)

── Suggestions ────────────────────────────────────
  [HIGH]   <title>
           <detail>
           → <action>

  [MEDIUM] <title>
           ...

── Next Steps ─────────────────────────────────────
  1. <most impactful action>
  2. <second action>
```

### JSON output (`--json`):

```json
{
  "generated_at": "<ISO>",
  "scope": { "users": [...], "since": "...", "pipeline": null },
  "plan": { "total": 0, "completed": 0, "overdue": 0, "coverage_gap": 0 },
  "pipelines": [...],
  "tokens": { "total": 0, "cost_usd": 0, "by_pipeline": {}, "unattributed_pct": 0 },
  "suggestions": [
    { "priority": "HIGH", "type": "skill", "title": "...", "detail": "...", "action": "..." }
  ]
}
```

## 7. Optional: apply suggestions

After presenting the report, ask:
```
Would you like me to apply any of these suggestions?
  1. Auto-refine skill prompts based on rejection patterns
  2. Update plan.json with pipeline mappings
  3. Generate missing pipelines (calls /aidlc-init for gaps)
  4. None — report only
```

If user selects 1–3, proceed with the selected action. Confirm each file write before executing.

## Safety rules

- Never modify run history files (`.aidlc/runs/*.json`) — read only.
- Never modify `plan.json` without user confirmation.
- Never auto-apply skill changes without showing a diff first.
- If token data is unavailable, omit the token section and note: "Token data not available — ensure AIDLC VS Code extension is active."
- If no runs exist yet, report: "No runs found. Run `/aidlc-init` first, then start pipeline runs to generate data."
