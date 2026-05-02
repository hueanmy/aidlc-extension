# Release Checklist: vX.Y.Z

> Copy to `docs/sdlc/releases/vX.Y.Z-release-checklist.md`

---

## Release Info

| Field | Value |
|-------|-------|
| **Version** | vX.Y.Z |
| **Build** | XX |
| **Branch** | `release/X.Y.Z` |
| **Release Manager** | |
| **Target Date** | YYYY-MM-DD |
| **Rollout Strategy** | Phased (1% → 5% → 20% → 50% → 100%) / Full |

## Epics in This Release

| Epic | Title | Test Execution Status | Doc Sync |
|------|-------|-----------|----------|
| EPIC-XXXX | | ⬜ Passed | ⬜ Done |
| EPIC-YYYY | | ⬜ Passed | ⬜ Done |

---

## Pre-Release (3 days before)

### Code Freeze
- [ ] Release branch `release/X.Y.Z` created from `master`
- [ ] No new features merged after this point (bug fixes only)
- [ ] All epic PRs merged and reviewed
- [ ] Version bumped: `MARKETING_VERSION = X.Y.Z`
- [ ] Build number incremented

### Quality Gate
- [ ] All unit tests passing (CI green)
- [ ] No P0/P1 bugs open for epics in this release
- [ ] SwiftLint: no new errors introduced
- [ ] Performance: no regressions from monitoring baseline

### Test Execution Sign-off
- [ ] UAT build distributed via TestFlight
- [ ] All epic test scripts executed and passed
- [ ] PM sign-off received: _________ (date: _____)
- [ ] QA sign-off received: _________ (date: _____)

### Mobile-Specific Checks
- [ ] Tested on minimum device (iPhone SE / iOS 16.6)
- [ ] Tested on latest device (iPhone 16 Pro / latest iOS)
- [ ] Camera flows verified on real device
- [ ] Upload flow verified on WiFi and cellular
- [ ] App lifecycle: background → foreground → no crash
- [ ] Push notification permissions not affected

---

## Release Day

### App Store Submission
- [ ] Archive built via Fastlane: `make fl-release`
- [ ] IPA uploaded to App Store Connect
- [ ] dSYMs uploaded to Sentry
- [ ] App Store metadata reviewed:
  - [ ] Screenshots current (if UI changed)
  - [ ] Description current
  - [ ] What's New text updated (see below)
  - [ ] Keywords current
- [ ] Privacy declarations reviewed:
  - [ ] `NSCameraUsageDescription` accurate
  - [ ] `NSPhotoLibraryUsageDescription` accurate
  - [ ] App Privacy details on App Store Connect current
- [ ] Build submitted for Apple Review

### What's New (App Store)

```
[Paste the user-facing release notes here]
Example:
- Improved camera focus with visual feedback
- Faster image uploads
- Bug fixes and performance improvements
```

### Git
- [ ] Release tagged: `git tag v{X.Y.Z}`
- [ ] Tag pushed: `git push origin v{X.Y.Z}`
- [ ] GitHub Release created with release notes
- [ ] Release branch merged back to `master`

---

## Post-Submission (1-2 days)

### Apple Review
- [ ] Review status: ⬜ In Review / ⬜ Approved / ⬜ Rejected
- [ ] If rejected: reason noted, fix planned
- [ ] If approved: phased rollout started

### Rollout Monitoring (first 48 hours)

| Check | 1 hour | 4 hours | 24 hours | 48 hours |
|-------|--------|---------|----------|----------|
| Crash-free rate > 99.5% | ⬜ | ⬜ | ⬜ | ⬜ |
| No P0 Sentry alerts | ⬜ | ⬜ | ⬜ | ⬜ |
| Upload success rate stable | ⬜ | ⬜ | ⬜ | ⬜ |
| Camera open rate stable | ⬜ | ⬜ | ⬜ | ⬜ |
| App Store rating stable | | | ⬜ | ⬜ |

### Rollout Progression

| Phase | % Users | Date Started | Status | Notes |
|-------|---------|-------------|--------|-------|
| 1 | 1% | | ⬜ | |
| 2 | 5% | | ⬜ | |
| 3 | 20% | | ⬜ | |
| 4 | 50% | | ⬜ | |
| 5 | 100% | | ⬜ | |

### Decision Points
- **Pause rollout if**: crash-free rate < 99.5% OR P0 Sentry alert OR upload failure > 5%
- **Resume rollout after**: root cause identified + hotfix shipped OR issue is edge-case only
- **Full rollback if**: data loss confirmed OR >1% crash rate after 4 hours

---

## Post-Release Closure

- [ ] All epics marked as `released` in their epic docs
- [ ] Doc reverse-sync completed for all epics
- [ ] Monitoring dashboards bookmarked for this version
- [ ] Retro notes captured (what went well / what to improve)

---

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| Release Manager | | | ⬜ |
| PM | | | ⬜ |
| QA Lead | | | ⬜ |
| Tech Lead | | | ⬜ |
