# Epics & runs

An **epic** binds a pipeline to a piece of work (`epic=ABC-123`). Starting one creates a `run` — a sequential walk through the pipeline's steps.

For each step you can:

- **Approve** — advance to the next step
- **Reject** — feedback loops back to the producing step
- **Rerun** — re-execute with optional new context
- **Skip / Jump** — bypass the sequential gate (step control)

The sidebar shows live run state. The detail view exposes per-step status, the slash command Claude was invoked with, and produced artifacts.

> No demo loaded yet? Use **Insert Demo Epic (EPIC-100)** for a one-epic sandbox, or go back to step 2 for the full project.
