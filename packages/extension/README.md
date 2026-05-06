# AIDLC Flow

Agent workflow runner for VS Code. Define agents, skills, and pipelines in a single `workspace.yaml` and build, edit, and run them visually without leaving the editor.

## Features

- **Workspace Builder** — main-area panel with agent / skill / pipeline cards, drag-style reorder, on-failure toggle, and delete actions
- **Sidebar webview** — quick stats (agents · skills · pipelines) plus the slash commands declared in `workspace.yaml`
- **Add Skill wizard** — 4 sources: load template, paste markdown, upload a `.md` file, or open a blank file. 5 starter templates: hello-world, code-reviewer, test-converter, doc-writer, release-notes
- **Add Agent wizard** — id, display name, skill picker, model picker (Sonnet 4.6 / Opus 4.7 / Haiku 4.5)
- **Add Pipeline wizard** — chain agents in execution order with on-failure behavior (stop / continue)
- **Workspace templates** — save the whole workspace as a named preset and reapply it in any project
- **Built-in Claude CLI terminal** — one-click zsh terminal in the bottom panel with the `claude` CLI auto-launched
- **Workspace inspector** — dump the parsed, validated, env-resolved `workspace.yaml` to the output channel

## How It Works

The extension reads `.aidlc/workspace.yaml` from the open folder and uses [`@aidlc/core`](../core) to validate the schema (Zod), resolve env variables, load skills and agents, and execute pipelines through the Claude CLI runner (or a custom runner you register).

```
.aidlc/
├── workspace.yaml          # agents, skills, pipelines, sidebar layout
├── skills/                 # markdown skill files
│   ├── hello-skill.md
│   └── ...
└── agents/                 # optional per-agent overrides
```

## Getting Started

1. Install **AIDLC Flow** from the VS Code Marketplace or Open VSX.
2. Open a workspace folder.
3. Run **AIDLC: Init Sample Workspace** from the command palette — the extension scaffolds `.aidlc/workspace.yaml` plus a `hello-skill.md`.
4. Click the **AIDLC** icon in the activity bar to open the sidebar.
5. Click **Open Workspace Builder** to see your agents, skills, and pipelines visually.
6. Use **Open Claude CLI Terminal** to run a pipeline against the Claude CLI.

## Commands

All commands are available via `Cmd+Shift+P` (or `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `AIDLC: Open Workspace Builder` | Visual builder for agents, skills, and pipelines |
| `AIDLC: Init Sample Workspace` | Scaffold `.aidlc/workspace.yaml` + sample skill |
| `AIDLC: Show Workspace Config` | Dump parsed workspace.yaml to the AIDLC output channel |
| `AIDLC: Add Skill (template / paste / upload / blank)` | Add a new skill from one of four sources |
| `AIDLC: Add Agent` | Wizard to add a new agent (skill + model) |
| `AIDLC: Add Pipeline (chain agents)` | Wizard to chain agents into a pipeline |
| `AIDLC: Save Workspace as Template` | Save the current workspace as a reusable preset |
| `AIDLC: Load Template` | Apply a saved preset to the open workspace |
| `AIDLC: Delete Saved Template` | Remove a saved preset |
| `AIDLC: Open Claude CLI Terminal` | Open a zsh terminal with `claude` auto-launched |
| `AIDLC: Start Epic` | Begin a new epic from the sidebar |
| `AIDLC: Open Epics List` | Browse epics in the open workspace |
| `AIDLC: Insert Demo Epic (EPIC-100)` | Drop a demo epic into the workspace for exploration |

## Requirements

- VS Code 1.85.0+ (or compatible: VSCodium, Cursor, Windsurf)
- A workspace folder (single-file mode is not supported)
- The Claude CLI on `PATH` for the default runner
- Node.js 20+ to compile from source

## License

MIT
