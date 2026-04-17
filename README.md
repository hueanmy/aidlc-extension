# SDLC Pipeline

Track SDLC pipeline progress for software epics directly in VS Code. Visualize every phase — from planning to release — with agent ownership and real-time status.

![aidlc demo](https://raw.githubusercontent.com/hueanmy/aidlc-pipeline/main/demo.gif)

## Features

- **Epic Tree View** — sidebar panel showing all epics and their pipeline phases
- **Pipeline Dashboard** — visual dashboard with progress bars, phase dots, and hover details
- **Phase Status** — each phase shows: pending, in-progress, done, or blocked
- **Agent Ownership** — see which agent (PO, Tech Lead, QA, Dev, RM, SRE) owns each phase
- **Pipeline Settings** — enable/disable phases per epic via a settings panel
- **Isolated Phase Sessions** — open a dedicated editor session scoped to a single phase
- **Claude Code MCP auto-config** — extension wires up the SDLC MCP server; skills and agents become available inside Claude Code without manual setup

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

1. Install the extension (VS Code Marketplace or Open VSX)
2. Open a workspace folder
3. The SDLC Pipeline icon appears in the activity bar
4. On first activation, the extension:
   - Creates `docs/sdlc/epics/EPIC-1000/` with a starter epic + template set
   - Writes `.claude/settings.json` so Claude Code auto-loads the SDLC MCP server

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cfPipeline.epicsPath` | `docs/sdlc/epics` | Relative path to the SDLC epics folder |
| `cfPipeline.platform` | `mobile` | One of `mobile`, `web`, `backend`, `desktop`, `generic` — controls which platform overlays load |
| `cfPipeline.mcpPackage` | `github:hueanmy/aidlc-pipeline` | MCP package spec — accepts an npm name or `github:owner/repo` |
| `cfPipeline.mcpServerName` | `sdlc` | Key used under `mcpServers.<name>` in `.claude/settings.json` |
| `cfPipeline.autoConfigureMcp` | `true` | If `false`, extension will not touch `.claude/settings.json` |

## How Sync Works (MCP Server)

When Claude Code boots the MCP server (triggered on the first MCP tool invocation per session), it runs `syncWorkspace()` against your project root. The server is published from [`hueanmy/aidlc-pipeline`](https://github.com/hueanmy/aidlc-pipeline) — pulled via `npx -y github:hueanmy/aidlc-pipeline` (or the npm package when available).

### What gets synced on every boot

Into **your project** (cwd = workspace root):

```
<workspace>/
├── .claude/
│   ├── settings.json            # written by extension
│   ├── skills/
│   │   ├── _gate-check.md
│   │   ├── prd/SKILL.md         # merged: generic + platform overlay
│   │   ├── tech-design/SKILL.md
│   │   ├── test-plan/SKILL.md
│   │   └── ... (19 skills total)
│   └── agents/
│       ├── po.md                 # merged: generic + platform overlay
│       ├── tech-lead.md
│       ├── qa.md
│       └── ... (7 agents total)
└── docs/
    └── sdlc/
        ├── workflow/README.md    # scaffold (only if missing)
        └── epics/
            └── EPIC-1000/        # sample epic (only if missing)
                ├── EPIC-1000.md
                ├── PRD.md
                └── ITS.md
```

### Layered merge (platform overrides)

Content is merged at boot using a simple overlay:

1. **Generic** — from the pipeline package root (`skills/`, `agents/`, `templates/`)
2. **Platform** — from `platforms/<SDLC_PLATFORM>/<kind>/` (e.g., `platforms/mobile/agents/po.md`)
3. **Project** (optional) — from `projects/<SDLC_PROJECT>/<kind>/`

Later layers override sections of the earlier ones by matching `##` headings. `{{PLACEHOLDER}}` tokens get substituted from the project's `config.json` if provided.

### Timing

Claude Code boots MCP servers **lazily** — the server does not start until a slash command triggers an MCP tool call. Practical implications:

- First Claude Code session in a fresh workspace: slash commands may not appear immediately. Fire any `/` command (e.g. `/dashboard`) once to trigger boot → reload or reopen the prompt → commands appear.
- Subsequent sessions: sync runs again at first tool call, refreshing any out-of-date content.

If you want slash commands to work immediately without waiting for lazy boot, run once manually in the workspace:

```bash
npx -y github:hueanmy/aidlc-pipeline
# Ctrl+C after a second — sync has already run during startup.
```

## Use with Claude Code

The extension auto-configures an MCP server in `.claude/settings.json`. Drive each phase by **Jira epic key** with slash commands — pass the key (e.g. `ABC-123`) and the pipeline will pull context from Jira automatically (requires the Atlassian MCP):

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

## Troubleshooting

### Slash commands don't appear in Claude Code

**Cause**: the MCP server hasn't booted yet. Claude Code starts MCP servers lazily — only on the first MCP tool call.

**Fix**:
1. Type any `/` command (e.g. `/list-skills`) to trigger an MCP tool call. The server will boot and sync in the background.
2. Reload the Claude Code prompt / start a new chat → slash commands now discoverable.
3. Alternatively, warm up manually in your workspace root: `npx -y github:hueanmy/aidlc-pipeline` (kill after 1–2 seconds; the sync runs during startup).

### `.claude/skills/` or `.claude/agents/` is empty after activation

**Cause**: the MCP server either hasn't run yet, or `npx` failed silently.

**Fix**:
1. Check the **SDLC Pipeline** output channel (View → Output → "SDLC Pipeline") for errors.
2. Verify `.claude/settings.json` contains a `mcpServers.sdlc` entry with `command: "npx"` and `args: ["-y", "github:hueanmy/aidlc-pipeline"]`.
3. Try running it manually in a terminal from your workspace root:
   ```bash
   cd /path/to/your/project
   npx -y github:hueanmy/aidlc-pipeline
   ```
   If this works, `.claude/skills/` and `.claude/agents/` will populate. Kill with `Ctrl+C`.
4. If npx errors: `rm -rf ~/.npm/_npx` to clear the package cache, retry.

### MCP config not written to `.claude/settings.json`

**Cause**: the extension skips configuration if `cfPipeline.autoConfigureMcp` is `false`, or if it detects an existing `mcpServers.sdlc` entry (it won't overwrite).

**Fix**:
1. Verify `cfPipeline.autoConfigureMcp` is `true` in VS Code settings.
2. If `mcpServers.sdlc` already exists but is misconfigured: delete that entry from `.claude/settings.json`, reload the window.
3. Open Command Palette → `SDLC: Refresh Pipeline Status` to re-trigger auto-config.

### Slash commands use old or outdated content

**Cause**: `npx` caches the GitHub tarball; new commits to `aidlc-pipeline` aren't picked up automatically.

**Fix**:
```bash
rm -rf ~/.npm/_npx
```
Then reload Claude Code. The next MCP boot will re-download the latest `main` from GitHub.

### "MCP server `sdlc` already configured, leaving as-is" in output

This is **expected** behavior after the first activation — the extension protects your hand-edited MCP config. If you need to reset:

1. Open `.claude/settings.json`
2. Delete the `mcpServers.sdlc` entry
3. Reload VS Code window — the extension will re-create it with the latest defaults.

### Epic folder doesn't show up in the sidebar

**Cause**: the extension only treats folders matching `[A-Z][A-Z0-9]*-\d+` (e.g. `ABC-123`, `EPIC-2100`) as epics.

**Fix**: rename the folder to match the pattern. Folders like `my-feature/` or `abc-123/` (lowercase) are ignored.

### Platform-specific agents not loading

**Cause**: only `platforms/mobile/` has overrides shipped today. Other platforms (`web`, `backend`, `desktop`, `generic`) fall back to generic content — this is normal.

**Fix**: if you need platform-specific overlays, contribute them upstream to [`hueanmy/aidlc-pipeline`](https://github.com/hueanmy/aidlc-pipeline) under `platforms/<name>/`.

### Extension activates but no tree view appears

**Cause**: a workspace folder must be open (file-only mode is not enough).

**Fix**: File → Open Folder → select your project root → reload.

### Nothing in `docs/sdlc/epics/` after activation

**Cause**: the extension only seeds `EPIC-1000` on the **very first** activation if the folder is empty. If there's already any folder inside, no seed is created.

**Fix**:
1. Run `SDLC: Select Epics Folder` and pick a new empty folder, or
2. Manually delete any `*-NNNN/` folder first, reload window, and activation will seed `EPIC-1000`.

### Where to find logs

- **Extension side**: View → Output → "SDLC Pipeline" channel
- **Claude Code / MCP side**: Claude Code output panel, or run the MCP manually with `npx -y github:hueanmy/aidlc-pipeline` in a terminal — all server logs go to stderr.

## Requirements

- VS Code 1.85.0+ (or compatible: VSCodium, Cursor, Windsurf)
- A workspace folder (not single-file mode)
- Claude Code extension/app for slash command support
- Network access for `npx` to fetch the MCP server from GitHub
- Optional: Atlassian MCP for Jira integration, Figma MCP for design context

## License

MIT
