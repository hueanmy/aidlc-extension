# PRD: [Feature Title]

> **Epic**: [EPIC-XXXX — Epic Title](../epics/EPIC-XXXX/EPIC-XXXX.md)
> Copy to `docs/sdlc/epics/EPIC-XXXX/PRD.md`

---

## Metadata

| Field | Value |
|-------|-------|
| **Epic Key** | EPIC-XXXX |
| **Author** | |
| **Reviewer** | |
| **Status** | `draft` / `review` / `approved` / `superseded` |
| **Created** | YYYY-MM-DD |
| **Approved** | YYYY-MM-DD |

---

## 1. Problem

_What user problem or business need does this solve?_

## 2. Goal

_What does success look like? Include measurable outcomes._

| Metric | Current | Target |
|--------|---------|--------|
| | | |

---

## 3. User Flow

_Step-by-step flow from user's perspective. Reference existing flows from [11-screen-transitions-flow-use-cases-acceptance.md](../../11-screen-transitions-flow-use-cases-acceptance.md) where applicable._

```
Screen A → [Action] → Screen B → [Action] → Screen C
```

### Happy Path
1. User does X
2. App shows Y
3. User confirms Z

### Error / Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Network lost during upload | Show retry dialog, queue locally |
| Camera permission denied | Show settings deep-link prompt |
| Token expired mid-flow | Silent refresh via interceptor, retry request |
| App backgrounded during X | Preserve state, resume on foreground |

---

## 4. Acceptance Criteria

| ID | Criteria | Priority |
|----|----------|----------|
| EPIC-XXXX-AC01 | **Given** [precondition] **When** [action] **Then** [result] | Must |
| EPIC-XXXX-AC02 | | Must |
| EPIC-XXXX-AC03 | | Should |
| EPIC-XXXX-AC04 | | Could |

---

## 5. UI / Design

| Screen | Figma Link | Notes |
|--------|-----------|-------|
| | | |

_If no Figma yet, describe layout requirements:_

---

## 6. Mobile-Specific Considerations

> Check all that apply and fill in details.

- [ ] **Camera**: Shot type? Resolution? Flash? Volume-button shutter?
- [ ] **Permissions**: Which permissions needed? First-time vs denied flow?
- [ ] **Offline**: What happens without network? Queue? Cache? Error?
- [ ] **Background/Foreground**: State preservation? Upload continuation?
- [ ] **Device Compatibility**: Minimum device? iOS 16.6 specific issues?
- [ ] **Performance**: Memory budget? Startup time impact? Battery?
- [ ] **Accessibility**: VoiceOver labels? Dynamic Type support?

---

## 7. Analytics Events

> Events to track for measuring success. Event names prefixed with epic context.

| Event Name | Trigger | Properties | Maps to Metric |
|-----------|---------|------------|----------------|
| `feature_x_opened` | User opens feature | `source`, `device_model` | Adoption |
| `feature_x_completed` | User completes flow | `duration_ms`, `result` | Completion rate |
| `feature_x_error` | Error occurs | `error_code`, `step` | Error rate |

---

## 8. Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| Backend API: `POST /api/v2/xxx` | ⬜ Ready / ⬜ In progress | |
| Figma: Final designs | ⬜ Ready / ⬜ In progress | |
| Other epic: EPIC-YYYY | ⬜ Done / ⬜ Blocked | |

---

## 9. Open Questions

| # | Question | Answer | Answered By |
|---|----------|--------|-------------|
| 1 | | | |

---

## 10. Revision History

| Date | Author | Change |
|------|--------|--------|
| YYYY-MM-DD | | Initial draft |
