# Epic: [EPIC-KEY] — [Epic Title]

> Copy this template to `docs/sdlc/epics/[EPIC-KEY]/[EPIC-KEY].md`
> Example: `docs/sdlc/epics/EPIC-2100/EPIC-2100.md`
>
> **Epic Key** is the single identifier for all work. All artifacts, PRs, branches, and docs reference this key.

---

## Overview

| Field | Value |
|-------|-------|
| **Epic Key** | EPIC-XXXX |
| **Title** | |
| **Owner** | |
| **Priority** | P0 / P1 / P2 / P3 |
| **Status** | `backlog` → `planning` → `in-progress` → `review` → `done` → `released` |
| **Estimated Size** | S / M / L / XL |
| **Created** | YYYY-MM-DD |
| **Target Release** | vX.Y.Z |
| **Last Updated** | YYYY-MM-DD |

---

## Problem Statement

_What problem does this epic solve? Why now?_

## Business Value

_Who benefits and how? Include metrics if possible (e.g., "reduce upload failure rate from 8% to <2%")._

---

## Scope

### In Scope
- [ ] Feature/change 1
- [ ] Feature/change 2

### Out of Scope
- Item explicitly excluded and why

---

## User Stories

| ID | Story | Acceptance Criteria | Priority | Status |
|----|-------|-------------------|----------|--------|
| EPIC-XXXX-01 | As a [user], I want [action] so that [benefit] | Given/When/Then (detail in PRD) | Must | ⬜ |
| EPIC-XXXX-02 | | | Should | ⬜ |
| EPIC-XXXX-03 | | | Could | ⬜ |

---

## Affected App Areas

> Check all areas this epic touches. This drives the test matrix, review assignments, and doc reverse-sync.

- [ ] **Camera & Capture** — AVFoundation, shot types, preview
- [ ] **Chat & AI** — SignalR socket, tool calls, AI results
- [ ] **Upload Pipeline** — S3 presigned URL, asset processing
- [ ] **Authentication** — Login, token refresh, providers
- [ ] **Session Management** — CRUD, pagination, bookmarks
- [ ] **Wardrobe & Outfit** — Outfit builder, background removal
- [ ] **Dashboard / Navigation** — Tab bar, coordinators
- [ ] **Design System** — Colors, typography, components
- [ ] **Networking** — HTTPClient, interceptors, APIs
- [ ] **Analytics** — Segment events, Mixpanel
- [ ] **Permissions** — Camera, photo library, notifications
- [ ] **Onboarding** — First-time UX, permissions flow

---

## Dependencies

| Dependency | Type | Status | Blocked? | Owner |
|-----------|------|--------|----------|-------|
| Backend API endpoint ready | External | ⬜ Ready | | Backend team |
| Figma designs approved | External | ⬜ Ready | | Design team |
| Other epic: EPIC-YYYY | Internal | ⬜ Done | | |
| Third-party SDK update | External | ⬜ Ready | | |

---

## Epic Phases

> Break this epic into ordered phases. Each phase has a clear deliverable.
> Unlike sprints (which are time-boxed), phases are scope-boxed and complete when done.

| Phase | Scope | Deliverable | Status |
|-------|-------|-------------|--------|
| 1. Planning | PRD + Tech Design + Test Plan + Approval | All artifacts approved | ⬜ |
| 2. Core Implementation | EPIC-XXXX-01, EPIC-XXXX-02 | Working feature on DEV | ⬜ |
| 3. Testing & Polish | Edge cases, device testing, bug fixes | All tests passing | ⬜ |
| 4. UAT & Release | UAT sign-off, release build | Included in vX.Y.Z | ⬜ |
| 5. Doc Reverse-Sync | Update docs from what was built | Docs reflect reality | ⬜ |

---

## Pipeline — Artifacts Tracker

> Every artifact is keyed to this epic. Check off as completed.
> Branch naming: `feature/[EPIC-KEY]-short-desc` (e.g., `feature/EPIC-2100-tap-to-focus`)
> PR title: `[EPIC-KEY] description` (e.g., `[EPIC-2100] Add tap-to-focus visual feedback`)
> Commit prefix: `EPIC-XXXX description`

| Stage | Artifact | Status | Link |
|-------|----------|--------|------|
| **Planning** | | | |
| Requirement | This epic doc | ✅ | (this file) |
| Product/UX | PRD | ⬜ | `epics/EPIC-XXXX/PRD.md` |
| Product/UX | Figma designs | ⬜ | (Figma link) |
| Tech Design | Technical design doc | ⬜ | `epics/EPIC-XXXX/TECH-DESIGN.md` |
| Test Planning | Test plan | ⬜ | `epics/EPIC-XXXX/TEST-PLAN.md` |
| Approval | Approval checklist | ⬜ | `epics/EPIC-XXXX/APPROVAL.md` |
| **Execution** | | | |
| Implementation | PR(s) | ⬜ | (GitHub PR links) |
| Code Review | Review passed | ⬜ | (PR review links) |
| Unit Tests | Passing | ⬜ | (CI link) |
| UI/Device Tests | Passing | ⬜ | (CI link / manual report) |
| Integration Tests | Passing | ⬜ | (CI link) |
| **Delivery** | | | |
| CI/CD Build | TestFlight build | ⬜ | (TestFlight link) |
| UAT Script | UAT test script | ⬜ | `epics/EPIC-XXXX/UAT-SCRIPT.md` |
| UAT | UAT sign-off | ⬜ | |
| Release | Included in version | ⬜ | vX.Y.Z |
| **Closure** | | | |
| Doc Reverse-Sync | Docs updated | ⬜ | `epics/EPIC-XXXX/DOC-REVERSE-SYNC.md` |

---

## Doc Reverse-Sync

> After implementation, which docs need updating to reflect what was ACTUALLY built?
> Only check docs for areas marked in "Affected App Areas" above.

| Doc File | Affected? | What Changed | PR | Updated? |
|----------|-----------|-------------|-----|----------|
| `01-authentication.md` | ⬜ | | | ⬜ |
| `02-app-lifecycle.md` | ⬜ | | | ⬜ |
| `03-session-management.md` | ⬜ | | | ⬜ |
| `04-camera-and-capture.md` | ⬜ | | | ⬜ |
| `05-chat-and-ai.md` | ⬜ | | | ⬜ |
| `06-wardrobe-and-outfit.md` | ⬜ | | | ⬜ |
| `07-asset-pipeline.md` | ⬜ | | | ⬜ |
| `08-networking.md` | ⬜ | | | ⬜ |
| `09-socket-realtime.md` | ⬜ | | | ⬜ |
| `10-supporting-services.md` | ⬜ | | | ⬜ |
| `11-screen-transitions-flow-use-cases-acceptance.md` | ⬜ | | | ⬜ |
| `README.md` (architecture) | ⬜ | | | ⬜ |

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| | High/Med/Low | High/Med/Low | |

---

## Notes / Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| YYYY-MM-DD | | |
