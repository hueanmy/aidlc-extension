import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  startRun,
  canStartStep,
  markStepDone,
  approveStep,
  rejectStep,
  rerunStep,
  requestStepUpdate,
  submitAutoReviewVerdict,
  runAutoReview,
  PipelineRunError,
  type PipelineConfig,
  type RunState,
  type AutoReviewVerdict,
} from '../src';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-runs-'));
}

function touch(root: string, rel: string, content = 'x'.repeat(20)): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const PIPELINE_HUMAN: PipelineConfig = {
  id: 'p1',
  on_failure: 'stop',
  steps: [
    { agent: 'po',        requires: [],         produces: ['PRD.md'],         human_review: true,  auto_review: false, enabled: true },
    { agent: 'tech-lead', requires: ['PRD.md'], produces: ['TECH-DESIGN.md'], human_review: true,  auto_review: false, enabled: true },
  ],
};

const PIPELINE_AUTO: PipelineConfig = {
  id: 'p2',
  on_failure: 'stop',
  steps: [
    { agent: 'po', requires: [], produces: ['PRD.md'], human_review: false, auto_review: false, enabled: true },
    {
      agent: 'tech-lead',
      requires: ['PRD.md'],
      produces: ['TECH-DESIGN.md'],
      human_review: true,
      auto_review: true,
      auto_review_runner: '.aidlc/scripts/check-design.mjs',
      enabled: true,
    },
  ],
};

describe('PipelineRunner — state machine', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });

  it('startRun puts step 0 in awaiting_work, others pending', () => {
    const s = startRun({ runId: 'R-1', pipeline: PIPELINE_HUMAN, context: { epic: 'R-1' } });
    expect(s.steps[0].status).toBe('awaiting_work');
    expect(s.steps[1].status).toBe('pending');
    expect(s.currentStepIdx).toBe(0);
    expect(s.status).toBe('running');
  });

  it('markStepDone hard-blocks when produces missing', () => {
    const s = startRun({ runId: 'R-2', pipeline: PIPELINE_HUMAN, context: {} });
    expect(() => markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root })).toThrow(PipelineRunError);
  });

  it('markStepDone hard-blocks when requires missing on step 2 path', () => {
    const s = startRun({ runId: 'R-3', pipeline: PIPELINE_HUMAN, context: {} });
    // Move to step 1 by passing step 0
    touch(root, 'PRD.md');
    let next = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    next = approveStep({ state: next, pipeline: PIPELINE_HUMAN });
    expect(next.currentStepIdx).toBe(1);
    expect(next.steps[1].status).toBe('awaiting_work');
    // Delete the upstream artifact then try markStepDone on step 1 — should hard-block
    fs.rmSync(path.join(root, 'PRD.md'));
    touch(root, 'TECH-DESIGN.md');
    expect(() => markStepDone({ state: next, pipeline: PIPELINE_HUMAN, workspaceRoot: root })).toThrowError(/blocked/i);
  });

  it('canStartStep is a soft read-only check for requires', () => {
    const s = startRun({ runId: 'R-4', pipeline: PIPELINE_HUMAN, context: {} });
    // Step 0 has no requires
    expect(canStartStep({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root })).toEqual({ ok: true });
    // Step 1 needs PRD.md — not there yet
    const check = canStartStep({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root, stepIdx: 1 });
    expect(check.ok).toBe(false);
    if (check.ok) { throw new Error('unreachable'); }
    expect(check.missing).toContain('PRD.md');
  });

  it('human-review path: markStepDone → awaiting_review → approveStep → advance', () => {
    let s = startRun({ runId: 'R-5', pipeline: PIPELINE_HUMAN, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    expect(s.steps[0].status).toBe('awaiting_review');
    expect(s.currentStepIdx).toBe(0);
    s = approveStep({ state: s, pipeline: PIPELINE_HUMAN });
    expect(s.steps[0].status).toBe('approved');
    expect(s.currentStepIdx).toBe(1);
    expect(s.steps[1].status).toBe('awaiting_work');
  });

  it('reject + rerun bumps revision and clears artifacts', () => {
    let s = startRun({ runId: 'R-6', pipeline: PIPELINE_HUMAN, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    s = rejectStep({ state: s, reason: 'missing acceptance criteria' });
    expect(s.steps[0].status).toBe('rejected');
    expect(s.steps[0].rejectReason).toContain('acceptance');

    s = rerunStep({ state: s, feedback: 'add AC list' });
    expect(s.steps[0].status).toBe('awaiting_work');
    expect(s.steps[0].revision).toBe(2);
    expect(s.steps[0].feedback).toBe('add AC list');
    expect(s.steps[0].rejectReason).toBeUndefined();
    expect(s.steps[0].artifactsProduced).toEqual([]);
  });

  it('history accumulates across reject / rerun / approve and survives later transitions', () => {
    let s = startRun({ runId: 'R-6h', pipeline: PIPELINE_HUMAN, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });

    // First reject — in-place
    s = rejectStep({ state: s, reason: 'missing acceptance criteria' });
    s = rerunStep({ state: s, feedback: 'add AC list' });

    // Second reject — same step, in-place again
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    s = rejectStep({ state: s, reason: 'still ambiguous on rate limits' });
    s = rerunStep({ state: s, feedback: 'spell out rate limits' });

    // Third pass approves and advances
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    s = approveStep({ state: s, pipeline: PIPELINE_HUMAN });

    const h = s.steps[0].history ?? [];
    const kinds = h.map((e) => e.kind);
    // reject → rerun → reject → rerun → approve
    expect(kinds).toEqual(['reject', 'rerun', 'reject', 'rerun', 'approve']);
    const rejects = h.filter((e) => e.kind === 'reject');
    expect(rejects.length).toBe(2);
    expect((rejects[0] as { reason?: string }).reason).toContain('acceptance');
    expect((rejects[1] as { reason?: string }).reason).toContain('rate limits');
    expect((rejects[0] as { sentBackToIdx: number }).sentBackToIdx).toBe(0);
    // Final entry is the approve at revision 3 (revision was bumped twice)
    const approve = h[h.length - 1] as { kind: string; revision: number };
    expect(approve.kind).toBe('approve');
    expect(approve.revision).toBe(3);
  });

  it('requestStepUpdate rewinds an approved step + resets downstream to pending', () => {
    // Drive both steps to completion (PIPELINE_HUMAN has 2 steps).
    let s = startRun({ runId: 'R-update', pipeline: PIPELINE_HUMAN, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    s = approveStep({ state: s, pipeline: PIPELINE_HUMAN });
    touch(root, 'TECH-DESIGN.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    s = approveStep({ state: s, pipeline: PIPELINE_HUMAN });
    expect(s.status).toBe('completed');
    expect(s.steps[0].status).toBe('approved');
    expect(s.steps[1].status).toBe('approved');

    // User decides PRD needs an update — request from step 0.
    s = requestStepUpdate({
      state: s,
      pipeline: PIPELINE_HUMAN,
      stepIdx: 0,
      feedback: 'PRD must add rate-limit policy',
    });

    // Step 0 rewound + revision bumped + feedback carried.
    expect(s.steps[0].status).toBe('awaiting_work');
    expect(s.steps[0].revision).toBe(2);
    expect(s.steps[0].feedback).toContain('rate-limit');
    // Step 1 reset to pending (had been approved).
    expect(s.steps[1].status).toBe('pending');
    expect(s.steps[1].artifactsProduced).toEqual([]);
    // History on step 1 PRESERVED so the UI can mark it "previously done".
    expect((s.steps[1].history ?? []).length).toBeGreaterThan(0);
    // currentStepIdx rewound to target.
    expect(s.currentStepIdx).toBe(0);
    // Run flips back to running from completed.
    expect(s.status).toBe('running');
    // Step 0 has a `rerun` entry recording the bump.
    const last = s.steps[0].history?.at(-1);
    expect(last?.kind).toBe('rerun');
    expect((last as { revision: number }).revision).toBe(2);
  });

  it('requestStepUpdate refuses non-approved steps', () => {
    let s = startRun({ runId: 'R-update-bad', pipeline: PIPELINE_HUMAN, context: {} });
    // step 0 is awaiting_work — not approved. Should throw.
    expect(() =>
      requestStepUpdate({
        state: s,
        pipeline: PIPELINE_HUMAN,
        stepIdx: 0,
        feedback: 'changed my mind',
      }),
    ).toThrow(/expected "approved"/);
  });

  it('cascade reject records reject on source step + rerun on target step', () => {
    // Get to step 2 (idx 1) awaiting_review.
    let s = startRun({ runId: 'R-6c', pipeline: PIPELINE_HUMAN, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });
    s = approveStep({ state: s, pipeline: PIPELINE_HUMAN });
    touch(root, 'TECH-DESIGN.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_HUMAN, workspaceRoot: root });

    // Reject step 2 (idx 1), cascade back to step 1 (idx 0).
    s = rejectStep({ state: s, reason: 'PRD lacks rate-limit policy', targetIdx: 0 });

    const sourceHistory = s.steps[1].history ?? [];
    expect(sourceHistory.map((e) => e.kind)).toContain('reject');
    const sourceReject = sourceHistory.find((e) => e.kind === 'reject') as
      | { sentBackToIdx: number; reason?: string }
      | undefined;
    expect(sourceReject?.sentBackToIdx).toBe(0);
    expect(sourceReject?.reason).toContain('rate-limit');

    const targetHistory = s.steps[0].history ?? [];
    const targetRerun = targetHistory.find((e) => e.kind === 'rerun') as
      | { feedback?: string; revision: number }
      | undefined;
    expect(targetRerun).toBeDefined();
    expect(targetRerun?.feedback).toContain('Rejected at step 2');
    expect(targetRerun?.revision).toBe(2);
    expect(s.steps[0].revision).toBe(2);
    expect(s.currentStepIdx).toBe(0);
  });

  // ── Auto-review path ─────────────────────────────────────────────────

  it('auto-review path: markStepDone → awaiting_auto_review (NOT awaiting_review)', () => {
    let s = startRun({ runId: 'R-7', pipeline: PIPELINE_AUTO, context: {} });
    // Step 0 has no auto_review and no human_review → auto-approves and advances
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_AUTO, workspaceRoot: root });
    expect(s.steps[0].status).toBe('approved');
    expect(s.currentStepIdx).toBe(1);

    // Step 1: auto_review=true, human_review=true → after produces, goes to awaiting_auto_review
    touch(root, 'TECH-DESIGN.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_AUTO, workspaceRoot: root });
    expect(s.steps[1].status).toBe('awaiting_auto_review');
    expect(s.currentStepIdx).toBe(1);
  });

  it('submitAutoReviewVerdict pass → awaiting_review (when human_review=true)', () => {
    let s = startRun({ runId: 'R-8', pipeline: PIPELINE_AUTO, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_AUTO, workspaceRoot: root });
    touch(root, 'TECH-DESIGN.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_AUTO, workspaceRoot: root });
    expect(s.steps[1].status).toBe('awaiting_auto_review');

    const verdict: AutoReviewVerdict = {
      decision: 'pass',
      reason: 'all sections present',
      at: '2026-05-05T00:00:00Z',
      runner: 'check-design.mjs',
    };
    s = submitAutoReviewVerdict({ state: s, pipeline: PIPELINE_AUTO, verdict });
    expect(s.steps[1].status).toBe('awaiting_review');
    expect(s.steps[1].autoReviewVerdict).toEqual(verdict);
  });

  it('submitAutoReviewVerdict pass → advance (when human_review=false)', () => {
    const pipelineNoHuman: PipelineConfig = {
      id: 'p3',
      on_failure: 'stop',
      steps: [
        { agent: 'po',        requires: [],         produces: ['PRD.md'],         human_review: false, auto_review: false, enabled: true },
        {
          agent: 'qa',
          requires: ['PRD.md'],
          produces: ['TEST-PLAN.md'],
          human_review: false,
          auto_review: true,
          auto_review_runner: 'x.mjs',
          enabled: true,
        },
      ],
    };
    let s = startRun({ runId: 'R-9', pipeline: pipelineNoHuman, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: pipelineNoHuman, workspaceRoot: root });
    touch(root, 'TEST-PLAN.md');
    s = markStepDone({ state: s, pipeline: pipelineNoHuman, workspaceRoot: root });
    expect(s.steps[1].status).toBe('awaiting_auto_review');

    s = submitAutoReviewVerdict({
      state: s,
      pipeline: pipelineNoHuman,
      verdict: { decision: 'pass', reason: 'ok', at: 't', runner: 'x.mjs' },
    });
    expect(s.steps[1].status).toBe('approved');
    expect(s.status).toBe('completed');
  });

  it('submitAutoReviewVerdict reject → rejected with reason', () => {
    let s = startRun({ runId: 'R-10', pipeline: PIPELINE_AUTO, context: {} });
    touch(root, 'PRD.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_AUTO, workspaceRoot: root });
    touch(root, 'TECH-DESIGN.md');
    s = markStepDone({ state: s, pipeline: PIPELINE_AUTO, workspaceRoot: root });

    s = submitAutoReviewVerdict({
      state: s,
      pipeline: PIPELINE_AUTO,
      verdict: { decision: 'reject', reason: 'missing Risks section', at: 't', runner: 'r.mjs' },
    });
    expect(s.steps[1].status).toBe('rejected');
    expect(s.steps[1].rejectReason).toBe('missing Risks section');
    expect(s.steps[1].autoReviewVerdict?.decision).toBe('reject');

    // Rerun then pass second time
    s = rerunStep({ state: s, feedback: 'addressed' });
    expect(s.steps[1].status).toBe('awaiting_work');
    expect(s.steps[1].autoReviewVerdict).toBeDefined(); // verdict persists
  });

  it('submitAutoReviewVerdict throws when status is not awaiting_auto_review', () => {
    const s = startRun({ runId: 'R-11', pipeline: PIPELINE_AUTO, context: {} });
    expect(() =>
      submitAutoReviewVerdict({
        state: s,
        pipeline: PIPELINE_AUTO,
        verdict: { decision: 'pass', reason: 'ok', at: 't', runner: 'r' },
      }),
    ).toThrow(PipelineRunError);
  });
});

describe('AutoReviewer — runAutoReview script invocation', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });

  function writeScript(rel: string, body: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  it('invokes a passing validator and returns pass verdict', async () => {
    const scriptRel = '.aidlc/scripts/pass.mjs';
    writeScript(
      scriptRel,
      `export default async function () {
        return { decision: 'pass', reason: 'looks fine' };
      }`,
    );

    const pipeline: PipelineConfig = {
      id: 'p',
      on_failure: 'stop',
      steps: [
        {
          agent: 'tech-lead',
          requires: [],
          produces: ['DESIGN.md'],
          human_review: false,
          auto_review: true,
          auto_review_runner: scriptRel,
          enabled: true,
        },
      ],
    };
    let s = startRun({ runId: 'R-AR1', pipeline, context: {} });
    touch(root, 'DESIGN.md');
    s = markStepDone({ state: s, pipeline, workspaceRoot: root });
    expect(s.steps[0].status).toBe('awaiting_auto_review');

    const verdict = await runAutoReview({ workspaceRoot: root, state: s, pipeline });
    expect(verdict.decision).toBe('pass');
    expect(verdict.reason).toBe('looks fine');
    expect(verdict.runner.endsWith('pass.mjs')).toBe(true);
  });

  it('catches script throws and emits a reject verdict', async () => {
    const scriptRel = '.aidlc/scripts/throws.mjs';
    writeScript(
      scriptRel,
      `export default async function () {
        throw new Error('boom');
      }`,
    );
    const pipeline: PipelineConfig = {
      id: 'p',
      on_failure: 'stop',
      steps: [
        {
          agent: 'tech-lead',
          requires: [],
          produces: ['DESIGN.md'],
          human_review: false,
          auto_review: true,
          auto_review_runner: scriptRel,
          enabled: true,
        },
      ],
    };
    let s = startRun({ runId: 'R-AR2', pipeline, context: {} });
    touch(root, 'DESIGN.md');
    s = markStepDone({ state: s, pipeline, workspaceRoot: root });

    const verdict = await runAutoReview({ workspaceRoot: root, state: s, pipeline });
    expect(verdict.decision).toBe('reject');
    expect(verdict.reason).toMatch(/boom/);
  });

  it('rejects when default export is missing', async () => {
    const scriptRel = '.aidlc/scripts/empty.mjs';
    writeScript(scriptRel, `export const notDefault = 1;`);
    const pipeline: PipelineConfig = {
      id: 'p',
      on_failure: 'stop',
      steps: [
        {
          agent: 'a',
          requires: [],
          produces: ['X.md'],
          human_review: false,
          auto_review: true,
          auto_review_runner: scriptRel,
          enabled: true,
        },
      ],
    };
    let s = startRun({ runId: 'R-AR3', pipeline, context: {} });
    touch(root, 'X.md');
    s = markStepDone({ state: s, pipeline, workspaceRoot: root });
    await expect(runAutoReview({ workspaceRoot: root, state: s, pipeline })).rejects.toThrow(/default function/);
  });
});
