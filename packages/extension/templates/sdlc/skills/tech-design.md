---
name: tech-design
description: Generate or review a Technical Design document for an epic. Produces architecture, API/interface contracts, file impact, wiring plan, non-functional design, and rollout strategy.
argument-hint: "<{{EPIC_PREFIX}}-XXXX>"
---

# Tech Design for Epic $0

You are the **Tech Lead (TL)** agent — a staff-level engineer with architectural experience across web, mobile, desktop, backend, and CLI.
Load your full persona from `.claude/agents/tech-lead.md` before starting.

## Step 0: Pipeline Gate Check
Read and execute `.claude/skills/_gate-check.md`. This skill = phase `design`, epic = `$0`. If gate fails → STOP.

## Steps

1. Read the epic doc: `docs/sdlc/epics/$0/$0.md`
2. Read the PRD: `docs/sdlc/epics/$0/PRD.md` (must be complete first)
3. Read the tech design template: `docs/sdlc/epics/$0/TECH-DESIGN.md` or `docs/sdlc/templates/TECH-DESIGN-TEMPLATE.md`
4. Analyze the existing codebase for context:
   - Project architecture overview (`CLAUDE.md`, `README.md`, `docs/architecture.md`)
   - Dependency wiring / service registration configuration
   - Shared state / config files
   - Relevant source files in affected areas (use Glob/Grep)
   - Related ADRs (`docs/adr/`) if the project uses them
5. Fill the tech design with the sections below

## Tech Design Contents

### Summary
- One paragraph: what is being built and the chosen technical approach

### Architecture
- **Component / layer diagram** using the project's layering (MVC / MVVM / Clean / hexagonal / layered — whatever `CLAUDE.md` defines)
- **Layer mapping** — for each layer, list new/modified modules and their responsibilities
- **Key design choices** with rationale — especially any non-obvious trade-offs
- Link to ADRs for any irreversible or widely-impactful decision

### API / Interface Contract
- New / modified endpoints, RPC methods, IPC messages, SDK functions, CLI flags, or module interfaces
- Request/response shapes (or argument/return shapes)
- Error cases and how they're surfaced (HTTP codes, typed errors, exit codes, exception types)
- Versioning / backward compatibility strategy
- Idempotency for non-read operations

### Data Model
- New / modified schemas, tables, collections, client caches, serialization formats
- Migration strategy for existing data (expand-contract for DBs; versioned models for serialized formats)
- Indexes, constraints, invariants

### State Management
- Where state lives (local scope / shared application / persistent / server-side)
- Lifecycle (when it's created, updated, invalidated, destroyed)
- Synchronization strategy (source of truth, propagation, invalidation)

### Sequence / Flow
- Key interaction flow across layers or services
- Include error / retry paths, not just happy path

### Dependency Wiring / Registration
- How new components are wired in the project's DI / composition / plugin mechanism
- Lifetimes (singleton vs scoped vs transient) and why

### Navigation / Control Flow Changes
- For UIs: new/changed routes or screens, transitions, deep links
- For services: new endpoints, message routes, job schedules

### Non-Functional Design
- **Performance budget** — latency p50/p95, throughput, memory, bundle/artifact size impact
- **Reliability** — retry policy, timeouts, fallbacks, circuit breaking, graceful degradation
- **Security & privacy** — threat model summary, authz decisions, input validation, secrets handling, PII classification
- **Observability** — logs, metrics, traces, alerts this change adds
- **Accessibility** (UI work) — compliance target and how it's achieved
- **Internationalization** (UI work) — locale coverage, RTL, formatting
- **Compatibility** — minimum supported platforms / runtimes
- **Offline / resilience** (if applicable) — cached data, queued actions, sync strategy

### Rollout & Reversibility
- Feature flag(s) and expected flag lifecycle
- Staged rollout plan (if applicable)
- Rollback path (flag flip / version rollback / config rollback)

### File / Module Impact
- Complete list: new / modified / deleted
- For each modified file, a one-line reason

### Risks & Technical Debt
- Risks with mitigations
- Intentional shortcuts and why (and when they'll be paid back)

### Open Questions
- Questions that should block implementation until answered, and who answers them

## Architecture Rules (Stack-Neutral)

- Layer boundaries are one-way; downstream doesn't know about upstream
- Every external dependency (DB, HTTP client, file system, clock, random, OS service) sits behind an interface for testability
- No hidden global state — wire explicitly through the project's composition mechanism
- Long-lived resources (subscriptions, connections, listeners, background tasks) have explicit disposal paths
- Breaking changes to external contracts require versioning or migration plans

## Output

Write the completed tech design to `docs/sdlc/epics/$0/TECH-DESIGN.md`.
