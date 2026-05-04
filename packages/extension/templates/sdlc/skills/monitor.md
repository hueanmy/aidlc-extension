---
name: monitor
description: Post-release monitoring check. Analyzes error/crash signals, analytics anomalies, and user feedback to generate a health report. Stack-neutral — works for web, mobile, desktop, backend, CLI.
argument-hint: "[version] (e.g., v1.2.0, or blank for latest)"
---

# Post-Release Monitor

You are the **SRE (Healer)** agent — a senior production engineer.
Load your full persona from `.claude/agents/sre.md` before starting.

## Step 0: Gather Input

Most of the data lives in external systems (error trackers, analytics, support channels) that can't always be pulled automatically. Ask the user to paste screenshots or numbers from any of the following. Wait for their input.

```markdown
## Data Needed for Health Report

Paste screenshots or numbers from any of these — more sources = better report.

### 1. Error / Crash / Release dashboard (required if possible)
   📍 {{CRASH_TOOL}} or equivalent
   Examples: Sentry, Crashlytics, Bugsnag, Rollbar, Datadog Errors
   - Error-free / crash-free rate (% for the filtered version)
   - Top error / crash signatures (top 5)
   - Affected users / sessions

### 2. Analytics / product metrics (recommended)
   📍 {{ANALYTICS_TOOL}} or equivalent
   Examples: Amplitude, Mixpanel, PostHog, Segment
   - Event volume for key flows (last 24h / 7d vs previous)
   - Failure-event counts by category
   - Funnel drop-off on core flow

### 3. Service metrics (if backend / API)
   📍 {{METRICS_TOOL}} — Prometheus/Grafana, Datadog, New Relic, CloudWatch
   - Request rate, error rate, latency p50/p95/p99 (RED)
   - Saturation: CPU, memory, connections, queue depth (USE)
   - SLO burn rate if SLOs are defined

### 4. User signal (optional)
   📍 Support tool (Zendesk, Intercom, Help Scout)
   📍 Reviews (App Store, Play Store, Product Hunt, G2, etc.)
   - Recent ticket volume; top complaint themes
   - Rating trend

### 5. Synthetic / uptime (optional)
   - Synthetic test pass/fail
   - Uptime % for key endpoints
```

If the user provides no data, remind them which sources to check and stop — no speculation from zero data.

## Step 1: Read Reference Docs

1. Monitoring guide / runbook (project-specific path) — thresholds, SLOs, alert rules
2. Analytics event catalog (if present) — what each event means
3. If a version is specified (`$ARGUMENTS`), focus the report on that release
4. Recent deploy history — correlate incidents to changes

## Step 2: Check Local State

```bash
# Release tags
git tag --sort=-version:refname | head -5

# Recent commits on release branch
git log --oneline -10

# Release checklist existence
ls docs/sdlc/releases/ 2>/dev/null
```

## Step 3: Generate Health Report

```markdown
## Health Report — v{version} — {date}

### Data Sources
| Source | Provided | Notes |
|--------|----------|-------|
| Error / crash tracker | yes/no | {what was provided} |
| Analytics | yes/no | {what was provided} |
| Service metrics | yes/no | {what was provided} |
| User signal | yes/no | {what was provided} |

### Key Indicators
| Metric | Status | Value | Threshold | Source |
|--------|--------|-------|-----------|--------|
| Error-free / crash-free | ok/warn/crit | XX.X% | project threshold | error tracker |
| Core flow success rate | ok/warn/crit | XX% | project threshold | analytics |
| Request error rate (API) | ok/warn/crit | X.XX% | project threshold | metrics |
| Latency p95 | ok/warn/crit | XXX ms | project threshold | metrics |
| Saturation (CPU / mem / queue) | ok/warn/crit | XX% | project threshold | metrics |
| User rating / NPS | ok/warn/crit | X.X | project threshold | reviews / surveys |

Mark **N/A** where data wasn't provided — don't fabricate.

### Local State
| Item | Value |
|------|-------|
| Version | vX.Y.Z |
| Build / commit | N / <sha> |
| Branch | <branch> |
| Git tag | vX.Y.Z or "not tagged" |
| Release checklist | exists / missing |
| Deploy time | <when> |

### Top Issues
1. [Issue description] — P{X} — {% affected} — {environment details}
2. ...

### Trend vs. Previous Release
- Error rate: +X% / -X%
- Latency p95: +X ms / -X ms
- Support volume: +X tickets / -X
- (Use "unknown" if previous data not available)

### Recommendations
- [ ] {Action with epic key if new work needed}

### Decision
- [ ] Continue rollout
- [ ] Pause rollout — reason: ___
- [ ] Roll back — reason: ___
- [ ] Hotfix — open epic `{{EPIC_PREFIX}}-XXXX`
```

## If P0 signal found
- Reference `docs/sdlc/templates/ROLLBACK-PLAYBOOK.md`
- Consider feature-flag kill-switch as first lever, rollback as second
- Assign Incident Commander, open incident channel, capture timeline

## If P1+ signal found
- Suggest creating a hotfix epic (`make epic KEY={{EPIC_PREFIX}}-XXXX`)
- Classify via severity matrix in the rollback playbook

## If crash / stack trace provided
- Analyze stack trace → map to source file(s)
- Check git blame for recent changes in the affected area
- Check whether the crash is environment-specific (OS, locale, device, browser, version)
- Estimate severity (P0/P1/P2/P3)
- Propose fix approach; open hotfix epic if severity warrants
