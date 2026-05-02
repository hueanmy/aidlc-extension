# Test Plan: [Feature Title]

> **Epic**: [EPIC-XXXX — Epic Title](../epics/EPIC-XXXX/EPIC-XXXX.md)
> **PRD**: [PRD](../epics/EPIC-XXXX/PRD.md)
> **Tech Design**: [Tech Design](../epics/EPIC-XXXX/TECH-DESIGN.md)
> Copy to `docs/sdlc/epics/EPIC-XXXX/TEST-PLAN.md`

---

## Metadata

| Field | Value |
|-------|-------|
| **Epic Key** | EPIC-XXXX |
| **Author** | |
| **QA Reviewer** | |
| **Status** | `draft` / `review` / `approved` |
| **Created** | YYYY-MM-DD |

---

## 1. Test Scope

### In Scope
_What this test plan covers (derived from PRD acceptance criteria)._

| AC ID | Acceptance Criteria | Test Type |
|-------|-------------------|-----------|
| EPIC-XXXX-AC01 | (from PRD) | Unit / UI / Integration |
| EPIC-XXXX-AC02 | | |

### Out of Scope
_What is NOT tested and why._

---

## 2. Device & OS Matrix

> Mark required devices. Camera/hardware features MUST test on real device.

| Device | iOS | Real Device | Simulator | Priority |
|--------|-----|-------------|-----------|----------|
| iPhone SE 3rd | 16.6 (minimum) | ⬜ | ⬜ | Must |
| iPhone 14 | 17.x | ⬜ | ⬜ | Must |
| iPhone 15 Pro | 18.x | ⬜ | ⬜ | Must |
| iPhone 16 Pro Max | 18.x | ⬜ | ⬜ | Should |

### Simulator Limitations (cannot test)
- Camera capture, focus, flash, exposure
- Push notifications
- NFC, Face ID hardware
- Real network transitions (WiFi ↔ cellular)
- Background upload with real URLSession background config

---

## 3. Unit Tests

| ID | Component | Test Description | File | Status |
|----|-----------|-----------------|------|--------|
| EPIC-XXXX-UT01 | ViewModel | State transitions: idle → loading → success/error | `DreemCatcherTests/` | ⬜ |
| EPIC-XXXX-UT02 | ViewModel | Data transformation / mapping | | ⬜ |
| EPIC-XXXX-UT03 | Service | API call with mocked HTTPClient | | ⬜ |
| EPIC-XXXX-UT04 | Model | Codable encode/decode with full response | | ⬜ |
| EPIC-XXXX-UT05 | Model | Codable decode with missing optional fields | | ⬜ |
| EPIC-XXXX-UT06 | Model | Codable decode with unknown extra fields | | ⬜ |

---

## 4. UI Tests

| ID | Flow | Steps | Expected | Device | Status |
|----|------|-------|----------|--------|--------|
| EPIC-XXXX-UI01 | Happy path | 1. Open feature 2. Do action 3. See result | Result displayed | Simulator | ⬜ |
| EPIC-XXXX-UI02 | Error state | 1. Trigger error condition | Error UI shown | Simulator | ⬜ |
| EPIC-XXXX-UI03 | Empty state | 1. Open with no data | Empty state shown | Simulator | ⬜ |

---

## 5. Integration Tests

| ID | Flow | Components | Precondition | Expected | Status |
|----|------|-----------|--------------|----------|--------|
| EPIC-XXXX-IT01 | End-to-end | View → VM → Service → API | Authenticated, DEV backend | Data loaded | ⬜ |
| EPIC-XXXX-IT02 | Token refresh | Expired token → interceptor → retry | Expired token | Transparent refresh | ⬜ |

---

## 6. Mobile-Specific Tests

### Camera Tests (Real Device Only)

| ID | Scenario | Device | Status |
|----|----------|--------|--------|
| EPIC-XXXX-CAM01 | Camera opens, preview shows | Real device | ⬜ |
| EPIC-XXXX-CAM02 | Tap to focus at various points | Real device | ⬜ |
| EPIC-XXXX-CAM03 | Volume button capture | Real device | ⬜ |
| EPIC-XXXX-CAM04 | Camera permission denied → settings prompt | Simulator OK | ⬜ |

### Network Tests

| ID | Scenario | How to Test | Expected | Status |
|----|----------|-------------|----------|--------|
| EPIC-XXXX-NET01 | Offline: no network | Airplane mode | Graceful error / cached data | ⬜ |
| EPIC-XXXX-NET02 | Network loss mid-upload | Toggle airplane during upload | Retry / resume | ⬜ |
| EPIC-XXXX-NET03 | WiFi → cellular transition | Switch network | Socket reconnects | ⬜ |
| EPIC-XXXX-NET04 | Slow network (2G) | Network Link Conditioner | Timeout handling | ⬜ |

### App Lifecycle Tests

| ID | Scenario | Steps | Expected | Status |
|----|----------|-------|----------|--------|
| EPIC-XXXX-LC01 | Background during feature | Press Home | State preserved | ⬜ |
| EPIC-XXXX-LC02 | Return from background | Open app again | Resume correctly | ⬜ |
| EPIC-XXXX-LC03 | Memory warning | Simulate in Xcode | No crash, graceful dealloc | ⬜ |
| EPIC-XXXX-LC04 | Incoming call during capture | Call during camera | Session paused, resumes | ⬜ |
| EPIC-XXXX-LC05 | App killed and relaunched | Force kill | Clean restart, no stale state | ⬜ |

### Permission Tests

| ID | Permission | Scenario | Expected | Status |
|----|-----------|----------|----------|--------|
| EPIC-XXXX-PM01 | Camera | First time: allow | Camera works | ⬜ |
| EPIC-XXXX-PM02 | Camera | First time: deny | Show settings prompt | ⬜ |
| EPIC-XXXX-PM03 | Photo Library | Allow limited access | Show limited photos | ⬜ |

---

## 7. Performance Tests

| ID | Metric | Threshold | How to Measure | Status |
|----|--------|-----------|----------------|--------|
| EPIC-XXXX-PF01 | Screen load time | < 300ms | Instruments: Time Profiler | ⬜ |
| EPIC-XXXX-PF02 | Memory footprint | < 20MB increase | Instruments: Allocations | ⬜ |
| EPIC-XXXX-PF03 | No memory leaks | 0 leaks after 10 cycles | Instruments: Leaks | ⬜ |

---

## 8. Accessibility Tests

| ID | Check | Expected | Status |
|----|-------|----------|--------|
| EPIC-XXXX-A11Y01 | VoiceOver navigation | All elements announced | ⬜ |
| EPIC-XXXX-A11Y02 | Dynamic Type (largest) | Text scales, no truncation | ⬜ |
| EPIC-XXXX-A11Y03 | Color contrast | Meets WCAG AA (4.5:1) | ⬜ |

---

## 9. Regression Checklist

> Existing features that MUST still work after this change.

| Area | Quick Smoke Test | Status |
|------|-----------------|--------|
| Login / Auth | Can log in and reach dashboard | ⬜ |
| Camera capture | Can take photo and preview | ⬜ |
| Upload | Can upload image successfully | ⬜ |
| Chat / AI | Can send message and receive AI response | ⬜ |
| Session list | Sessions load with pagination | ⬜ |

---

## 10. Test Results Summary

> Fill after test execution.

| Category | Total | Pass | Fail | Blocked | Skip |
|----------|-------|------|------|---------|------|
| Unit | | | | | |
| UI | | | | | |
| Integration | | | | | |
| Mobile-specific | | | | | |
| Performance | | | | | |
| Accessibility | | | | | |
| Regression | | | | | |
| **Total** | | | | | |

**Overall Verdict**: ⬜ Pass / ⬜ Fail / ⬜ Pass with known issues

**Known Issues**:
| ID | Description | Severity | Ticket |
|----|-------------|----------|--------|
| | | | EPIC-YYYY |

---

## 11. Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| QA Lead | | | ⬜ |
| Tech Lead | | | ⬜ |
| PM | | | ⬜ |
