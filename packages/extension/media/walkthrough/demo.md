# Demo project — what gets loaded

Running **Load Demo Project** drops the following into your current folder under `.aidlc/`:

- **`workspace.yaml`** — a multi-agent SDLC pipeline (planner → coder → reviewer → release-notes)
- **`skills/`** — 5 starter skill markdown files used by the agents
- **`epics/`** — 6 sample epics in different states (pending, in progress, awaiting review, done)
- **`runs/`** — pre-seeded run history so the sidebar shows live data immediately

Nothing outside `.aidlc/` is touched. Delete the folder to roll everything back.

> Tip: open the AIDLC sidebar (activity bar icon) after loading — agent / skill / pipeline counts and active runs appear instantly.
