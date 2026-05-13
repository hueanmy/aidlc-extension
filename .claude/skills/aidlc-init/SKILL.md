---
name: aidlc-init
description: Onboard any project into AIDLC — installs the VS Code extension, discovers project docs and plan sources, interviews the human about their role and workflow, then generates a role-specific workspace.yaml and skill files. Invoke via /aidlc-init.
---

# /aidlc-init — Onboard a project into AIDLC

End-to-end onboarding flow. Each step builds on the previous; stop and report if a blocker is found — do NOT skip steps.

## 0. Parse args

Optional args:
- `--user <name>` — override username (default: `git config user.name` or `$USER`)
- `--skip-extension` — skip VS Code extension install (e.g. running headless)
- `--dry-run` — print what would be generated, write nothing

## 1. Install VS Code extension

Unless `--skip-extension` is passed:

```bash
code --install-extension hueanmy.aidlc 2>&1
```

If `code` is not on PATH, warn the user:
> VS Code CLI not found. Install manually: open VS Code → Extensions → search `hueanmy.aidlc`. Then re-run `/aidlc-init --skip-extension`.

Proceed regardless — extension is optional for CLI-only usage.

## 2. Deep read project docs

Read the following in parallel. Build a **context map** before asking the human anything.

**Identity files (read if exist):**
- `CLAUDE.md` — project instructions, conventions, tech stack hints
- `README.md` — project overview
- `.claude/CLAUDE.md` — project-level Claude config
- `AGENTS.md` — agent definitions if any

**Doc structures (scan, read top-level files):**
- `docs/` — any `.md` files at root level
- `llm-wiki/` — STP.md, FD-*.md if present
- `.aidlc/skills/` — existing custom skills

**Tech stack signals (read if exist):**
- `package.json` — JS/TS stack, scripts
- `go.mod` — Go stack
- `requirements.txt` / `pyproject.toml` — Python stack
- `pom.xml` / `build.gradle` — Java stack
- `Dockerfile` / `docker-compose*.yml` — infra

Summarize findings into a context map:
```
project_name: ...
tech_stack: [...]
frameworks: [...]
has_wiki: true/false
existing_skills: [...]
doc_sources_found: [...]
```

## 3. Plan discovery

Check if `.aidlc/plan.json` exists.

### 3a. Plan already exists → use it

```bash
cat .aidlc/plan.json
```

Report:
> Found existing plan: `N` tasks, source: `<source>`. Using it.

Skip to step 4.

### 3b. No plan → discover sources

Scan for plan sources in parallel:

| Source | Pattern | Confidence |
|---|---|---|
| CSV with date columns | `*.csv` containing date/task/status headers | HIGH |
| MD table with dates | `*.md` containing `\| task \|` + date columns | MEDIUM |
| MD checklist | `- [ ]` items with dates | MEDIUM |
| llm-wiki STP | `llm-wiki/STP.md` with epic/phase structure | MEDIUM-HIGH |
| JSON/YAML with tasks | files matching `*plan*`, `*sprint*`, `*backlog*` | HIGH |
| Git branches | `git branch -a` — feature/PROJ-* patterns | LOW |
| CLAUDE.md todos | `- [ ]` items in CLAUDE.md | LOW |

Present findings to the user:
```
I found the following plan sources:
  [HIGH]   docs/sprint-plan.csv     (42 tasks, date columns detected)
  [MEDIUM] llm-wiki/STP.md          (8 epics detected)
  [LOW]    CLAUDE.md                (12 todo items)

Which should I use as primary? (Or: "merge all" / "create new")
```

After user selection, normalize into `.aidlc/plan.json`:

```json
{
  "source": "<original source path>",
  "confidence": "high|medium|low",
  "generated_at": "<ISO timestamp>",
  "tasks": [
    {
      "id": "T-001",
      "title": "...",
      "epic": "...",
      "assignee": null,
      "scheduled_start": null,
      "scheduled_end": null,
      "status": "pending",
      "pipeline": null
    }
  ]
}
```

If user says "create new" — generate a skeleton plan based on the context map from step 2 and ask the user to confirm before writing.

## 4. Interview human

Now that you have context from steps 2–3, ask targeted questions. Do NOT ask about things already clear from docs.

**Question 1 — Role:**
```
What is your role in this project?
  1. Frontend Developer
  2. Backend Developer
  3. Full-stack Developer
  4. Tech Lead / Architect
  5. Product Owner / PM
  6. QA Engineer
  7. DevOps / SRE
  8. Solo founder (all of the above)
  9. Other (describe)
```

**Question 2 — Primary workflow** (adapt based on role answer):
```
What is your main day-to-day workflow? Describe in your own words.
(e.g. "I pick up Jira tickets, implement features in React, open PRs for review")
```

**Question 3 — Custom skills** (only ask if `.claude/skills/` has files OR user mentioned custom tooling):
```
I found these existing skills: [list]
Which should be integrated into your AIDLC pipelines? (list names, or "none", or "all")
```

If no existing skills found, ask:
```
Do you have any custom workflow scripts or skill files you want to integrate? 
If yes, provide their paths. If no, press Enter to skip.
```

**Question 4 — Mode preference:**
```
How do you want to use AIDLC?
  1. VS Code extension (Builder UI + sidebar dashboard)
  2. Claude Code chat (skill-driven, no CLI needed)
  3. Both
```

## 5. Propose pipelines

Based on role + workflow description, propose 2–3 pipelines. Show a preview before generating.

**Role → pipeline mapping:**

| Role | Suggested pipelines |
|---|---|
| Frontend Dev | `ui-feature`, `component-review`, `accessibility-check` |
| Backend Dev | `api-feature`, `code-review`, `db-migration` |
| Full-stack Dev | `feature-end-to-end`, `code-review`, `api-feature` |
| Tech Lead | `tech-design`, `architecture-review`, `pr-review` |
| PO / PM | `prd`, `epic-breakdown`, `acceptance-criteria` |
| QA | `test-plan`, `regression`, `bug-report` |
| DevOps / SRE | `infra-review`, `deployment`, `incident-review` |
| Solo | `feature-end-to-end`, `code-review`, `prd` |

Present to user:
```
Based on your role (Backend Developer) and workflow, I recommend:

  Pipeline 1: api-feature
    Steps: tech-design → implement → code-review → test
    Produces: implementation + test coverage

  Pipeline 2: code-review
    Steps: review → feedback → approve/reject
    Produces: review report

Proceed with these? (yes / adjust / pick different)
```

Wait for confirmation before generating.

## 6. Generate workspace and skill files

Resolve username: `git config user.name 2>/dev/null || echo $USER`

### 6a. Generate `workspace.<username>.yaml`

Write to `.aidlc/workspace.<username>.yaml`. Reference:
- Only pipelines confirmed in step 5
- Custom skills from step 4 at their actual paths
- Tech stack context injected into agent descriptions
- Per-person runs directory: `.aidlc/runs/<username>/`

Template:
```yaml
version: "1.0"
name: "<project_name> — <username>"

agents:
  # Generated based on role and confirmed pipelines
  # Each agent references a skill that knows this project's tech stack

skills:
  # Built-in aidlc skills + any custom skills from step 4

environment:
  AIDLC_USER: "<username>"
  AIDLC_PLAN: ".aidlc/plan.json"

pipelines:
  # Only the pipelines confirmed in step 5

sidebar:
  views:
    - type: run-history
    - type: agents-list
    - type: file-tree
      label: My Runs
      glob: ".aidlc/runs/<username>/*.json"
      group_by: flat
```

### 6b. Generate skill `.md` files

For each agent in the generated workspace, write a skill file to `.aidlc/skills/<username>/`.

Each skill must include:
- Project name and tech stack context (from step 2 context map)
- Role-specific instructions
- References to upstream artifacts if the pipeline has `requires`
- Integration points for any custom skills from step 4

### 6c. Update shared `workspace.yaml`

If `.aidlc/workspace.yaml` does not exist, create it with shared base (agents and skills common to all users, no pipelines — those are per-person).

If it exists, do NOT overwrite — append missing shared skills only.

## 6c. Create or update CLAUDE.md

Check if `CLAUDE.md` exists in the project root.

### If CLAUDE.md does not exist — create it

Generate a `CLAUDE.md` based on context map (step 2) and confirmed pipelines (step 5):

```markdown
# <project_name> — Claude Code Project Instructions

## Project overview
<1–2 sentences from README or context map>

## Tech stack
<detected stack: language, frameworks, databases, infra>

## Where things go

### AIDLC workspace files
- Per-user workspace: `.aidlc/workspace.<username>.yaml`
- Shared base: `.aidlc/workspace.yaml`
- Project plan: `.aidlc/plan.json`
- Runs: `.aidlc/runs/<username>/*.json`
- Skills: `.aidlc/skills/<username>/`

### Source code
<auto-detected from project structure — e.g.:>
- Components: `src/components/`
- API handlers: `src/handlers/`
- Database models: `src/models/`

## Key conventions
<extracted from existing CLAUDE.md if any, or inferred from tech stack>

## AIDLC pipelines for this project
<list confirmed pipelines with brief description of each>

## Skills
<list skill files and their purpose>
```

### If CLAUDE.md already exists — append AIDLC section only

Read the existing file. If it already contains an `## AIDLC` section, update it in place. Otherwise append:

```markdown

---

## AIDLC setup (<username>, <date>)

### Workspace profile
`.aidlc/workspace.<username>.yaml`

### Active pipelines
<list confirmed pipelines>

### Skills
<list generated skill files>

### Plan source
`.aidlc/plan.json` — <source description>
```

Never overwrite existing content — only append or update the AIDLC section.

## 7. Validate

Run validation checks in parallel:

```bash
# Check workspace.yaml is valid YAML
python3 -c "import yaml,sys; yaml.safe_load(open('.aidlc/workspace.<username>.yaml'))" 2>&1

# Check all skill paths exist
# (verify each path: in generated workspace yaml)

# Check plan.json is valid JSON
python3 -c "import json,sys; json.load(open('.aidlc/plan.json'))" 2>&1
```

If any check fails, fix before reporting.

## 8. Final report

Print a concise summary:

```
✅ AIDLC initialized for <username>

Files created:
  .aidlc/plan.json                    ← project plan (<N> tasks, source: <source>)
  .aidlc/workspace.<username>.yaml    ← your workspace profile
  .aidlc/skills/<username>/           ← <N> skill files generated

Pipelines ready:
  <pipeline-1>  →  <step count> steps
  <pipeline-2>  →  <step count> steps

Custom skills integrated:
  <list or "none">

Next steps:
  • VS Code: open the AIDLC sidebar to see your pipelines
  • Start a run: open AIDLC Builder → select pipeline → Start Run
  • Suggest improvements: /aidlc-suggest
```

## Safety rules

- Never overwrite an existing `.aidlc/plan.json` without user confirmation.
- Never overwrite an existing `workspace.<username>.yaml` — prompt to merge or replace.
- Never write to `workspace.yaml` (shared base) beyond appending missing skills.
- If `--dry-run` is passed, print all files that would be written but write nothing.
- Do not invent task data — if plan discovery finds nothing usable, create a skeleton and label it clearly as "needs review".
