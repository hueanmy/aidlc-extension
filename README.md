# SDLC Pipeline

Track SDLC pipeline progress for software epics directly in VS Code. Visualize every phase — from planning to release — with agent ownership and real-time status.

![aidlc demo](media/demo.gif)

## Features

- **Epic Tree View** — sidebar panel showing all epics and their pipeline phases
- **Pipeline Dashboard** — visual dashboard with progress bars, phase dots, and hover details
- **Phase Status** — each phase shows: pending, in-progress, done, or blocked
- **Agent Ownership** — see which agent (PO, Tech Lead, QA, Dev, RM, SRE) owns each phase
- **Pipeline Settings** — enable/disable phases per epic via a settings panel
- **Isolated Phase Sessions** — open a dedicated editor session scoped to a single phase

## How It Works

The extension scans your `docs/sdlc/epics/` folder for epic artifacts (PRD, Tech Design, Test Plan, etc.) and determines pipeline status based on file content — no external service required.

### Pipeline Phases

| Phase | Agent | Artifact |
|-------|-------|----------|
| Plan | Product Owner | Epic doc + PRD |
| Design | Tech Lead | Tech Design |
| Test Plan | QA Engineer | Test Plan |
| Implement | Developer | Feature branch |
| Review | Tech Lead | Approval |
| UAT | QA Engineer | UAT Script |
| Release | Release Manager | Git tag |
| Monitor | SRE | Health report |
| Doc Sync | Archivist | Reverse-sync doc |

## Getting Started

1. Install the extension
2. Open a workspace that contains a `docs/sdlc/epics/` folder
3. The SDLC Pipeline icon appears in the activity bar
4. Click to see your epics and their pipeline status

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cfPipeline.epicsPath` | `docs/sdlc/epics` | Relative path to the SDLC epics folder |

## Use with Claude Code

> ⚠️ **Coming soon** — the MCP server package `aidlc-pipeline` has not been published to npm yet. The extension already writes the MCP config into `.claude/settings.json`, so slash commands below will activate automatically as soon as the package goes live.

The extension auto-configures an MCP server (`aidlc-pipeline`) in `.claude/settings.json`.
Once Claude Code is open in your workspace, drive each phase by **Jira epic key** with slash commands — pass the key (e.g. `ABC-123`) and the pipeline will pull context from Jira automatically:

| Step | Slash command | Agent | What it does |
|------|---------------|-------|--------------|
| 1 | `/epic EPIC-KEY-123` | — | Scaffold epic folder from Jira issue |
| 2 | `/prd EPIC-KEY-123` | PO | Draft PRD (user flows, acceptance criteria) |
| 3 | `/tech-design EPIC-KEY-123` | Tech Lead | Architecture + API contracts |
| 4 | `/test-plan EPIC-KEY-123` | QA | Unit/UI/integration test cases |
| 5 | `/coding-rules` | — | Show project coding standards |
| 6 | `/review <pr>` | Tech Lead | Validate PR against epic docs |
| 7 | `/uat EPIC-KEY-123` | QA | UAT script for stakeholders |
| 8 | `/release` | RM | Release notes + tag |
| 9 | `/deploy` | RM | Build & deploy to target env |
| 10 | `/monitor` | SRE | Post-release health report |
| 11 | `/hotfix` | SRE | Emergency fix workflow |
| 12 | `/doc-sync EPIC-KEY-123` | Archivist | Reverse-sync docs from shipped code |

Use `/dashboard` to see pipeline status across all epics, or `/pipeline EPIC-KEY-123` to run the full SDLC sequentially.

### Walkthrough — start an epic from scratch

Assume your team created a new Jira epic `ABC-123` with a linked Figma frame.

**1. Scaffold the epic**
```
/epic ABC-123
```
- Claude calls the Jira MCP to fetch the epic's title, description, children, document links, and Figma to pull design context.
- Claude creates `docs/sdlc/epics/ABC-123/` with the epic template pre-filled (title, scope, acceptance criteria skeleton).
- The VS Code sidebar refreshes — `ABC-123` appears with all phases in `pending`.

**2. Draft the PRD**
```
/prd ABC-123
```
- The **Product Owner** agent reads the Jira issue + any Figma link attached to it (via the Figma MCP) to extract screens, user flows, and design tokens.
- Writes `docs/sdlc/epics/ABC-123/PRD.md` with user stories, acceptance criteria, and analytics events.
- `Plan` phase flips to `done`; `Design` becomes `in-progress`.

**3. Technical design**
```
/tech-design ABC-123
```
- The **Tech Lead** agent reads the PRD + explores the current codebase to propose architecture, API contracts, file impact, and DI plan.
- Writes `TECH-DESIGN.md`.

**4. Test plan**
```
/test-plan ABC-123
```
- The **QA Engineer** agent maps PRD acceptance criteria to unit/UI/integration test cases.
- Writes `TEST-PLAN.md`.

**5. Implement on a feature branch**

Out of band — developer cuts `feature/ABC-123-...` and builds the code. Claude can assist as the **Developer** agent, constrained to the design + test plan.

**6. Review the PR**
```
/review <pr-url>
```
- Validates the PR diff against PRD + Tech Design + Test Plan and flags gaps.

**7. UAT → Release → Monitor**
```
/uat ABC-123      # QA generates UAT script
/release          # RM prepares release notes + git tag
/deploy           # RM deploys to uat/prod
/monitor          # SRE pulls crash + analytics for the first 24–48h
```

**8. Close the loop**
```
/doc-sync ABC-123
```
- The **Archivist** agent diffs planned docs vs shipped code and reverse-syncs the PRD/Tech Design so they reflect what actually shipped.

At any point, `/dashboard` shows the pipeline status for every epic, or you can run `/pipeline ABC-123` to walk through phases 1 → 8 sequentially without invoking each skill by hand.

## Commands

All commands are available via `Cmd+Shift+P` (or `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `SDLC: Open Pipeline Dashboard` | Open the visual pipeline dashboard |
| `SDLC: Refresh Pipeline Status` | Re-scan epics and update status |
| `SDLC: Select Epics Folder` | Change the epics folder location |
| `SDLC: Pipeline Settings` | Open pipeline settings panel |

## Requirements

- VS Code 1.85.0+
- A workspace with epic markdown files in the configured epics path

## License

MIT
