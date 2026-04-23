# Changelog

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
