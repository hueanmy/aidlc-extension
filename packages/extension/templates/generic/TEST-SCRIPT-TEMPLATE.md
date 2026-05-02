# Test Script: [Feature Title]

> **Epic**: [EPIC-XXXX — Epic Title](../epics/EPIC-XXXX/EPIC-XXXX.md)
> **TestFlight Build**: vX.Y.Z (Build XX)
> **Environment**: UAT (`uat.dreem.ai`)
> Copy to `docs/sdlc/epics/EPIC-XXXX/TEST-SCRIPT.md`
>
> This script is for **non-technical testers** (PM, stakeholders). Write steps they can follow on their device.

---

## Prerequisites

- [ ] TestFlight app installed on iPhone
- [ ] Accepted TestFlight invite for DreemCatcher UAT
- [ ] Build vX.Y.Z (XX) installed and visible in TestFlight
- [ ] Logged into test account: `_________________`
- [ ] Device: iPhone _________ running iOS _________
- [ ] Network: WiFi connected

---

## Test Scenarios

### Scenario 1: [Happy Path — Main Flow]

**What we're testing**: _One sentence description_

| Step | Action | Expected Result | Pass? | Notes |
|------|--------|----------------|-------|-------|
| 1 | Open DreemCatcher app | App loads to dashboard | ⬜ | |
| 2 | [Action] | [Expected] | ⬜ | |
| 3 | [Action] | [Expected] | ⬜ | |
| 4 | [Action] | [Expected] | ⬜ | |
| 5 | Verify result | [Expected final state] | ⬜ | |

**Screenshot required**: Step ___

---

### Scenario 2: [Error/Edge Case]

**What we're testing**: _What happens when something goes wrong_

| Step | Action | Expected Result | Pass? | Notes |
|------|--------|----------------|-------|-------|
| 1 | [Setup condition] | [State ready] | ⬜ | |
| 2 | [Trigger error] | [Error message / graceful handling] | ⬜ | |
| 3 | [Recovery action] | [App recovers] | ⬜ | |

---

### Scenario 3: [Offline / Network Edge Case]

**What we're testing**: _Behavior without network_

| Step | Action | Expected Result | Pass? | Notes |
|------|--------|----------------|-------|-------|
| 1 | Turn on Airplane Mode | No crash | ⬜ | |
| 2 | [Try action that needs network] | [Error message / cached data] | ⬜ | |
| 3 | Turn off Airplane Mode | [App recovers / syncs] | ⬜ | |

---

## Regression Quick Check

> Verify existing features still work after this change.

| # | Check | Steps | Pass? |
|---|-------|-------|-------|
| 1 | App launches | Open app, reaches dashboard | ⬜ |
| 2 | Login works | Log out, log back in | ⬜ |
| 3 | Camera works | Open camera, take photo | ⬜ |
| 4 | Upload works | Upload a photo | ⬜ |
| 5 | Chat works | Send message, get AI response | ⬜ |

---

## Issues Found

| # | Scenario | Step | Description | Severity | Screenshot | Ticket |
|---|----------|------|-------------|----------|------------|--------|
| 1 | | | | P0/P1/P2/P3 | | EPIC-YYYY |

---

## Test Verdict

| Criterion | Status |
|-----------|--------|
| All happy path scenarios pass | ⬜ |
| No P0/P1 issues open | ⬜ |
| Regression checks pass | ⬜ |
| Performance acceptable (no visible lag) | ⬜ |

**Verdict**: ⬜ **PASS** — Ready for release / ⬜ **FAIL** — Issues must be fixed first

**Tested by**: _________________ **Date**: _________ **Device**: _________
