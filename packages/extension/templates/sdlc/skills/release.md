---
name: release
description: Prepare a release. Creates checklist, identifies included epics, verifies gates, and guides through the release process. Stack-neutral.
argument-hint: "<version> (e.g., 1.3.0)"
---

# Release v$0

You are the **Release Manager (RM)** agent — a senior release practitioner.
Load your full persona from `.claude/agents/release-manager.md` before starting.

## Step 0: Pipeline Gate Check
Read and execute `.claude/skills/_gate-check.md`. This skill = phase `release`, epic = detect from branch/commits. If no epic key found → skip gate. If gate fails → STOP.

## Steps

1. Create the release checklist:
   ```bash
   make release-checklist VER=$0
   ```
   (or copy `docs/sdlc/templates/RELEASE-CHECKLIST-TEMPLATE.md` to `docs/sdlc/releases/v$0-release-checklist.md`)

2. Read the created checklist at `docs/sdlc/releases/v$0-release-checklist.md`

3. Gather release content
   ```bash
   # Commits since last tag
   git log --oneline $(git describe --tags --abbrev=0)..HEAD --no-merges

   # Epic keys referenced in commits
   git log $(git describe --tags --abbrev=0)..HEAD --pretty="%s" --no-merges | grep -oE '{{EPIC_PREFIX}}-[0-9]+' | sort -u
   ```
   - For each epic, check its UAT / doc-sync status in `docs/sdlc/epics/{{EPIC_PREFIX}}-XXXX/`
   - Capture breaking changes, new config / env vars, new dependencies

4. Fill the release checklist
   - List all epics with their UAT status
   - Generate **user-facing release notes** — plain language, value-focused
   - Generate **technical changelog** — grouped by epic key; breaking changes called out; new flags / env vars / migrations listed
   - Fill pre-release, release-day, and post-release sections

5. Pre-release gates
   - CI green on release branch
   - No P0/P1 bugs open for any epic in scope
   - UAT signed off for every epic in scope
   - Version bumped, build metadata correct
   - Rollback path verified (feature flag / previous artifact / deploy revert)
   - Feature flags configured for risky changes

6. Guide through deploy commands (use `/deploy`)
   - UAT / staging first; verify
   - Production after UAT passes — staged rollout if the platform supports it

## Release Notes Format

### User-facing
```
What's New in v$0:

- <Feature benefit in plain language>
- <Improvement benefit>
- <User-visible fix — only if users would notice>
- Bug fixes and performance improvements
```

Keep it short, value-focused, no jargon, no epic keys. Translate to every supported locale.

### Technical
```markdown
## v$0 — YYYY-MM-DD

### New
- **{{EPIC_PREFIX}}-XXXX**: <one-line summary>

### Improved
- **{{EPIC_PREFIX}}-YYYY**: <one-line summary>

### Fixed
- <User-visible fixes>

### Breaking
- <Breaking change>. Migration: <link>

### Internal
- <Refactors, infra, test, doc changes — optional>

### Notes
- New config / env vars: ...
- New or changed dependencies: ...
- DB migrations: ...
- Feature flags: ...
```

## Reference

- Rollback: `docs/sdlc/templates/ROLLBACK-PLAYBOOK.md`
- Monitoring: `docs/sdlc/MONITORING-GUIDE.md` (or project equivalent)
- Release checklist template: `docs/sdlc/templates/RELEASE-CHECKLIST-TEMPLATE.md`
