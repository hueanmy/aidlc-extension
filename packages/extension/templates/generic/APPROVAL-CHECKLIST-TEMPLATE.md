# Approval Checklist: [Feature Title]

> **Epic**: [EPIC-XXXX — Epic Title](../epics/EPIC-XXXX/EPIC-XXXX.md)
> Copy to `docs/sdlc/epics/EPIC-XXXX/APPROVAL.md`

---

## Pre-Implementation Gate

> All items must be checked before implementation begins.

### Product Readiness (PM Sign-off)

- [ ] PRD is complete with all acceptance criteria
- [ ] User flow covers happy path AND error/edge cases
- [ ] Figma designs approved (or UI spec described in PRD)
- [ ] Analytics events defined
- [ ] Dependencies identified and status confirmed
- [ ] Open questions resolved (no blockers)

**PM**: _________________ **Date**: _________ **Verdict**: ⬜ Approved / ⬜ Needs revision

---

### Technical Readiness (Tech Lead Sign-off)

- [ ] Tech design reviewed and approved
- [ ] API contract agreed with backend team
- [ ] File impact analysis complete
- [ ] DI registration plan clear
- [ ] State management approach decided
- [ ] No architectural concerns or risks unaddressed
- [ ] Performance budget defined

**Mobile-Specific**:
- [ ] Camera impact assessed (if applicable)
- [ ] Offline behavior designed (if applicable)
- [ ] Permission flow designed (if applicable)
- [ ] iOS version compatibility verified (16.6+)

**Tech Lead**: _________________ **Date**: _________ **Verdict**: ⬜ Approved / ⬜ Needs revision

---

### QA Readiness (QA Lead Sign-off)

- [ ] Test plan reviewed and approved
- [ ] Device matrix defined
- [ ] Real-device test slots reserved (if camera/hardware)
- [ ] Test data / fixtures identified
- [ ] Regression scope defined
- [ ] Performance thresholds set

**QA Lead**: _________________ **Date**: _________ **Verdict**: ⬜ Approved / ⬜ Needs revision

---

## Gate Decision

| Criterion | Status |
|-----------|--------|
| PM Approved | ⬜ |
| Tech Lead Approved | ⬜ |
| QA Lead Approved | ⬜ |
| All dependencies ready | ⬜ |

**Final Decision**: ⬜ **GO** — Proceed to implementation / ⬜ **NO-GO** — Revisions needed

**Reason (if NO-GO)**: _________________________________

---

## Post-Implementation Gate

> Check before merging to release branch.

- [ ] All acceptance criteria met (linked PR)
- [ ] Code review passed (no blockers)
- [ ] Unit tests passing with adequate coverage
- [ ] UI tests passing on target devices
- [ ] Integration tests passing on DEV/UAT backend
- [ ] No P0/P1 bugs open
- [ ] Performance within budget
- [ ] Analytics events verified firing correctly
- [ ] Doc reverse-sync completed

**Decision**: ⬜ **Merge to release** / ⬜ **Hold** — issues to resolve first
