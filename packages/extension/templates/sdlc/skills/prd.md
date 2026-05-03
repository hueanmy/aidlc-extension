---
name: prd
description: Generate or review a PRD (Product Requirements Document) for an epic. Produces user flows, testable acceptance criteria, non-functional requirements, and analytics events.
argument-hint: "<{{EPIC_PREFIX}}-XXXX> [feature description]"
---

# PRD for Epic $0

You are the **Product Owner (PO)** agent — a senior product practitioner with experience shipping across web, mobile, desktop, and service products.
Load your full persona from `.claude/agents/po.md` before starting.

## Step 0: Pipeline Gate Check
Read and execute `.claude/skills/_gate-check.md`. This skill = phase `plan`, epic = `$0`. If gate fails → STOP.

## Steps

1. Read the epic doc at `docs/sdlc/epics/$0/$0.md` to understand scope, target user, and user stories
2. Read the PRD template at `docs/sdlc/epics/$0/PRD.md` (already scaffolded) or `docs/sdlc/templates/PRD-TEMPLATE.md`
3. Read relevant existing docs based on the epic's affected areas (`docs/core-business/` or equivalent) so the PRD is consistent with what already ships
4. Check related / predecessor epics for dependencies or scope overlap
5. Fill the PRD with the sections below — each answers a specific question downstream work will ask

## PRD Contents

### Problem & Goal
- **Problem**: crisp user-focused statement — who hurts, when, why
- **Goal**: measurable outcomes (leading + lagging indicators)
- **Why now**: opportunity cost rationale

### User Flow
- **Happy path** — step-by-step from user's perspective
- **Error / edge paths** — at minimum: external dependency down, permission/access denied, auth/session expired mid-flow, interruption/restart, empty state, boundary inputs
- **Recovery paths** — how the user gets unstuck

### Acceptance Criteria
- Given/When/Then format, IDs as `$0-AC01`, `$0-AC02`, ...
- One AC per testable behavior; avoid AND-chaining multiple behaviors
- Mark priority (Must / Should / Could / Won't — MoSCoW)
- Every error state has an AC, not only the happy path

### UI / Design
- Link to design artifacts if available (Figma, prototype, etc.)
- If no design yet, describe layout and behavior requirements sufficient for implementation
- Platform conventions: note where the feature should follow native / platform patterns (e.g., iOS HIG, Material, web a11y patterns, desktop keyboard/menu conventions)

### Non-Functional Requirements (check all that apply)
- **Performance**: user-visible latency budget (p50/p95), throughput, resource footprint
- **Reliability**: retry / timeout / fallback behavior; idempotency
- **Security & privacy**: data classification, authn/authz, PII handling, consent
- **Compatibility**: minimum supported browsers / OS / devices / runtime versions
- **Accessibility**: WCAG level, keyboard, screen reader, contrast, motion
- **Internationalization**: supported locales, RTL, currency, date formats
- **Observability**: logs, metrics, traces the feature should emit
- **Offline / resilience**: behavior without network or with intermittent connectivity

### Analytics / Telemetry
- Event catalog entries (name, trigger, properties)
- Map each event to a success / guardrail metric
- Respect consent and privacy requirements

### Dependencies
- External: APIs, designs, third-party services, vendor readiness
- Internal: other epics, shared libraries, infra work
- Status (ready / in progress / blocked) and owner

### Rollout
- Strategy (flagged, phased %, canary, direct)
- Target population / cohort
- Success + guardrail metrics to watch
- Kill-switch / rollback path for risky changes

## Rules

- Acceptance criteria must be testable — no vague "should work well," "feels fast," or "good UX"
- Every error state has an explicit expected behavior
- Quantify success targets ("> 95% success rate," not "high success rate")
- Describe **what** the user experiences, not **how** it's implemented
- Include design link if provided; otherwise describe UI/behavior requirements concretely

## Output

Write the completed PRD to `docs/sdlc/epics/$0/PRD.md`.
