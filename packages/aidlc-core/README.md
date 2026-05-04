# @aidlc/core

Pure-Node AIDLC workflow logic. No VSCode, no CLI dependency. Imported by both
the VSCode extension and (soon) the `aidlc` CLI so phases, status I/O, and
templates have a single source of truth.

Currently exports:

- `EpicScanner` — discovers epics under `docs/sdlc/epics/` and reads
  `phases/<phase>/status.json` written by the orchestrator.
- `ensureEpicsBootstrap`, `getArtifactTemplate` — template rendering for
  bootstrapping new epics.
- `migrateEpics` — idempotent legacy schema migrations.

See `../../PLAN.md` for the broader CLI roadmap (M1–M5).
