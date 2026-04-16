# Doc Reverse-Sync: DRM-XXXX

> **Epic**: [DRM-XXXX — Epic Title](../epics/DRM-XXXX/DRM-XXXX.md)
> **Purpose**: Update existing docs to reflect what was ACTUALLY built, not what was planned.
> Copy to `docs/sdlc/epics/DRM-XXXX/DOC-REVERSE-SYNC.md`

---

## Why Reverse-Sync?

PRD and Tech Design describe what we PLANNED. Implementation often deviates:
- API response shape changed during backend collaboration
- UI flow simplified after testing on device
- Edge case handling added that wasn't in the original spec
- Scope cut due to time or complexity

Docs must reflect reality, not the plan.

---

## Step 1: Compare Plan vs Reality

| Aspect | Planned (PRD/Tech Design) | Actually Built | Delta |
|--------|--------------------------|---------------|-------|
| User flow | | | Same / Changed |
| API endpoints | | | Same / Changed |
| Data models | | | Same / Changed |
| Error handling | | | Same / Changed |
| UI/screens | | | Same / Changed |
| Scope delivered | | | Full / Partial |

---

## Step 2: Update Business Logic Docs

> Only update docs for areas marked in the epic's "Affected App Areas".

| Doc | Needs Update? | What Changed | PR | Done |
|-----|--------------|-------------|-----|------|
| `01-authentication.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `02-app-lifecycle.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `03-session-management.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `04-camera-and-capture.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `05-chat-and-ai.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `06-wardrobe-and-outfit.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `07-asset-pipeline.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `08-networking.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `09-socket-realtime.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `10-supporting-services.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `11-screen-transitions-flow-use-cases-acceptance.md` | ⬜ Yes / ⬜ No | | | ⬜ |
| `README.md` (architecture) | ⬜ Yes / ⬜ No | | | ⬜ |

---

## Step 3: Update Epic Artifacts

| Artifact | Needs Update? | What Diverged | Done |
|----------|--------------|---------------|------|
| PRD (acceptance criteria) | ⬜ Yes / ⬜ No | | ⬜ |
| Tech Design (file list, API) | ⬜ Yes / ⬜ No | | ⬜ |
| Test Plan (new cases added) | ⬜ Yes / ⬜ No | | ⬜ |

---

## Step 4: Claude-Assisted Doc Update

> For each doc that needs updating, use this prompt:

```
Read the current doc at docs/[XX-doc-name].md and the implementation 
in [list of changed files from PR]. Generate updated sections that
reflect what was actually built for epic DRM-XXXX. Only change 
sections affected by this epic. Keep existing doc structure and style.
```

---

## Sign-off

| Check | Status |
|-------|--------|
| All affected docs identified | ⬜ |
| All doc updates committed | ⬜ |
| Doc updates reviewed | ⬜ |
| Epic artifacts reflect final state | ⬜ |

**Completed by**: _________________ **Date**: _________
