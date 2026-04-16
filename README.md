# SDLC Pipeline

Track SDLC pipeline progress for software epics directly in VS Code. Visualize every phase — from planning to release — with agent ownership and real-time status.

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
