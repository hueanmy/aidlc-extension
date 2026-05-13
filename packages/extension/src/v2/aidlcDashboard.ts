/**
 * Reads plan progress and pipeline run summaries from the workspace's
 * .aidlc directory. Used by the Token Report webview to show project
 * execution context alongside token usage stats.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface PlanTask {
  id: string;
  title: string;
  epic?: string;
  assignee?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  status: string;
  pipeline?: string | null;
}

export interface PlanProgress {
  source: string;
  total: number;
  done: number;
  inProgress: number;
  pending: number;
  overdue: number;
  withPipeline: number;
}

export interface RunSummary {
  runId: string;
  user: string;
  pipelineId: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  stepCount: number;
  approvedSteps: number;
  rejectedSteps: number;
  totalRevisions: number;
  durationMs: number | null;
}

export interface RunStats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  avgDurationMs: number | null;
  mostUsedPipeline: string | null;
  totalRejections: number;
  avgRevisionsPerRun: number;
}

export interface AidlcDashboard {
  planProgress: PlanProgress | null;
  recentRuns: RunSummary[];
  runStats: RunStats;
}

export function loadPlanProgress(workspaceRoot: string): PlanProgress | null {
  try {
    const planPath = path.join(workspaceRoot, '.aidlc', 'plan.json');
    if (!fs.existsSync(planPath)) { return null; }
    const raw = fs.readFileSync(planPath, 'utf-8');
    const data = JSON.parse(raw) as { tasks?: PlanTask[] };
    const tasks: PlanTask[] = Array.isArray(data.tasks) ? data.tasks : [];
    const today = new Date().toISOString().slice(0, 10);
    let done = 0;
    let inProgress = 0;
    let pending = 0;
    let overdue = 0;
    let withPipeline = 0;
    for (const task of tasks) {
      const s = (task.status ?? '').toLowerCase();
      if (s === 'done') { done++; }
      else if (s === 'in_progress' || s === 'in-progress') { inProgress++; }
      else { pending++; }
      if (
        task.scheduled_end &&
        task.scheduled_end < today &&
        s !== 'done'
      ) {
        overdue++;
      }
      if (task.pipeline) { withPipeline++; }
    }
    return {
      source: path.basename(planPath),
      total: tasks.length,
      done,
      inProgress,
      pending,
      overdue,
      withPipeline,
    };
  } catch {
    return null;
  }
}

export function loadRunSummaries(workspaceRoot: string): RunSummary[] {
  try {
    const runsDir = path.join(workspaceRoot, '.aidlc', 'runs');
    if (!fs.existsSync(runsDir)) { return []; }
    const files = collectJsonFiles(runsDir);
    const summaries: RunSummary[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = JSON.parse(raw) as Record<string, any>;
        // Derive user from path: .aidlc/runs/<user>/FILE.json or .aidlc/runs/FILE.json
        const rel = path.relative(runsDir, file);
        const parts = rel.split(path.sep);
        const user = parts.length > 1 ? parts[0] : 'default';

        const status: 'running' | 'completed' | 'failed' =
          data['status'] === 'completed' ? 'completed'
          : data['status'] === 'failed' ? 'failed'
          : 'running';

        const steps: Array<Record<string, unknown>> =
          Array.isArray(data['steps']) ? data['steps'] as Array<Record<string, unknown>> : [];

        let approvedSteps = 0;
        let rejectedSteps = 0;
        let totalRevisions = 0;
        for (const step of steps) {
          const st = String(step['status'] ?? '');
          if (st === 'approved') { approvedSteps++; }
          if (st === 'rejected') { rejectedSteps++; }
          const rev = Number(step['revision'] ?? 0);
          if (Number.isFinite(rev)) { totalRevisions += rev; }
        }

        let durationMs: number | null = null;
        if (status === 'completed' && steps.length > 0) {
          const last = steps[steps.length - 1];
          const finishedAt = String(last['finishedAt'] ?? '');
          const startedAt = String(data['startedAt'] ?? '');
          const t0 = Date.parse(startedAt);
          const t1 = Date.parse(finishedAt);
          if (Number.isFinite(t0) && Number.isFinite(t1)) {
            durationMs = t1 - t0;
          }
        }

        summaries.push({
          runId: String(data['runId'] ?? path.basename(file, '.json')),
          user,
          pipelineId: String(data['pipelineId'] ?? ''),
          startedAt: String(data['startedAt'] ?? ''),
          status,
          stepCount: steps.length,
          approvedSteps,
          rejectedSteps,
          totalRevisions,
          durationMs,
        });
      } catch {
        // skip malformed run files
      }
    }
    summaries.sort((a, b) => {
      const ta = Date.parse(a.startedAt);
      const tb = Date.parse(b.startedAt);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return summaries.slice(0, 10);
  } catch {
    return [];
  }
}

function collectJsonFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...collectJsonFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        result.push(full);
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return result;
}

export function buildRunStats(runs: RunSummary[]): RunStats {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      avgDurationMs: null,
      mostUsedPipeline: null,
      totalRejections: 0,
      avgRevisionsPerRun: 0,
    };
  }
  let completedRuns = 0;
  let failedRuns = 0;
  let runningRuns = 0;
  let totalRejections = 0;
  let totalRevisions = 0;
  const durationSamples: number[] = [];
  const pipelineCounts = new Map<string, number>();

  for (const run of runs) {
    if (run.status === 'completed') { completedRuns++; }
    else if (run.status === 'failed') { failedRuns++; }
    else { runningRuns++; }
    totalRejections += run.rejectedSteps;
    totalRevisions += run.totalRevisions;
    if (run.durationMs !== null) { durationSamples.push(run.durationMs); }
    if (run.pipelineId) {
      pipelineCounts.set(run.pipelineId, (pipelineCounts.get(run.pipelineId) ?? 0) + 1);
    }
  }

  let mostUsedPipeline: string | null = null;
  let maxCount = 0;
  for (const [pid, cnt] of pipelineCounts) {
    if (cnt > maxCount) { maxCount = cnt; mostUsedPipeline = pid; }
  }

  const avgDurationMs = durationSamples.length > 0
    ? durationSamples.reduce((s, x) => s + x, 0) / durationSamples.length
    : null;

  return {
    totalRuns: runs.length,
    completedRuns,
    failedRuns,
    runningRuns,
    avgDurationMs,
    mostUsedPipeline,
    totalRejections,
    avgRevisionsPerRun: runs.length > 0 ? totalRevisions / runs.length : 0,
  };
}

export function loadAidlcDashboard(workspaceRoot: string): AidlcDashboard {
  const recentRuns = loadRunSummaries(workspaceRoot);
  return {
    planProgress: loadPlanProgress(workspaceRoot),
    recentRuns,
    runStats: buildRunStats(recentRuns),
  };
}
