---
name: test-plan
description: Generate a test plan for an epic. Covers unit, contract, integration, E2E, non-functional (performance, accessibility, security), and regression — adapted to the stack in play.
argument-hint: "<{{EPIC_PREFIX}}-XXXX>"
---

# Test Plan for Epic $0

You are the **QA Engineer (QA)** agent — a senior test practitioner with experience designing strategy across web, mobile, desktop, backend, and CLI.
Load your full persona from `.claude/agents/qa.md` before starting.

## Step 0: Pipeline Gate Check
Read and execute `.claude/skills/_gate-check.md`. This skill = phase `test-plan`, epic = `$0`. If gate fails → STOP.

## Steps

1. Read the epic: `docs/sdlc/epics/$0/$0.md`
2. Read the PRD: `docs/sdlc/epics/$0/PRD.md` — acceptance criteria are your test inputs
3. Read the tech design: `docs/sdlc/epics/$0/TECH-DESIGN.md` — file impact drives unit/integration scope
4. Read existing tests / patterns / fixtures in the project so new tests match the style
5. Read the test plan template: `docs/sdlc/epics/$0/TEST-PLAN.md` or `docs/sdlc/templates/TEST-PLAN-TEMPLATE.md`
6. Fill the test plan with the sections below — pick the test categories that apply to the stack in play

## Test Plan Contents

### Test Scope
- Map each AC to one or more test types (Unit / Contract / Integration / E2E / NFR)
- Call out what is **out of scope** and why

### Environment / Compatibility Matrix
Pick only what's relevant to the stack. Don't pad with categories that don't apply.

| Surface | Matrix dimensions (examples) |
|---------|------------------------------|
| Web | Chromium / Firefox / Safari × Desktop / Mobile viewport × OS (for native quirks) |
| Mobile | Min-supported OS / Current / Latest × Screen sizes × Locale / RTL |
| Desktop | macOS / Windows / Linux × Arch (x64 / arm64) × Installed vs. portable |
| Backend | Runtime version × DB version × OS × Region (if multi-region) |
| CLI | OS × Shell × TTY / non-TTY × Interactive / piped |

Mark which combos are **must-test** vs. **spot-check**. Note which can run in CI vs. require real infrastructure.

### Unit Tests — prefix `$0-UT`
- Pure logic, state transitions, parsers, serializers, mappers
- Deterministic — inject clock, seed randomness, no network
- Boundary conditions (empty, max, null, duplicates, unicode, very-large)

### Contract Tests — prefix `$0-CT` (if the epic exposes or consumes an interface)
- Request / response shapes for HTTP / RPC / GraphQL / IPC / WebSocket
- Error envelope conformance
- Schema compatibility (consumer-driven contracts where appropriate)

### Integration Tests — prefix `$0-IT`
- Multi-module flows with real dependencies where feasible (test DB, test filesystem, test server fixture)
- Auth refresh / token lifecycle
- Cross-layer flows validated end-to-end within a process

### UI / Component Tests — prefix `$0-UI` (if applicable)
- Rendering, interaction, accessibility tree
- Happy path, error state, empty state, loading state
- Keyboard navigation, focus management (for web/desktop)

### End-to-End Tests — prefix `$0-E2E` (if applicable)
- Full flows across real processes / browsers / devices
- Keep thin — these are flaky and expensive; use for the top risks only

### Failure-Mode Tests

Choose the categories that fit the stack.

- **Network / Connectivity** (`$0-NET`): offline, disconnect mid-call, slow / lossy, network switch (mobile)
- **Lifecycle / Process** (`$0-LC`): suspend / resume, restart, upgrade path, low-memory, kill & restart (mobile/desktop)
- **Access / Permission** (`$0-PM`): first grant, first deny, previously denied, partial scope
- **Upstream failure** (`$0-UP`): 4xx / 5xx / timeout / rate-limit from dependencies — graceful handling
- **Concurrency** (`$0-CC`): race conditions, double-submit, optimistic-concurrency conflicts

### Non-Functional Tests

- **Performance** (`$0-PF`) — latency p50/p95/p99, throughput, memory, bundle/artifact size, rendering FPS (UI), cold-start (mobile/desktop). State thresholds, not just measurements.
- **Accessibility** (`$0-A11Y`) — screen reader announcements, keyboard reachability, contrast, text-scale, motion preferences
- **Security** (`$0-SEC`) — authZ matrix, input validation, injection (XSS/SQLi/command), secrets-in-artifact scans

### Regression Checklist
- Core flows that must still work after this change (keep the list short and high-signal)

### Test Data Strategy
- Factories / builders over static fixtures
- Isolation per test (separate DB / schema / namespace; no shared state)
- Seeding strategy for integration / E2E

### Flaky-Test Policy
- Deterministic: inject clock, seed randomness, stub network
- Isolated: each test owns its data
- Idempotent: no order dependencies
- Quarantine flaky tests; fix or delete — don't retry-to-green

## Output

Write the completed test plan to `docs/sdlc/epics/$0/TEST-PLAN.md`.
