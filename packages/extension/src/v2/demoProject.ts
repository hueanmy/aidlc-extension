/**
 * `aidlc.loadDemoProject` — scaffolds a self-contained demo workspace at a
 * known path (`~/aidlc-demo-project`) and opens it in a new VS Code window.
 *
 * Seeds:
 *   - .aidlc/workspace.yaml         (6 agents + demo-pipeline w/ all gate types)
 *   - .aidlc/skills/hello-skill.md
 *   - .aidlc/validators/demo-validator.js
 *   - .aidlc/runs/<id>.json × 5     (one per gate state)
 *   - docs/epics/DEMO-001..006/     (6 epics, each parked at a different gate)
 *
 * Why a fixed dir: the demo overwrites real files (workspace.yaml, run
 * state) — pointing it at a separate folder keeps the user's actual project
 * safe. Re-running re-seeds (with an overwrite prompt). Opens in the
 * current window, replacing the active workspace.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEMO_DIR_NAME = 'aidlc-demo-project';

/** Pipeline shape used by the seeded demo-pipeline. Keep in sync with the YAML below. */
const STEPS = [
  { agent: 'demo-plan',      artifact: 'PRD.md' },
  { agent: 'demo-design',    artifact: 'TECH-DESIGN.md' },
  { agent: 'demo-implement', artifact: 'CHANGES.md' },
  { agent: 'demo-review',    artifact: 'REVIEW.md' },
  { agent: 'demo-release',   artifact: 'RELEASE.md' },
];
const PIPELINE_ID = 'demo-pipeline';

export async function loadDemoProjectCommand(): Promise<void> {
  const demoRoot = path.join(os.homedir(), DEMO_DIR_NAME);

  if (fs.existsSync(demoRoot)) {
    const choice = await vscode.window.showWarningMessage(
      `Demo project already exists at ~/${DEMO_DIR_NAME}. Re-seed (overwrites .aidlc/ + docs/epics/) or just open it as-is?`,
      { modal: false },
      'Re-seed and open',
      'Open as-is',
      'Cancel',
    );
    if (choice === 'Cancel' || !choice) { return; }
    if (choice === 'Re-seed and open') {
      try { wipeDemoData(demoRoot); }
      catch (err) {
        void vscode.window.showErrorMessage(`Failed to clear demo data: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      seedDemo(demoRoot);
    }
  } else {
    fs.mkdirSync(demoRoot, { recursive: true });
    seedDemo(demoRoot);
  }

  await vscode.commands.executeCommand(
    'vscode.openFolder',
    vscode.Uri.file(demoRoot),
    { forceNewWindow: false },
  );
}

/**
 * Remove only the dirs we're about to re-seed. Leaves anything the user added
 * (e.g. their own scratch notes in the demo folder) untouched.
 */
function wipeDemoData(root: string): void {
  for (const sub of ['.aidlc', 'docs/epics']) {
    const p = path.join(root, sub);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); }
  }
}

function seedDemo(root: string): void {
  // .aidlc/ scaffolding
  writeFile(path.join(root, '.aidlc', 'workspace.yaml'), WORKSPACE_YAML);
  writeFile(path.join(root, '.aidlc', 'skills', 'hello-skill.md'), HELLO_SKILL);
  writeFile(path.join(root, '.aidlc', 'skills', 'demo-plan-skill.md'), PLAN_SKILL);
  writeFile(path.join(root, '.aidlc', 'skills', 'demo-design-skill.md'), DESIGN_SKILL);
  writeFile(path.join(root, '.aidlc', 'skills', 'demo-implement-skill.md'), IMPLEMENT_SKILL);
  writeFile(path.join(root, '.aidlc', 'skills', 'demo-review-skill.md'), REVIEW_SKILL);
  writeFile(path.join(root, '.aidlc', 'skills', 'demo-release-skill.md'), RELEASE_SKILL);
  writeFile(path.join(root, '.aidlc', 'validators', 'demo-validator.js'), DEMO_VALIDATOR);

  // 6 demo epics, each park at a different gate state
  seedEpic(root, 'DEMO-001-MARK-DONE', {
    title: 'Demo: Mark step done (no gates)',
    description: 'Step 1/5 awaiting_work. Pipeline step has no human/auto review gate — Mark done auto-advances.',
    doneCount: 0,
    inProgressIdx: 0,
    createdHoursAgo: 1,
  });
  seedRunState(root, 'DEMO-001-MARK-DONE', { currentStepIdx: 0, currentStatus: 'awaiting_work', createdHoursAgo: 1 });

  seedEpic(root, 'DEMO-002-AUTO-REVIEW', {
    title: 'Demo: Run auto-review',
    description: 'Step 3/5 awaiting_auto_review. CHANGES.md has been produced; the validator script must run before the human gate opens.',
    doneCount: 2,
    inProgressIdx: 2,
    artifactProduced: true,
    createdHoursAgo: 25,
  });
  seedRunState(root, 'DEMO-002-AUTO-REVIEW', { currentStepIdx: 2, currentStatus: 'awaiting_auto_review', createdHoursAgo: 25 });

  seedEpic(root, 'DEMO-003-APPROVE-REJECT', {
    title: 'Demo: Approve / Reject (human gate)',
    description: 'Step 3/5 awaiting_review. Auto-validator passed; human reviewer must approve or reject.',
    doneCount: 2,
    inProgressIdx: 2,
    artifactProduced: true,
    createdHoursAgo: 49,
  });
  seedRunState(root, 'DEMO-003-APPROVE-REJECT', {
    currentStepIdx: 2,
    currentStatus: 'awaiting_review',
    autoReviewVerdict: {
      decision: 'pass',
      reason: 'All produced artifacts present; no policy violations detected by demo-validator.',
      runner: '.aidlc/validators/demo-validator.js',
    },
    createdHoursAgo: 49,
  });

  seedEpic(root, 'DEMO-004-REJECTED', {
    title: 'Demo: Rejected (Rerun)',
    description: 'Step 3/5 rejected by reviewer — needs rework. Rerun bumps revision and goes back to awaiting_work.',
    doneCount: 2,
    inProgressIdx: 2,
    artifactProduced: true,
    createdHoursAgo: 73,
  });
  seedRunState(root, 'DEMO-004-REJECTED', {
    currentStepIdx: 2,
    currentStatus: 'rejected',
    rejectReason: 'CHANGES.md is missing test coverage for the new error path. Add unit tests for the timeout branch and resubmit.',
    autoReviewVerdict: {
      decision: 'pass',
      reason: 'Validator pass — but human reviewer flagged missing test coverage.',
      runner: '.aidlc/validators/demo-validator.js',
    },
    createdHoursAgo: 73,
  });

  seedEpic(root, 'DEMO-005-COMPLETED', {
    title: 'Demo: Fully completed run',
    description: 'All 5/5 steps approved. RunState.status = completed. Run-gate banner does not render.',
    doneCount: STEPS.length,
    createdHoursAgo: 97,
  });
  seedRunState(root, 'DEMO-005-COMPLETED', { currentStepIdx: STEPS.length - 1, completed: true, createdHoursAgo: 97 });

  // Legacy: state.json done but NO RunState file → "Start pipeline run" button
  seedEpic(root, 'DEMO-006-LEGACY-NO-RUNSTATE', {
    title: 'Demo: Legacy epic (no run state)',
    description: 'state.json shows all steps done but there is no .aidlc/runs/<id>.json — surfaces the "Start pipeline run" backfill button.',
    doneCount: STEPS.length,
    createdHoursAgo: 121,
  });
}

interface SeedEpicOpts {
  title: string;
  description: string;
  doneCount: number;
  inProgressIdx?: number;
  artifactProduced?: boolean;
  createdHoursAgo: number;
}

interface SeedRunStateOpts {
  currentStepIdx: number;
  currentStatus?: 'awaiting_work' | 'awaiting_auto_review' | 'awaiting_review' | 'rejected';
  completed?: boolean;
  autoReviewVerdict?: { decision: 'pass' | 'reject'; reason: string; runner: string };
  rejectReason?: string;
  createdHoursAgo: number;
}

function seedEpic(root: string, epicId: string, opts: SeedEpicOpts): void {
  const epicDir = path.join(root, 'docs', 'epics', epicId);

  const stepStates = STEPS.map((s, i) => {
    let status: 'pending' | 'in_progress' | 'done';
    let startedAt: string | null = null;
    let finishedAt: string | null = null;
    if (i < opts.doneCount) {
      status = 'done';
      startedAt = isoOffset(-opts.createdHoursAgo + i);
      finishedAt = isoOffset(-opts.createdHoursAgo + i + 0.5);
    } else if (i === opts.inProgressIdx) {
      status = 'in_progress';
      startedAt = isoOffset(-opts.createdHoursAgo + i);
    } else {
      status = 'pending';
    }
    return { agent: s.agent, status, startedAt, finishedAt };
  });

  const epicStatus = stepStates.every((s) => s.status === 'done')
    ? 'done'
    : stepStates.some((s) => s.status === 'in_progress') ? 'in_progress' : 'pending';

  const state = {
    id: epicId,
    title: opts.title,
    description: opts.description,
    pipeline: PIPELINE_ID,
    agent: null,
    agents: STEPS.map((s) => s.agent),
    currentStep: opts.inProgressIdx ?? opts.doneCount,
    status: epicStatus,
    createdAt: isoOffset(-opts.createdHoursAgo),
    stepStates,
  };

  writeJson(path.join(epicDir, 'state.json'), state);
  writeJson(path.join(epicDir, 'inputs.json'), {
    jira: `DEMO-${epicId.split('-')[1]}`,
    files: 'src/**/*.ts',
    github: 'aidlc-io/aidlc',
  });

  for (let i = 0; i < opts.doneCount; i++) {
    writeFile(path.join(epicDir, 'artifacts', STEPS[i].artifact), artifactStub(epicId, i));
  }
  if (typeof opts.inProgressIdx === 'number' && opts.inProgressIdx > 0 && opts.artifactProduced) {
    writeFile(
      path.join(epicDir, 'artifacts', STEPS[opts.inProgressIdx].artifact),
      artifactStub(epicId, opts.inProgressIdx),
    );
  }
}

function seedRunState(root: string, epicId: string, opts: SeedRunStateOpts): void {
  const steps = STEPS.map((s, i) => {
    const rec: Record<string, unknown> = {
      stepIdx: i,
      agent: s.agent,
      revision: 1,
      artifactsProduced: [] as string[],
    };
    if (opts.completed) {
      rec.status = 'approved';
      rec.startedAt = isoOffset(-opts.createdHoursAgo + i);
      rec.finishedAt = isoOffset(-opts.createdHoursAgo + i + 0.5);
      rec.artifactsProduced = [`docs/epics/${epicId}/artifacts/${s.artifact}`];
      return rec;
    }
    if (i < opts.currentStepIdx) {
      rec.status = 'approved';
      rec.startedAt = isoOffset(-opts.createdHoursAgo + i);
      rec.finishedAt = isoOffset(-opts.createdHoursAgo + i + 0.5);
      rec.artifactsProduced = [`docs/epics/${epicId}/artifacts/${s.artifact}`];
    } else if (i === opts.currentStepIdx && opts.currentStatus) {
      rec.status = opts.currentStatus;
      rec.startedAt = isoOffset(-opts.createdHoursAgo + i);
      if (
        opts.currentStatus === 'awaiting_auto_review' ||
        opts.currentStatus === 'awaiting_review' ||
        opts.currentStatus === 'rejected'
      ) {
        rec.artifactsProduced = [`docs/epics/${epicId}/artifacts/${s.artifact}`];
      }
      if (opts.autoReviewVerdict) {
        rec.autoReviewVerdict = { ...opts.autoReviewVerdict, at: isoOffset(-1.5) };
      }
      if (opts.rejectReason) { rec.rejectReason = opts.rejectReason; }
    } else {
      rec.status = 'pending';
    }
    return rec;
  });

  const runState = {
    schemaVersion: 1,
    runId: epicId,
    pipelineId: PIPELINE_ID,
    context: { epic: epicId },
    startedAt: isoOffset(-opts.createdHoursAgo),
    updatedAt: isoOffset(-1),
    currentStepIdx: opts.completed ? STEPS.length - 1 : opts.currentStepIdx,
    status: opts.completed ? 'completed' : 'running',
    steps,
  };

  writeJson(path.join(root, '.aidlc', 'runs', `${epicId}.json`), runState);
}

function artifactStub(epicId: string, stepIdx: number): string {
  const step = STEPS[stepIdx];
  return `# ${step.artifact} — ${epicId} (DEMO)

> Synthetic placeholder produced by the demo seeder. Replace when a real run
> lands in this folder.

**Phase:** ${step.agent} (step ${stepIdx + 1}/${STEPS.length})

---

This is a fake artifact so the Epics-panel "Artifact" link renders as
clickable. Real output from \`/${step.agent}\` would land here.
`;
}

function isoOffset(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function writeJson(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function writeFile(p: string, txt: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, txt, 'utf8');
}

const PLAN_SKILL = `# Plan — PRD Author

You are a product planner. Given a Jira ticket, user request, or feature idea,
produce a concise PRD that an engineer can hand to a designer.

Output a single Markdown document with these sections:

1. **Goal** — one paragraph. What problem does this solve, and for whom?
2. **Non-goals** — bullet list of things explicitly out of scope, so the
   design phase doesn't sprawl.
3. **User stories** — 3–7 bullets in the form \`As a <role>, I want <action>
   so that <outcome>\`. Order by priority.
4. **Acceptance criteria** — testable bullets, ideally Given/When/Then. These
   are what QA will sign off on.
5. **Open questions** — anything you're unsure about. Better to flag than
   guess; the designer will resolve in the next phase.

Constraints:
- Do not specify implementation (no API shapes, no DB schema, no UI mocks) —
  that's the design phase's job.
- Keep it tight: a good PRD is 1–2 screens, not a novel.
- If the input is ambiguous, list the ambiguities under Open questions and
  proceed with the most plausible interpretation.

Save the document as \`PRD.md\` in the epic's artifacts folder.
`;

const DESIGN_SKILL = `# Design — Tech Design Author

You are a senior engineer doing technical design. Given a PRD, produce a
design document that another engineer could implement from without further
questions.

Read \`PRD.md\` first. Then output \`TECH-DESIGN.md\` with:

1. **Approach** — high-level strategy in one paragraph. What's the shape of
   the solution? What existing patterns in the codebase does it lean on?
2. **Architecture** — component diagram in ASCII or Mermaid. Show data flow
   between modules. Identify which pieces are new vs. modified.
3. **API contract** — for each new/changed function or endpoint: signature,
   inputs, outputs, error cases. Be precise about types.
4. **DI plan** — what gets wired where. If you're introducing a new
   dependency or service, show its lifetime and which call sites construct
   it.
5. **File impact list** — every file you expect to create, modify, or
   delete. The implementer uses this as a checklist; missing entries cause
   merge conflicts later.
6. **Risks & alternatives** — at least one alternative considered and the
   reason it was rejected. If there's a tricky concurrency / migration /
   compatibility risk, name it explicitly.

Constraints:
- Don't write the code. Show signatures and call shapes; the implement phase
  fills in bodies.
- Prefer composition and small well-named functions over clever single-shot
  refactors.
- When the PRD has open questions, resolve them here with a brief rationale,
  or escalate back if you need a product decision.

Save as \`TECH-DESIGN.md\` in the epic's artifacts folder.
`;

const IMPLEMENT_SKILL = `# Implement — Code Author

You are an engineer implementing the design. Read \`TECH-DESIGN.md\` and land
the code change.

Workflow:

1. Read \`TECH-DESIGN.md\`. If anything is unclear or impossible, stop and
   escalate — don't guess.
2. Walk the **File impact list** top-down. For each file, make the smallest
   diff that satisfies the design.
3. Run the project's typechecker and tests after each meaningful change.
   Don't pile up untested edits.
4. If you hit a wall (failing test, design doesn't fit existing code), prefer
   surfacing it in the changelog over silently working around it.

Output \`CHANGES.md\` summarizing:
- **Diff summary** — bullet list, one per file: \`path/to/file.ts — what
  changed and why\`. Skip purely mechanical renames.
- **Tests added** — list new tests + what they cover. If you didn't add
  tests, justify (existing coverage, trivial change, etc.).
- **Skipped from design** — if you couldn't implement something from the
  design's file impact list, list it with the reason. The review phase
  decides whether to ship without it or send back to design.
- **Manual verification** — any UI/UX paths you tested by hand.

Constraints:
- Don't refactor unrelated code. Drive-by cleanups belong in their own PR.
- Don't add error handling, fallbacks, or validation for cases that can't
  happen. Only validate at system boundaries.
- Match the surrounding code's style (indentation, naming, comment density)
  — don't introduce a new convention mid-file.
- If you find a bug unrelated to this design, note it in \`CHANGES.md\` under
  a "Found while implementing" section. Don't fix it silently.

Save as \`CHANGES.md\` in the epic's artifacts folder.
`;

const REVIEW_SKILL = `# Review — Code Reviewer

You are a senior reviewer. Read \`PRD.md\`, \`TECH-DESIGN.md\`, and \`CHANGES.md\`,
then audit the diff for correctness, design fidelity, and quality.

Output \`REVIEW.md\` with:

1. **Verdict** — one of \`LGTM\`, \`LGTM with comments\`, \`Request changes\`,
   \`Block\`. Lead with this so the human reviewer can scan.
2. **Design fidelity** — does the diff match \`TECH-DESIGN.md\`? Call out
   anything skipped, added beyond scope, or implemented differently. If the
   implementer documented skipped items in \`CHANGES.md\`, decide whether
   each is acceptable.
3. **Correctness** — bugs, edge cases, off-by-ones, null/undefined paths,
   concurrency / race conditions, error handling gaps at boundaries.
4. **Tests** — adequate coverage for the change? Tests testing the right
   thing? Any false-positive tests (passing without exercising the code)?
5. **Style & maintainability** — naming, function length, comment
   appropriateness (per project rules: comments only for non-obvious
   "why"), dead code, unused imports.
6. **Security & data** — input validation, injection risks, secrets in
   code, PII leaks in logs, unsafe defaults.

Constraints:
- Be specific. Quote file:line where possible. Vague comments waste cycles.
- Distinguish must-fix from nice-to-have. Tag with \`[blocker]\`, \`[nit]\`,
  \`[suggestion]\`.
- Don't just list problems — when something is wrong, propose a fix or ask
  the right question.
- If the diff looks fine, say so and stop. Padding a review with low-value
  comments hides the real issues.

Save as \`REVIEW.md\` in the epic's artifacts folder.
`;

const RELEASE_SKILL = `# Release — Release Notes Author

You are responsible for cutting the release. The diff is approved; your job
is to ship it cleanly and tell the world what changed.

Read \`CHANGES.md\` and \`REVIEW.md\`, then produce \`RELEASE.md\` with:

1. **Version & date** — the version being cut and today's date. Follow the
   project's existing scheme (semver / calver / whatever the changelog
   shows).
2. **Headline** — one sentence a user can read and immediately know whether
   this release affects them.
3. **What's new** — user-facing changes, grouped by feature area. Use the
   imperative ("Add X", "Fix Y") not the past tense.
4. **Breaking changes** — separate section. Each entry: what broke, who is
   affected, how to migrate. If none, write "None" — don't omit the
   section.
5. **Internal changes** — refactors, infra, deps. Brief. This is for
   teammates, not users.
6. **Upgrade notes** — what does a deployer need to do? Migrations to run,
   config changes, env vars to set. If nothing, write "Drop-in upgrade".
7. **Acknowledgements** — contributors / reviewers, if the project does
   that.

Constraints:
- User-facing tone in "What's new" and "Breaking changes" — no jargon a
  non-engineer can't parse.
- Cite issue / PR numbers where they help, but don't spam them.
- Don't repeat the full \`CHANGES.md\`. Distill. A release note is a summary,
  not a transcript.
- If the changelog reveals something risky that wasn't flagged in review
  (silent breaking change, removed deprecated API), surface it loudly under
  Breaking changes.

Save as \`RELEASE.md\` in the epic's artifacts folder.
`;

const HELLO_SKILL = `# Hello World Skill

You are a friendly assistant. Greet the user warmly and ask what they would
like help with today. Keep your reply to two sentences.
`;

const DEMO_VALIDATOR = `/**
 * Demo auto-review validator. Always passes — exists so the demo pipeline's
 * \`auto_review: true\` steps have a runnable runner. Real validators inspect
 * the produced artifacts and return reject when they fail policy checks.
 *
 * Contract:
 *   default async (ctx) => { decision: 'pass' | 'reject', reason: string }
 */
module.exports = async function demoValidator(_ctx) {
  return {
    decision: 'pass',
    reason: 'Demo validator — passes everything. Replace with real checks for production use.',
  };
};
`;

const WORKSPACE_YAML = `version: "1.0"
name: "AIDLC Demo Project"

agents:
  - id: hello
    name: "Hello World Agent"
    skill: hello-skill
    model: claude-sonnet-4-5

  - id: demo-plan
    name: "Plan"
    skill: demo-plan-skill
    model: claude-sonnet-4-5
    description: "Draft the PRD with goals, scope, acceptance criteria."
    inputs: "User request, existing docs, jira ticket"
    outputs: "PRD with goals, non-goals, AC"
    artifact: "PRD.md"
    capabilities: [jira]

  - id: demo-design
    name: "Design"
    skill: demo-design-skill
    model: claude-sonnet-4-5
    description: "Design the implementation approach."
    inputs: "PRD, existing code, dependency graph"
    outputs: "Architecture, API contract, file impact list"
    artifact: "TECH-DESIGN.md"
    capabilities: [files, github]

  - id: demo-implement
    name: "Implement"
    skill: demo-implement-skill
    model: claude-sonnet-4-5
    description: "Land the code change against the design."
    inputs: "Tech design, source tree"
    outputs: "Diff, summary of changes"
    artifact: "CHANGES.md"
    capabilities: [files, github]

  - id: demo-review
    name: "Review"
    skill: demo-review-skill
    model: claude-sonnet-4-5
    description: "Review correctness, style, edge cases."
    inputs: "Diff, design, PRD"
    outputs: "Review report"
    artifact: "REVIEW.md"
    capabilities: [files]

  - id: demo-release
    name: "Release"
    skill: demo-release-skill
    model: claude-sonnet-4-5
    description: "Cut the release and announce."
    inputs: "Approved diff, changelog"
    outputs: "Release notes"
    artifact: "RELEASE.md"
    capabilities: [github, slack]

skills:
  - id: hello-skill
    path: ./.aidlc/skills/hello-skill.md
  - id: demo-plan-skill
    path: ./.aidlc/skills/demo-plan-skill.md
  - id: demo-design-skill
    path: ./.aidlc/skills/demo-design-skill.md
  - id: demo-implement-skill
    path: ./.aidlc/skills/demo-implement-skill.md
  - id: demo-review-skill
    path: ./.aidlc/skills/demo-review-skill.md
  - id: demo-release-skill
    path: ./.aidlc/skills/demo-release-skill.md

environment: {}

slash_commands:
  - name: "/hello"
    agent: hello
  - name: "/demo-plan"
    agent: demo-plan
  - name: "/demo-design"
    agent: demo-design
  - name: "/demo-implement"
    agent: demo-implement
  - name: "/demo-review"
    agent: demo-review
  - name: "/demo-release"
    agent: demo-release

pipelines:
  - id: demo-pipeline
    steps:
      - agent: demo-plan
        produces:
          - "docs/epics/{epic}/artifacts/PRD.md"
      - agent: demo-design
        requires:
          - "docs/epics/{epic}/artifacts/PRD.md"
        produces:
          - "docs/epics/{epic}/artifacts/TECH-DESIGN.md"
        human_review: true
      - agent: demo-implement
        requires:
          - "docs/epics/{epic}/artifacts/TECH-DESIGN.md"
        produces:
          - "docs/epics/{epic}/artifacts/CHANGES.md"
        auto_review: true
        auto_review_runner: ./.aidlc/validators/demo-validator.js
        human_review: true
      - agent: demo-review
        requires:
          - "docs/epics/{epic}/artifacts/CHANGES.md"
        produces:
          - "docs/epics/{epic}/artifacts/REVIEW.md"
        auto_review: true
        auto_review_runner: ./.aidlc/validators/demo-validator.js
      - agent: demo-release
        requires:
          - "docs/epics/{epic}/artifacts/REVIEW.md"
        produces:
          - "docs/epics/{epic}/artifacts/RELEASE.md"

state:
  entity: epic
  root: docs/epics
  status_file: state.json

sidebar:
  views:
    - type: agents-list
    - type: skills-list
    - type: pipelines-list
    - type: run-history
`;
