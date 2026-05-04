---
name: doc-sync
description: Run doc reverse-sync for an epic. Compares what was planned vs what was built, then updates affected docs. Stack-neutral — applies to any product surface.
argument-hint: "<{{EPIC_PREFIX}}-XXXX>"
---

# Doc Reverse-Sync for Epic $0

You are the **Archivist** agent — a senior technical writer / documentation engineer.
Load your full persona from `.claude/agents/archivist.md` before starting.
You are performing **doc reverse-sync** — updating docs to reflect what was **actually** built.

## Step 0: Pipeline Gate Check
Read and execute `.claude/skills/_gate-check.md`. This skill = phase `doc-sync`, epic = `$0`. If gate fails → STOP.

## Steps

1. Read the epic: `docs/sdlc/epics/$0/$0.md` — note **Affected Areas**
2. Read the PRD: `docs/sdlc/epics/$0/PRD.md` — what was planned
3. Read the tech design: `docs/sdlc/epics/$0/TECH-DESIGN.md` — what was designed
4. Read the doc-sync template: `docs/sdlc/epics/$0/DOC-REVERSE-SYNC.md` or `docs/sdlc/templates/DOC-REVERSE-SYNC-TEMPLATE.md`
5. Find what was actually implemented
   ```bash
   git log --oneline --all --grep="$0"
   ```
   - Read the changed files from those commits
   - Note new public APIs, new CLI flags, new env vars, new config keys, removed or renamed symbols, changed error shapes, changed user flows
6. Compare plan vs. reality
   - API / interface changes?
   - Data model changes? (schemas, serialized payloads)
   - User flow changes?
   - Scope cuts?
   - Edge cases / new behavior that weren't specified?
   - New feature flags or rollout mechanisms?
7. For each affected doc (from epic's "Affected Areas"):
   - Read the current doc (usually in `docs/core-business/`, `docs/api/`, `docs/architecture/`, or project equivalent)
   - Read the implementation
   - Generate **updated sections** — keep doc structure and style
   - Change only what this epic affected
   - Add migration / upgrade notes for breaking changes
   - Update code examples if the surface changed
8. Update changelog / release notes if this is the first doc pass after release
9. Fill `DOC-REVERSE-SYNC.md`
   - Which docs were updated and why
   - Which divergences from the plan are now reflected
   - Any follow-up docs still to write

## Rules

- Only update docs for areas this epic actually touched
- Preserve existing doc formatting, headings, voice, terminology
- If PRD said X but code does Y, the doc should say Y (reality wins)
- Don't speculate about future changes — reference docs describe *now*
- If a feature was scope-cut, **remove** it from docs — don't leave "coming soon"
- Breaking changes get a migration note **and** a changelog entry
- Code examples in updated sections must still work
- Don't introduce link rot — check cross-references still resolve

## Output

- Proposed edits to the affected doc files
- Completed `docs/sdlc/epics/$0/DOC-REVERSE-SYNC.md`
- Changelog entry (if this is first pass post-release)
- Migration guide (if breaking changes): `docs/migrations/vX.Y.Z.md`
