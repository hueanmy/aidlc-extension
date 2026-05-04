# Changelog

## 0.8.0 — v2 pivot, breaking

The extension is now a generic agent-workflow runner driven by a per-project `.aidlc/workspace.yaml` instead of an SDLC-pipeline tool. Existing 0.7.x users on the marketplace will see all SDLC features removed; their `docs/sdlc/epics/` content is left untouched on disk but no longer surfaced by the extension.

**Removed (cleanly, no longer available):**

- SDLC pipeline tree view (`docs/sdlc/epics/<KEY>/...` scanner)
- Pipeline Dashboard webview, Settings panel, Review Gate panel
- All `cfPipeline.*` commands (Refresh, Open Dashboard, Run Step, Re-run, Review, Feedback, Advance Epic, Load Example Project, Select Epics Folder, …)
- All `cfPipeline.*` configuration keys (`epicsPath`, `platform`, `mcpPackage`, `mcpServerName`, `mcpCommand`, `mcpArgs`, `mcpEnv`, `autoConfigureMcp`, `templateSourcePath`)
- Auto-configure of `.claude/settings.json` `mcpServers.<name>` (the MCP configurator is gone)
- Bundled epic templates (`templates/generic/PRD-TEMPLATE.md`, `TECH-DESIGN-TEMPLATE.md`, …)
- `cfPipeline.openClaudeTerminal` — **renamed** to `aidlc.openClaudeTerminal` (same behavior, new namespace)

**Activity bar:**

- View container id `sdlc-pipeline` → `aidlc` ("AIDLC")
- View id `cfPipelineView` → `aidlcSidebar` ("Workspace")
- The sidebar is now a v2 launcher: **Open Builder** / **Open Claude CLI** / **Open workspace.yaml** / **Switch Project** + a quick stats panel (agents · skills · workflows) and the list of slash commands defined in workspace.yaml

**New (v2 surface):**

- `@aidlc/core` engine — Zod-validated `workspace.yaml` schema, `WorkspaceLoader`, `EnvResolver`, `SkillLoader`, `RunnerRegistry`, `DefaultRunner` (claude CLI shell-out), `CustomRunnerLoader`. 24 unit tests.
- `aidlc.openBuilder` — main-area visual builder panel with agent / skill / workflow cards, ↑↓ step reorder, on-failure toggle, delete actions
- `aidlc.initWorkspace` — scaffold `.aidlc/workspace.yaml` + `.aidlc/skills/hello-skill.md`, opens the folder if not already a workspace
- `aidlc.addSkill` — wizard with 4 sources: load template (5 starters: hello-world, code-reviewer, test-converter, doc-writer, release-notes), paste markdown, upload `.md` file, or open blank file
- `aidlc.addAgent` — wizard: id + display name + skill picker + Claude model picker (sonnet-4-6 / opus-4-7 / haiku-4-5)
- `aidlc.addPipeline` — wizard: id + multi-pick agents (in execution order) + on_failure (stop / continue)
- `aidlc.showWorkspaceConfig` — dump parsed workspace.yaml to the AIDLC output channel (validated, env-resolved)

**Migration:**

- Old `hueanmy.aidlc` listing (last published 0.7.0) is unaffected. Users who want SDLC-style epics should stay on it. The legacy listing will not receive further updates.
- New 0.8.0 onwards are published as `aidlc-io.aidlc-flow`.
- Repo home moved to [aidlc-io/aidlc](https://github.com/aidlc-io/aidlc) with monorepo layout (`packages/core` + `packages/extension`).

## 0.7.2

- feat(ui): redesigned sidebar as a webview — header with logo gradient, "▶ Open Claude CLI" button, per-epic phase strip dots colored by status, action pills (Run / Review / Re-run / Feedback) on each phase row, click row to expand inline details (Input / Output / Command / Artifact + Open Session / Feedback / Review buttons). Replaces the native TreeView.
- feat(terminal): new `cfPipeline.openClaudeTerminal` command — opens a zsh terminal in the bottom panel with `claude` CLI auto-launched; reuses existing terminal if open.
- chore(monorepo): repo restructured to pnpm workspaces with `packages/extension/` (this package) + `packages/core/` (placeholder for v2 engine). No runtime change for users.

## 0.7.1

- chore: migrate publisher from `hueanmy` to `aidlc-io`, source repo to `aidlc-io/aidlc`, and extension `name` from `aidlc` to `aidlc-workspace` (Marketplace requires globally-unique names). New identifier is `aidlc-io.aidlc-workspace`. Marketplace UI still shows "aidlc" via `displayName`. Users on the old `hueanmy.aidlc` listing must reinstall from the new one — a redirect notice will ship as a final 0.7.x release on the old listing.

## 0.7.0

- **breaking**: phase `uat` renamed to `execute-test`; artifact `UAT-SCRIPT.md` renamed to `TEST-SCRIPT.md`. Display label changes from "UAT" to "Execute Test"
- feat: idempotent migration of legacy epic layouts on activation — automatically renames `phases/uat/` → `phases/execute-test/`, `UAT-SCRIPT.md` → `TEST-SCRIPT.md` (incl. archives), updates `status.json` phase field and `pipeline.json` enabledPhases. Shows info notification after migrating
- feat(ui): teal accent palette + dark gradient background for Dashboard and Settings panels, with uppercase section headers and a violet→pink h1 gradient
- feat: extension activation no longer auto-seeds a sample EPIC-1000 — empty workspaces now show the welcome view, with a navbar rocket button that hides once epics exist (driven by `cfPipeline.empty` context key)
- feat: file watcher catches `pipeline.json` create/delete so removing an epic folder refreshes the tree without manual reload
- feat: `Load Example Project` shows a confirm dialog before cloning the demo + opening it in a new window
- chore: rename `UAT-SCRIPT-TEMPLATE.md` → `TEST-SCRIPT-TEMPLATE.md`, refresh epic + release-checklist templates
- compatibility: pairs with `cf-sdlc-pipeline` v2.2.0+ (MCP server side uses matching names)

## 0.6.3

- chore(demo): add agents.html + record-agents.mjs playwright recording scripts
- fix(mcp): drop force-write path + aidlc-pipeline preset from Settings Panel

## 0.6.1

- fix: clicking any inline tree-view button (💬 Add Feedback, 👁 Open Review, 🔔 Review Gate, 🔄 Re-run, ▶ Run, 💬 Update Feedback + Re-run) now correctly invokes its command. Previously the handlers expected `(phase, epic)` but VS Code passes the TreeItem as a single argument for inline menu actions, so clicks were silently no-op

## 0.6.0

- Integrate with cf-sdlc-pipeline orchestrator: read per-phase `status.json` for authoritative state (passed / rejected / stale / awaiting_human_review / failed_needs_human) alongside legacy file-existence check
- Tree view: per-status icons + revision label; epic-level 🔔 / ⛔ badges when any phase needs attention
- New Review Gate webview for `awaiting_human_review` phases — shows auto-reviewer checklist, artifact links, and Approve / Reject with cascade-to-upstream
- Per-phase inline actions: ▶ Run (next pending / stale), 🔄 Re-run (passed / in-progress — archives + marks downstream stale), 💬 Update feedback + Re-run (rejected / failed — writes `user_feedback` for worker)
- Epic inline ▶ Advance button — copies `/advance-epic <KEY>` to clipboard and focuses Claude Code chat
- File watcher now also tracks `status.json` so tree refreshes on orchestrator state changes, not just `.md` edits

## 0.5.12

- fix(dashboard): lift hovered epic card above siblings so popup is never covered

## 0.5.11

- fix(dashboard): show phase detail popup above dot instead of clipped below

## 0.5.10

- Redesign Dashboard + Settings UI with glass theme and icon-matched palette
- Add MCP Pipeline Source UI to Settings Panel
- Add How Sync Works and Troubleshooting sections to README
- Switch MCP default to github:hueanmy/aidlc-pipeline; rename DRM to EPIC

## 0.5.6

- Use absolute GitHub URL for demo GIF on Open VSX

## 0.5.5

- Add UI demo GIF to README (mock VS Code render via Playwright)
- Preserve existing MCP server config on activation — skip overwrite when `mcpServers.<name>` already exists
- Exclude demo source and MP4 from VSIX

## 0.5.3

- Refresh description and document Claude Code + Jira + Figma workflow

## 0.5.2

- Add epics bootstrap and MCP settings configuration
- Exclude local Claude settings from VSIX

## 0.5.1

- Update extension metadata for Open VSX
- Initial commit

## 0.2.0

- Renamed to SDLC Pipeline
- Added pipeline settings panel with per-epic phase toggles
- Improved SEO and marketplace metadata

## 0.1.0

- Initial release
- Epic tree view in sidebar
- Pipeline dashboard with visual phase tracking
- Agent ownership per phase
- Isolated phase sessions
- Auto-refresh on file changes
