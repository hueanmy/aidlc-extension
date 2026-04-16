# Rollback Playbook — DreemCatcher iOS

> This is a reference doc, not a per-release template. Keep it in `docs/sdlc/templates/`.
> Last updated: 2026-04-09

---

## Severity → Action Matrix

| Severity | Trigger | Timeline | Action |
|----------|---------|----------|--------|
| **P0 Critical** | Crash rate >1%, data loss, auth broken | < 1 hour | Halt rollout + emergency hotfix |
| **P1 Major** | Feature broken, upload failing, camera unusable | < 4 hours | Halt rollout + hotfix next build |
| **P2 Moderate** | Functional issue, workaround exists | Next cycle | Continue rollout + fix in next epic |
| **P3 Minor** | Cosmetic, edge case | Backlog | Continue rollout + log for later |

---

## Step 1: Halt Phased Rollout

**Who**: Release Manager or Tech Lead
**Where**: [App Store Connect](https://appstoreconnect.apple.com) → App → iOS App → Version

1. Go to App Store Connect → DreemCatcher → iOS App
2. Click the current version (vX.Y.Z)
3. Under "Phased Release": click **Pause Phased Release**
4. Existing users keep current version; new installs get previous version

> Pausing does NOT remove the app. Users who already updated are unaffected.

---

## Step 2: Assess Impact

```
Questions to answer within 30 minutes:
1. What % of users are affected? (Sentry → Release filter)
2. Is it device/OS specific? (Sentry → Tags)
3. Is it reproducible? (Try on internal device)
4. Can users work around it? (Alternative flow?)
5. Is data at risk? (Uploads lost? Auth broken?)
```

| Signal | Source | How to Check |
|--------|--------|-------------|
| Crash rate | Sentry | Releases → vX.Y.Z → Crash Free % |
| Upload failures | Segment | Event: `upload_failed` → count by version |
| Camera failures | Segment | Event: `capture_failed` → count by version |
| User reports | Intercom | Filter by app version |
| App Store reviews | App Store Connect | Ratings & Reviews |

---

## Step 3: Decide — Hotfix or Full Rollback

### Option A: Hotfix (preferred)

**When**: Root cause identified, fix is small and safe.

```bash
# 1. Create hotfix branch from release tag
git checkout -b hotfix/DRM-XXXX-description v{X.Y.Z}

# 2. Fix the issue
# ... make changes ...

# 3. Fast-track review (tech lead must approve)
# PR title: [HOTFIX][DRM-XXXX] description

# 4. Test on real device (minimum: the device/OS that reproduces the issue)

# 5. Build and deploy
make fl-beta  # UAT first — verify fix
              # QA quick-test (30 min)
make fl-release  # PROD — submit for expedited review

# 6. Request expedited Apple review
# App Store Connect → Version → Submit for Review → Request Expedited Review
# Reason: "Critical bug fix affecting X% of users"
```

**Timeline**: Fix → Review → Deploy = typically 24-48 hours
**Apple expedited review**: Usually < 24 hours if justification is clear

### Option B: Full Rollback

**When**: Root cause unknown OR fix is risky OR data loss occurring.

1. **App Store Connect** → Version → **Remove from Sale** (extreme — usually not needed)
2. **Better**: Pause phased rollout + submit previous version as new build
   ```bash
   # Checkout the previous release tag
   git checkout v{PREVIOUS_VERSION}

   # Bump build number only (keep same version)
   make bump-patch  # or manually increment build number

   # Build and submit
   make fl-release
   ```
3. Previous TestFlight build remains available for internal users

> **Note**: You CANNOT un-publish an App Store version. You can only submit a new build.

---

## Step 4: Communicate

| Audience | Channel | Message Template |
|----------|---------|-----------------|
| Team | Slack #dreem-mobile | `🚨 [vX.Y.Z] Phased rollout paused. Issue: [description]. Investigating. ETA: [time]` |
| Stakeholders | Slack #dreem-releases | `⚠️ Release vX.Y.Z paused due to [issue]. Hotfix in progress. No user action needed.` |
| Users (if widespread) | Intercom / In-app | `We're aware of [issue] and working on a fix. Update coming shortly.` |
| App Store | App Store Connect | Reply to affected reviews: `Thank you for reporting. A fix is on the way.` |

---

## Step 5: Post-Incident

After the issue is resolved:

1. **Resume rollout** (if paused): App Store Connect → Resume Phased Release
2. **Create incident report epic**: `DRM-XXXX [INCIDENT] vX.Y.Z [description]`
3. **Post-mortem content** (add to epic doc):
   - What happened (timeline)
   - Root cause
   - How it was detected
   - What was the impact (users affected, duration)
   - What prevented earlier detection
   - Action items to prevent recurrence
4. **Update monitoring**: add alert for the specific failure pattern

---

## Emergency Contacts

| Role | Who | Reach via |
|------|-----|-----------|
| Release Manager | | Slack / Phone |
| Tech Lead | | Slack / Phone |
| Apple Developer Support | | [developer.apple.com/contact](https://developer.apple.com/contact/) |
| Sentry Admin | | Slack |

---

## Prevention Checklist (for future releases)

- [ ] Crash-free rate > 99.5% on TestFlight before App Store submission
- [ ] Minimum 48 hours on TestFlight with >20 internal testers
- [ ] Real device testing on oldest supported (iPhone SE, iOS 16.6)
- [ ] Phased rollout enabled (never full rollout for feature releases)
- [ ] Sentry alerts configured for new crash signatures
- [ ] Segment dashboard monitoring upload/camera/auth success rates
