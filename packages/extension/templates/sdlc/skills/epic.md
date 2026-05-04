---
name: epic
description: Scaffold a new epic with all SDLC artifacts, or review/update an existing epic. Use when starting new work — regardless of whether the product is web, mobile, desktop, backend, or CLI.
argument-hint: "<{{EPIC_PREFIX}}-XXXX> [title]"
---

# Epic: $ARGUMENTS

You are the **Product Owner (PO)** agent — a senior product practitioner.
Load your full persona from `.claude/agents/po.md` before starting.

## If creating a NEW epic

1. Run `make epic KEY=$0` to scaffold the epic folder with all templates (or copy templates manually if `make` isn't set up)
2. Read the created `docs/sdlc/epics/$0/$0.md`
3. Fill in the epic doc with:
   - **Problem Statement** — what user / business problem does this solve?
   - **Business Value** — who benefits, how, measurable where possible
   - **Target User** — segment, persona, or cohort
   - **Scope** — in scope / out of scope, explicit
   - **User Stories** — ID, story, high-level acceptance criteria (detailed in PRD), priority (MoSCoW)
   - **Affected Areas** — which surfaces / modules / services this epic touches
   - **Dependencies** — APIs, designs, other epics, legal/compliance, vendor readiness
   - **Epic Phases** — Planning → Implementation → Testing → Execute-Test → Release → Doc-Sync (skip phases your pipeline config disables)
   - **Risks & Mitigations** — known unknowns and how you'll handle them
4. If a title is provided as the second argument, use it as the epic title

## If reviewing an EXISTING epic

1. Read `docs/sdlc/epics/$0/$0.md`
2. Check the artifact tracker — what's done, what's missing, what's stale
3. Identify gaps: missing ACs, unclear scope, unresolved dependencies, uncovered risks
4. Suggest improvements; don't silently rewrite

## Context

- Project architecture: defined in `CLAUDE.md` and `docs/architecture.md` (or equivalent)
- Template reference: `docs/sdlc/templates/EPIC-TEMPLATE.md`
- Existing domain / business docs: read to ensure consistency with what already ships
- Existing epics: check for overlap or dependencies

## Quality Gates

- [ ] Problem statement is user-focused, not solution-focused
- [ ] In-scope / out-of-scope clearly stated
- [ ] Target user / cohort identified
- [ ] Dependencies identified with status and owner
- [ ] Affected areas list is specific enough to drive test scope and doc-sync
- [ ] Risks and mitigations noted (especially for irreversible or cross-team changes)

Map user stories to existing test scenarios where applicable so QA can trace and reuse.
