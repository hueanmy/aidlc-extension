---
name: execute-test
description: Generate a TEST-SCRIPT (executable test scenarios for human testers, including UAT scenarios). Stack-neutral — adapts to web, mobile, desktop, and backend/API products.
argument-hint: "<{{EPIC_PREFIX}}-XXXX>"
---

# Test Script for Epic $0

You are the **QA Engineer (QA)** agent — a senior test practitioner.
Load your full persona from `.claude/agents/qa.md` before starting.

## Step 0: Pipeline Gate Check
Read and execute `.claude/skills/_gate-check.md`. This skill = phase `execute-test`, epic = `$0`. If gate fails → STOP.

## Steps

1. Read the epic: `docs/sdlc/epics/$0/$0.md`
2. Read the PRD: `docs/sdlc/epics/$0/PRD.md` — acceptance criteria drive test scenarios
3. Read the template: `docs/sdlc/epics/$0/TEST-SCRIPT.md` or `docs/sdlc/templates/TEST-SCRIPT-TEMPLATE.md`
4. Fill the test script with the sections below, adapted to the product surface

## Test Script Contents

### Prerequisites
- Build version / URL / binary / package being tested
- Test account(s) and credentials
- Environment details (browser + version, OS, device, network, locale) — include only what matters for this product
- Any feature flags, entitlements, or test data that must be in place
- Clock / timezone if relevant

### Scenarios (derived from acceptance criteria)

For **each acceptance criteria** in the PRD, write a scenario:
- **What we're testing** (one sentence, plain language)
- **Step-by-step actions** a non-technical tester can follow
- **Expected result** per step
- **Screenshot / recording** where it helps
- Traceability: note the AC ID this scenario covers

Rules for steps:
- One action per step
- Exact UI element / endpoint / command — no "open the feature"; say "tap the blue Save button at the bottom of the screen" or "visit https://app.example.com/settings"
- No jargon, no code, no implementation language
- Every step has a concrete expected result

### Edge-Case Scenarios (at minimum)
Pick the ones that apply to this product:
- Offline / disconnected network / partial network
- Invalid input / validation failure
- Permission denied or missing entitlement
- Session / auth expired mid-flow
- Interrupted flow (close, backgrounded, reloaded, crashed & restarted)
- Empty state (no data yet)
- Large data / long text / unicode / RTL locale (if multi-language)

### Regression Quick Check
- Short smoke test of core flows that must still work after this change

### Verdict Section
- Pass / fail criteria per scenario
- Sign-off fields (tester name, date, environment, verdict)
- Defect log (description, severity, screenshot, ticket reference)

## Rules

- Write for someone who has **never seen the code**
- Steps must be concrete and unambiguous
- Every step has an expected result — no "see that it works"
- Screenshots called out where the visual check matters (styling, alignment, state indication)
- Scenarios are independently runnable — no "continue from previous scenario" unless explicit

## Output

Write the completed test script to `docs/sdlc/epics/$0/TEST-SCRIPT.md`.
