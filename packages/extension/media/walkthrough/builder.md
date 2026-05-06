# Workspace Builder

A main-area panel that renders the parsed `workspace.yaml` as cards:

- **Agents** — id, model (Sonnet 4.6 / Opus 4.7 / Haiku 4.5), assigned skill
- **Skills** — markdown bodies, edit inline or open the source `.md` file
- **Pipelines** — ordered chain of agents with `on_failure: stop | continue` per step

Every edit writes back to `.aidlc/workspace.yaml` atomically — the CLI and the extension stay in sync within ~200ms.

> Add Agent / Add Skill / Add Pipeline wizards live in the panel header and the command palette (`AIDLC: Add …`).
