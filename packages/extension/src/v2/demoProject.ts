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

/**
 * `mode` lets a webview caller skip the VS Code warning notification when
 * it has already collected the user's choice via an inline modal:
 *
 *   undefined  — default; show the notification when the demo dir exists.
 *   'reseed'   — wipe and re-seed the demo dir, then open.
 *   'open-as-is' — leave the existing demo dir alone, just open it.
 */
export async function loadDemoProjectCommand(
  mode?: 'reseed' | 'open-as-is',
): Promise<void> {
  const demoRoot = path.join(os.homedir(), DEMO_DIR_NAME);
  const exists = fs.existsSync(demoRoot);

  if (exists) {
    let action: 'reseed' | 'open-as-is';
    if (mode) {
      action = mode;
    } else {
      const choice = await vscode.window.showWarningMessage(
        `Demo project already exists at ~/${DEMO_DIR_NAME}. Re-seed (overwrites .aidlc/ + docs/epics/) or just open it as-is?`,
        { modal: false },
        'Re-seed and open',
        'Open as-is',
        'Cancel',
      );
      if (choice === 'Cancel' || !choice) { return; }
      action = choice === 'Re-seed and open' ? 'reseed' : 'open-as-is';
    }
    if (action === 'reseed') {
      try { wipeDemoData(demoRoot); }
      catch (err) {
        void vscode.window.showErrorMessage(
          `Failed to clear demo data: ${err instanceof Error ? err.message : String(err)}`,
        );
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
  for (const sub of ['.aidlc', 'docs/epics', '.claude/commands']) {
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

  // Claude Code reads slash commands from `.claude/commands/<name>.md`, NOT
  // from workspace.yaml. Mirror each AIDLC agent there so `/demo-plan ARG`
  // etc. actually work in the Claude CLI for this demo project. Each
  // command inlines the skill body + AIDLC-specific task instructions
  // (read state.json / inputs.json, address carried feedback, write the
  // expected artifact, tell the user to mark step done).
  writeFile(
    path.join(root, '.claude', 'commands', 'demo-plan.md'),
    claudeCommand({
      agentLabel: 'Plan',
      description: 'Draft the PRD for the epic',
      artifact: 'PRD.md',
      stepIdx: 0,
      skillBody: PLAN_SKILL,
    }),
  );
  writeFile(
    path.join(root, '.claude', 'commands', 'demo-design.md'),
    claudeCommand({
      agentLabel: 'Design',
      description: 'Author the tech design from the PRD',
      artifact: 'TECH-DESIGN.md',
      stepIdx: 1,
      skillBody: DESIGN_SKILL,
    }),
  );
  writeFile(
    path.join(root, '.claude', 'commands', 'demo-implement.md'),
    claudeCommand({
      agentLabel: 'Implement',
      description: 'Land the code change against the design',
      artifact: 'CHANGES.md',
      stepIdx: 2,
      skillBody: IMPLEMENT_SKILL,
    }),
  );
  writeFile(
    path.join(root, '.claude', 'commands', 'demo-review.md'),
    claudeCommand({
      agentLabel: 'Review',
      description: 'Review the diff for bugs, security, performance',
      artifact: 'REVIEW.md',
      stepIdx: 3,
      skillBody: REVIEW_SKILL,
    }),
  );
  writeFile(
    path.join(root, '.claude', 'commands', 'demo-release.md'),
    claudeCommand({
      agentLabel: 'Release',
      description: 'Compose release notes for the change',
      artifact: 'RELEASE.md',
      stepIdx: 4,
      skillBody: RELEASE_SKILL,
    }),
  );
  writeFile(
    path.join(root, '.claude', 'commands', 'hello.md'),
    `---
description: Greet the user and confirm the AIDLC demo runner is wired up
---

${HELLO_SKILL}

Reply with a friendly greeting and confirm the demo project is wired correctly. Mention the epic key the user passed: \`$ARGUMENTS\`.
`,
  );

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

  // ── Rich-history demos ─────────────────────────────────────────────
  seedRichEpic(root, 'DEMO-007-RICH-HISTORY', {
    title: 'Demo: Awaiting review — with prior reject',
    description:
      'Step 3/5 is awaiting_review (revision 2). Step was rejected once for missing tests, reworked, auto-validated, and now back at the human gate. Expand "History" on step 3 to see the timeline.',
    createdHoursAgo: 36,
    completed: false,
    currentStepIdx: 2,
    currentStatus: 'awaiting_review',
    histories: {
      0: [
        { kind: 'approve', revision: 1, hoursAgo: 35 },
      ],
      1: [
        { kind: 'auto_review', decision: 'pass', revision: 1, hoursAgo: 33,
          reason: 'Validator pass — design covers all PRD acceptance criteria.' },
        { kind: 'approve', revision: 1, hoursAgo: 32 },
      ],
      2: [
        { kind: 'auto_review', decision: 'pass', revision: 1, hoursAgo: 28,
          reason: 'All produced artifacts present; no policy violations.' },
        { kind: 'reject', revision: 1, hoursAgo: 26,
          reason: 'CHANGES.md is missing test coverage for the timeout branch — add unit tests and resubmit.',
          sentBackToIdx: 2 },
        { kind: 'rerun', revision: 2, hoursAgo: 24,
          feedback: 'Add unit tests for the timeout branch, resubmit.' },
        { kind: 'auto_review', decision: 'pass', revision: 2, hoursAgo: 2,
          reason: 'All produced artifacts present; coverage hooks satisfied.' },
      ],
    },
    revisions: { 2: 2 },
    artifactProducedAt: 2,
    autoReviewVerdictAtCurrent: {
      decision: 'pass',
      reason: 'All produced artifacts present; coverage hooks satisfied.',
      runner: '.aidlc/validators/demo-validator.js',
    },
  });

  seedRichEpic(root, 'DEMO-008-DONE-WITH-HISTORY', {
    title: 'Demo: Completed — with rocky history',
    description:
      'All 5/5 steps approved, but it was bumpy: step 2 was rejected once, step 4 cascade-rejected back to step 2, step 4 then rejected twice again before approval. Audit trail survives in state.json under each step.',
    createdHoursAgo: 168,
    completed: true,
    currentStepIdx: STEPS.length - 1,
    histories: {
      0: [
        { kind: 'approve', revision: 1, hoursAgo: 167 },
      ],
      1: [
        { kind: 'auto_review', decision: 'pass', revision: 1, hoursAgo: 165,
          reason: 'Design draft validated.' },
        { kind: 'reject', revision: 1, hoursAgo: 164,
          reason: 'Tech design omits the rate-limit policy from PRD §4.2.',
          sentBackToIdx: 1 },
        { kind: 'rerun', revision: 2, hoursAgo: 162,
          feedback: 'Add rate-limit section.' },
        { kind: 'auto_review', decision: 'pass', revision: 2, hoursAgo: 161,
          reason: 'Design v2 validated — rate-limit section present.' },
        // Cascade reject from step 4 lands here as a `rerun`:
        { kind: 'rerun', revision: 3, hoursAgo: 100,
          feedback: 'Rejected at step 4 (demo-review): rate-limit numbers do not match implementation' },
        { kind: 'auto_review', decision: 'pass', revision: 3, hoursAgo: 99,
          reason: 'Design v3 validated — rate-limit numbers updated.' },
        { kind: 'approve', revision: 3, hoursAgo: 95 },
      ],
      2: [
        { kind: 'auto_review', decision: 'pass', revision: 1, hoursAgo: 130,
          reason: 'Implementation diff validated.' },
        { kind: 'approve', revision: 1, hoursAgo: 128 },
        // Cascade-reset by step 4's reject — a fresh rerun lands here:
        { kind: 'rerun', revision: 2, hoursAgo: 100,
          feedback: 'Implementation reset because step 4 rejected upstream.' },
        { kind: 'auto_review', decision: 'pass', revision: 2, hoursAgo: 80,
          reason: 'Implementation v2 validated.' },
        { kind: 'approve', revision: 2, hoursAgo: 78 },
      ],
      3: [
        { kind: 'auto_review', decision: 'pass', revision: 1, hoursAgo: 105,
          reason: 'Review draft validated.' },
        { kind: 'reject', revision: 1, hoursAgo: 102,
          reason: 'Rate-limit numbers in REVIEW.md do not match the implementation. Send back to step 2 to align.',
          sentBackToIdx: 1 },
        { kind: 'rerun', revision: 2, hoursAgo: 75,
          feedback: 'Re-do review with corrected rate-limit numbers.' },
        { kind: 'auto_review', decision: 'pass', revision: 2, hoursAgo: 73,
          reason: 'Review v2 validated.' },
        { kind: 'reject', revision: 2, hoursAgo: 70,
          reason: 'Missing security checklist item (auth flow).',
          sentBackToIdx: 3 },
        { kind: 'rerun', revision: 3, hoursAgo: 60,
          feedback: 'Add security checklist.' },
        { kind: 'auto_review', decision: 'pass', revision: 3, hoursAgo: 58,
          reason: 'Review v3 validated.' },
        { kind: 'approve', revision: 3, hoursAgo: 50 },
      ],
      4: [
        { kind: 'auto_review', decision: 'pass', revision: 1, hoursAgo: 30,
          reason: 'Release notes validated.' },
        { kind: 'approve', revision: 1, hoursAgo: 25 },
      ],
    },
    revisions: { 1: 3, 2: 2, 3: 3 },
  });
}

interface SeedRichStep {
  kind: 'reject' | 'rerun' | 'auto_review' | 'approve';
  revision: number;
  hoursAgo: number;
  reason?: string;
  feedback?: string;
  decision?: 'pass' | 'reject';
  runner?: string;
  sentBackToIdx?: number;
}

interface SeedRichEpicOpts {
  title: string;
  description: string;
  createdHoursAgo: number;
  completed: boolean;
  currentStepIdx: number;
  currentStatus?: 'awaiting_work' | 'awaiting_auto_review' | 'awaiting_review' | 'rejected';
  /** Per-step history entries (idx → list, oldest first). */
  histories: Record<number, SeedRichStep[]>;
  /** Per-step final revision count (idx → revision). Defaults to 1. */
  revisions?: Record<number, number>;
  /** Step idx whose artifact was produced (for the current in-flight step). */
  artifactProducedAt?: number;
  /** Auto-review verdict to surface on the current step. */
  autoReviewVerdictAtCurrent?: { decision: 'pass' | 'reject'; reason: string; runner: string };
}

/**
 * Seed an epic with rich per-step history + a matching state.json snapshot.
 * Used for the demo epics that showcase the History panel — keeps the
 * existing simple seeders intact for the basic gate-state demos.
 */
function seedRichEpic(root: string, epicId: string, opts: SeedRichEpicOpts): void {
  const validatorPath = '.aidlc/validators/demo-validator.js';
  const buildHistory = (idx: number): Record<string, unknown>[] =>
    (opts.histories[idx] ?? []).map((h) => {
      const at = isoOffset(-h.hoursAgo);
      switch (h.kind) {
        case 'reject':
          return {
            kind: 'reject',
            at,
            revision: h.revision,
            reason: h.reason,
            sentBackToIdx: h.sentBackToIdx ?? idx,
          };
        case 'rerun':
          return { kind: 'rerun', at, revision: h.revision, feedback: h.feedback };
        case 'auto_review':
          return {
            kind: 'auto_review',
            at,
            revision: h.revision,
            decision: h.decision ?? 'pass',
            reason: h.reason ?? '',
            runner: h.runner ?? validatorPath,
          };
        case 'approve':
          return { kind: 'approve', at, revision: h.revision };
      }
    });

  const steps = STEPS.map((s, i) => {
    const rev = opts.revisions?.[i] ?? 1;
    const history = buildHistory(i);
    const rec: Record<string, unknown> = {
      stepIdx: i,
      agent: s.agent,
      revision: rev,
      artifactsProduced: [] as string[],
      history,
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
      if (opts.autoReviewVerdictAtCurrent) {
        rec.autoReviewVerdict = {
          ...opts.autoReviewVerdictAtCurrent,
          at: isoOffset(-1.5),
        };
      }
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

  // Synthetic token-usage sidecar — lets the demo epic render the ⚡
  // badge + per-step + per-history breakdown without requiring real
  // Claude logs to match the demo's cwd & time windows. Plausible
  // numbers (~$0.10–2/step varying by phase) so users get a feel for
  // the UI; the EpicTokenAttribution module reads this sidecar
  // verbatim when present (`<runId>.usage.json` next to `<runId>.json`).
  writeJson(
    path.join(root, '.aidlc', 'runs', `${epicId}.usage.json`),
    buildRichEpicSyntheticUsage(steps),
  );

  // Mirror into state.json so a teammate who only pulls the repo (and
  // therefore lacks the gitignored .aidlc/runs/) can still read the
  // history. Mirrors the shape produced by `mirrorRunStateToEpic`.
  const stateStepStates = steps.map((s) => ({
    agent: s.agent,
    status: mapRichStatus(String(s.status)),
    revision: s.revision,
    runStatus: s.status,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    rejectReason: undefined,
    autoReviewVerdict: (s as Record<string, unknown>).autoReviewVerdict,
    history: s.history,
    artifactsProduced: s.artifactsProduced,
  }));
  const epicStatus = opts.completed
    ? 'done'
    : 'in_progress';
  const epicState = {
    id: epicId,
    title: opts.title,
    description: opts.description,
    pipeline: PIPELINE_ID,
    agent: null,
    agents: STEPS.map((s) => s.agent),
    currentStep: opts.completed ? STEPS.length - 1 : opts.currentStepIdx,
    status: epicStatus,
    createdAt: isoOffset(-opts.createdHoursAgo),
    updatedAt: isoOffset(-1),
    stepStates: stateStepStates,
  };
  const epicDir = path.join(root, 'docs', 'epics', epicId);
  writeJson(path.join(epicDir, 'state.json'), epicState);
  writeJson(path.join(epicDir, 'inputs.json'), {
    jira: `DEMO-${epicId.split('-')[1]}`,
    files: 'src/**/*.ts',
    github: 'aidlc-io/aidlc',
  });

  // Artifacts: write one for every step that has been produced.
  steps.forEach((s, i) => {
    const arts = s.artifactsProduced as string[];
    if (arts.length > 0) {
      writeFile(
        path.join(epicDir, 'artifacts', STEPS[i].artifact),
        artifactStub(epicId, i),
      );
    }
  });
  if (typeof opts.artifactProducedAt === 'number') {
    writeFile(
      path.join(epicDir, 'artifacts', STEPS[opts.artifactProducedAt].artifact),
      artifactStub(epicId, opts.artifactProducedAt),
    );
  }
}

// Per-agent synthetic usage for a single attempt — deliberately small so
// the demo doesn't make new users panic about cost on day one. Cache-heavy
// because that's the norm for short Claude Code sessions. Full pipeline
// sums to roughly $1 (Opus API equivalent) for a clean run; reruns scale.
const SYNTHETIC_USAGE_BY_AGENT: Record<string, {
  cost: number; in: number; out: number; cr: number; cw: number; calls: number;
}> = {
  'demo-plan':      { cost: 0.05, in:  400, out:  300, cr:  22_000, cw:  900, calls: 3 },
  'demo-design':    { cost: 0.12, in:  600, out:  700, cr:  55_000, cw: 1_800, calls: 5 },
  'demo-implement': { cost: 0.38, in:  900, out: 1400, cr: 180_000, cw: 4_400, calls: 9 },
  'demo-review':    { cost: 0.18, in:  700, out:  900, cr:  85_000, cw: 2_200, calls: 6 },
  'demo-release':   { cost: 0.06, in:  400, out:  300, cr:  27_000, cw:  900, calls: 3 },
};

const DEFAULT_SYNTHETIC_USAGE = {
  cost: 0.10, in: 500, out: 400, cr: 40_000, cw: 1_200, calls: 4,
};

/**
 * Build a `<runId>.usage.json` payload for a rich-history demo epic.
 *
 * Each step gets a base "typical Opus 4.x" cost looked up by agent id; if
 * the step has been rerun N times, the cost is multiplied (rough proxy
 * for "did the work N times"). History sub-windows split the step total
 * across the events: reject rows carry the rejected revision's cost,
 * rerun rows carry ~0 (just the button click), auto_review + approve rows
 * carry the cost of the work between events.
 */
function buildRichEpicSyntheticUsage(
  steps: Array<Record<string, unknown>>,
): Record<string, unknown> {
  let totalCost = 0, totalTokens = 0, totalCalls = 0;
  const stepPayloads = steps.map((s) => {
    const agent = String(s.agent);
    const base = SYNTHETIC_USAGE_BY_AGENT[agent] ?? DEFAULT_SYNTHETIC_USAGE;
    const status = String(s.status);
    // No work yet → no usage on this step.
    const isInactive = status === 'pending';
    const rev = Number(s.revision) || 1;
    const multiplier = isInactive ? 0 : rev;  // rerun = redo full work
    const tokens = (base.in + base.out + base.cr + base.cw) * multiplier;
    const stepCost = base.cost * multiplier;
    const stepCalls = base.calls * multiplier;

    totalCost += stepCost;
    totalTokens += tokens;
    totalCalls += stepCalls;

    // Distribute across history sub-windows. Reject rows take revision N's
    // cost (the rejected attempt); rerun rows take ~0; auto_review/approve
    // take the cost between previous event and this event.
    const history = Array.isArray(s.history) ? s.history as Array<Record<string, unknown>> : [];
    const historyUsage = history.map((h, _idx) => {
      const kind = String(h.kind);
      // Cost-bearing kinds: reject (work that was rejected),
      // auto_review (work that was just reviewed), approve (any final work).
      // Rerun and the first auto_review of revision 1 carry ~0/small.
      if (isInactive) {
        return { totalTokens: 0, cost: 0, calls: 0 };
      }
      if (kind === 'reject' || kind === 'auto_review' || kind === 'approve') {
        // Each work-bearing event carries roughly base cost (one attempt's worth).
        return {
          totalTokens: Math.round((base.in + base.out + base.cr + base.cw) * 0.9),
          cost: +(base.cost * 0.9).toFixed(2),
          calls: Math.max(1, Math.round(base.calls * 0.9)),
        };
      }
      // rerun row — user clicked, ~0 work until next event
      return { totalTokens: 0, cost: 0, calls: 0 };
    });

    return {
      agent,
      startedAt: s.startedAt ?? null,
      endedAt: s.finishedAt ?? null,
      cost: +stepCost.toFixed(2),
      totalTokens: tokens,
      inputTokens: base.in * multiplier,
      outputTokens: base.out * multiplier,
      cacheReadTokens: base.cr * multiplier,
      cacheWriteTokens: base.cw * multiplier,
      calls: stepCalls,
      history: historyUsage.length > 0 ? historyUsage : undefined,
    };
  });

  return {
    total: {
      cost: +totalCost.toFixed(2),
      totalTokens,
      calls: totalCalls,
    },
    steps: stepPayloads,
    hasOverlap: false,
    synthetic: true,
    note: 'Demo-only synthetic usage. Real epics compute from ~/.claude/projects/*.jsonl.',
  };
}

/**
 * Build a Claude Code slash-command markdown file from one of the demo
 * agents. The result lives at `.claude/commands/<name>.md` and is what
 * actually makes `/demo-plan EPIC-ID` work in the Claude REPL — Claude
 * Code reads from `.claude/commands/`, not from `.aidlc/workspace.yaml`.
 *
 * The body inlines the skill prompt + AIDLC-specific task wiring so the
 * agent knows to:
 *   - read the epic's state.json / inputs.json
 *   - honour any carried feedback from a prior reject (the run's history)
 *   - write the expected artifact under docs/epics/<id>/artifacts/
 *   - tell the user to click "Mark step done" when finished
 *
 * `$ARGUMENTS` is Claude's positional-argument placeholder — whatever
 * the user passes to the slash command (typically the epic id).
 */
function claudeCommand(opts: {
  agentLabel: string;
  description: string;
  artifact: string;
  stepIdx: number;
  skillBody: string;
}): string {
  return `---
description: ${opts.description}
---

You are the **${opts.agentLabel}** agent for the AIDLC demo pipeline.

## Skill

${opts.skillBody.trim()}

## Task

The user invoked you with epic id \`$ARGUMENTS\`.

1. Read \`docs/epics/$ARGUMENTS/state.json\` to understand the run.
   - The current step is index ${opts.stepIdx}.
   - If \`stepStates[${opts.stepIdx}].feedback\` is set, the previous
     reviewer asked for changes — address that feedback explicitly in
     this revision.
   - If \`stepStates[${opts.stepIdx}].history\` contains \`reject\`
     entries, read their \`reason\` fields for context.

2. Read \`docs/epics/$ARGUMENTS/inputs.json\` for capability bindings
   (jira ticket, files glob, github repo, etc.) — these are the
   user-supplied inputs for this run.

3. Produce \`docs/epics/$ARGUMENTS/artifacts/${opts.artifact}\`. The
   AIDLC validator checks for this file's existence when the user
   marks the step done.

4. When finished, summarize what you produced and tell the user to
   click "Mark step done" in the AIDLC sidebar to advance the pipeline.
`;
}

function mapRichStatus(status: string): 'pending' | 'in_progress' | 'done' | 'failed' {
  switch (status) {
    case 'approved':
      return 'done';
    case 'rejected':
      return 'failed';
    case 'awaiting_work':
    case 'awaiting_auto_review':
    case 'awaiting_review':
      return 'in_progress';
    default:
      return 'pending';
  }
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

  // Synthetic usage sidecar so the simple gate-state demos (DEMO-001..005)
  // also light up the ⚡ badge. Each step uses its base "typical Opus 4.x"
  // cost; pending steps contribute zero (no work done yet).
  writeJson(
    path.join(root, '.aidlc', 'runs', `${epicId}.usage.json`),
    buildSimpleSyntheticUsage(steps),
  );
}

function buildSimpleSyntheticUsage(
  steps: Array<Record<string, unknown>>,
): Record<string, unknown> {
  let totalCost = 0, totalTokens = 0, totalCalls = 0;
  const stepPayloads = steps.map((s) => {
    const agent = String(s.agent);
    const base = SYNTHETIC_USAGE_BY_AGENT[agent] ?? DEFAULT_SYNTHETIC_USAGE;
    const status = String(s.status);
    const isInactive = status === 'pending';
    const multiplier = isInactive ? 0 : 1;
    const tokens = (base.in + base.out + base.cr + base.cw) * multiplier;
    const stepCost = base.cost * multiplier;
    const stepCalls = base.calls * multiplier;
    totalCost += stepCost;
    totalTokens += tokens;
    totalCalls += stepCalls;
    return {
      agent,
      startedAt: s.startedAt ?? null,
      endedAt: s.finishedAt ?? null,
      cost: +stepCost.toFixed(2),
      totalTokens: tokens,
      inputTokens: base.in * multiplier,
      outputTokens: base.out * multiplier,
      cacheReadTokens: base.cr * multiplier,
      cacheWriteTokens: base.cw * multiplier,
      calls: stepCalls,
    };
  });
  return {
    total: { cost: +totalCost.toFixed(2), totalTokens, calls: totalCalls },
    steps: stepPayloads,
    hasOverlap: false,
    synthetic: true,
    note: 'Demo-only synthetic usage. Real epics compute from ~/.claude/projects/*.jsonl.',
  };
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
