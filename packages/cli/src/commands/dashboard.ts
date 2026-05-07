import * as http from 'http';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import chokidar from 'chokidar';
import {
  WorkspaceLoader,
  RunStateStore,
  approveStep,
  rejectStep,
  rerunStep,
  markStepDone,
  PipelineRunError,
  type RunState,
} from '@aidlc/core';
import { resolveWorkspaceRoot } from '../workspaceRoot';
import { readYaml } from '../yamlIO';
import { listEpics } from '../epicsList';

const RUNS_GLOB     = '.aidlc/runs/*.json';
const WORKSPACE_YML = '.aidlc/workspace.yaml';

export function registerDashboard(program: Command): void {
  program
    .command('dashboard')
    .description('Serve a browser dashboard for runs / workflows / epics (live, click-to-approve)')
    .option('-p, --port <number>', 'Port to listen on', '8787')
    .option('--host <host>', 'Bind address (use 0.0.0.0 to expose on LAN)', '127.0.0.1')
    .action((opts: { port: string; host: string }, cmd: Command) => {
      const root = resolveWorkspaceRoot(cmd);
      const port = parseInt(opts.port, 10);
      const host = opts.host;

      const sseClients = new Set<http.ServerResponse>();

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://${host}:${port}`);

        if (url.pathname === '/' || url.pathname === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(HTML);
          return;
        }

        if (url.pathname === '/api/runs') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(RunStateStore.list(root)));
          return;
        }

        if (url.pathname.startsWith('/api/runs/')) {
          const runId = url.pathname.slice('/api/runs/'.length);
          const state = RunStateStore.load(root, runId);
          if (!state) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(state));
          return;
        }

        if (url.pathname === '/api/workspace') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          try {
            const doc = readYaml(root);
            res.end(JSON.stringify({
              name:      doc?.name      ?? 'AIDLC Workspace',
              version:   doc?.version   ?? '1.0',
              agents:    doc?.agents    ?? [],
              skills:    doc?.skills    ?? [],
              pipelines: doc?.pipelines ?? [],
            }));
          } catch (err) {
            res.end(JSON.stringify({
              name: 'AIDLC Workspace', version: '1.0',
              agents: [], skills: [], pipelines: [],
              error: err instanceof Error ? err.message : String(err),
            }));
          }
          return;
        }

        if (url.pathname === '/api/epics') {
          const doc = readYaml(root);
          const epics = listEpics(root, doc);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(epics));
          return;
        }

        if (url.pathname === '/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(': hello\n\n');
          sseClients.add(res);

          const heartbeat = setInterval(() => {
            try { res.write(': hb\n\n'); } catch { /* ignore */ }
          }, 15_000);

          req.on('close', () => {
            clearInterval(heartbeat);
            sseClients.delete(res);
          });
          return;
        }

        if (url.pathname === '/api/action' && req.method === 'POST') {
          handleAction(req, res, root);
          return;
        }

        res.writeHead(404);
        res.end('not found');
      });

      // Watch state, workspace.yaml AND epic state.json files
      const watcher = chokidar.watch(
        [
          path.join(root, RUNS_GLOB),
          path.join(root, WORKSPACE_YML),
          path.join(root, 'docs/epics/*/state.json'),  // common default
          path.join(root, 'docs/sdlc/epics/*/state.json'),
        ],
        { persistent: true, ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 } },
      );

      let timer: NodeJS.Timeout | null = null;
      const broadcast = () => {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(() => {
          for (const client of sseClients) {
            try { client.write(`data: refresh\n\n`); } catch { /* ignore */ }
          }
        }, 100);
      };
      watcher.on('all', broadcast);

      server.listen(port, host, () => {
        console.log(chalk.green('✔') + ` Dashboard live at ${chalk.bold(`http://${host}:${port}`)}`);
        console.log(chalk.dim(`  workspace: ${root}`));
        console.log(chalk.dim(`  Ctrl+C to stop\n`));
      });

      process.on('SIGINT', () => {
        for (const c of sseClients) { try { c.end(); } catch { /* */ } }
        server.close();
        void watcher.close().then(() => process.exit(0));
      });
    });
}

// ── Action handler ────────────────────────────────────────────────────────────

interface ActionPayload {
  runId: string;
  type: 'mark-done' | 'approve' | 'reject' | 'rerun';
  reason?: string;
  comment?: string;
  feedback?: string;
}

const MAX_BODY_BYTES = 64 * 1024;

function handleAction(req: http.IncomingMessage, res: http.ServerResponse, root: string): void {
  let body = '';
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
    if (body.length > MAX_BODY_BYTES && !aborted) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `request body exceeds ${MAX_BODY_BYTES} bytes` }));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) { return; }
    let payload: ActionPayload;
    try {
      payload = JSON.parse(body) as ActionPayload;
    } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    const state = RunStateStore.load(root, payload.runId);
    if (!state) {
      res.writeHead(404); res.end(JSON.stringify({ error: `run not found: ${payload.runId}` }));
      return;
    }

    let next: RunState;
    try {
      switch (payload.type) {
        case 'mark-done': {
          const ws = WorkspaceLoader.load(root);
          const pipeline = ws.config.pipelines.find(p => p.id === state.pipelineId);
          if (!pipeline) { throw new Error(`pipeline ${state.pipelineId} not found`); }
          next = markStepDone({ state, pipeline, workspaceRoot: root });
          break;
        }
        case 'approve': {
          const ws = WorkspaceLoader.load(root);
          const pipeline = ws.config.pipelines.find(p => p.id === state.pipelineId);
          if (!pipeline) { throw new Error(`pipeline ${state.pipelineId} not found`); }
          next = approveStep({ state, pipeline });
          if (payload.comment) {
            next.steps[state.currentStepIdx].feedback = payload.comment;
          }
          break;
        }
        case 'reject':
          next = rejectStep({ state, reason: payload.reason ?? '' });
          break;
        case 'rerun':
          next = rerunStep({ state, feedback: payload.feedback });
          break;
        default:
          res.writeHead(400);
          res.end(JSON.stringify({ error: `unknown action: ${(payload as ActionPayload).type}` }));
          return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const missing = err instanceof PipelineRunError ? err.missing : undefined;
      res.writeHead(400);
      res.end(JSON.stringify({ error: msg, missing }));
      return;
    }

    RunStateStore.save(root, next);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, state: next }));
  });
}

// ── HTML UI ───────────────────────────────────────────────────────────────────

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>aidlc dashboard</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --panel-2: #1c2128; --border: #30363d;
    --text: #c9d1d9; --muted: #8b949e; --accent: #58a6ff; --accent-2: #5eead4;
    --green: #3fb950; --yellow: #d29922; --red: #f85149; --cyan: #79c0ff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  body { background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

  /* Top bar */
  .topbar { display: flex; align-items: center; padding: 0 24px; height: 52px; border-bottom: 1px solid var(--border);
    flex-shrink: 0; gap: 24px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; }
  .brand-dot { width: 28px; height: 28px; border-radius: 8px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
  .tabs { display: flex; gap: 4px; flex: 1; }
  .tab { padding: 0 18px; height: 52px; border: none; background: none; color: var(--muted); cursor: pointer;
    font-size: 14px; border-bottom: 2px solid transparent; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--text); border-bottom-color: var(--accent-2); }
  .live { display: inline-flex; align-items: center; gap: 6px; color: var(--green); font-size: 11px; }
  .live::before { content: ''; width: 8px; height: 8px; background: var(--green); border-radius: 50%;
    animation: pulse 2s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }

  /* View containers */
  .view { display: none; flex: 1; overflow: hidden; }
  .view.active { display: flex; }

  /* ── Runs view ── */
  .runs-sidebar { width: 320px; border-right: 1px solid var(--border); overflow-y: auto; flex-shrink: 0; }
  .runs-sidebar h1 { font-size: 11px; padding: 14px 16px; border-bottom: 1px solid var(--border);
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .run-card { padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .run-card:hover { background: rgba(255,255,255,0.04); }
  .run-card.active { background: rgba(88,166,255,0.1); border-left: 2px solid var(--accent); padding-left: 14px; }
  .run-card .id { font-weight: 600; font-size: 14px; }
  .run-card .meta { font-size: 12px; color: var(--muted); margin-top: 4px; display: flex; gap: 8px; align-items: center; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .b-running { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .b-completed { background: rgba(63,185,80,0.2); color: var(--green); }
  .b-failed { background: rgba(248,81,73,0.2); color: var(--red); }
  .b-pending { background: rgba(139,148,158,0.2); color: var(--muted); }
  .b-in_progress { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .b-done { background: rgba(63,185,80,0.2); color: var(--green); }
  .progress-bar { height: 4px; background: var(--border); border-radius: 2px; margin-top: 8px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }
  .runs-main, .builder-main, .epics-main { flex: 1; padding: 24px 32px; overflow-y: auto; }
  .empty { color: var(--muted); text-align: center; padding: 80px 0; font-size: 14px; }
  .header { margin-bottom: 24px; }
  .header h2 { font-size: 22px; }
  .header .ctx { color: var(--muted); font-size: 13px; margin-top: 4px; }

  /* Step pipeline (used in Runs and Epics views) */
  .pipeline { display: flex; align-items: stretch; gap: 12px; margin: 24px 0; flex-wrap: wrap; }
  .step { flex: 1; min-width: 120px; padding: 14px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; }
  .step.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .step .num { font-size: 11px; color: var(--muted); }
  .step .agent { font-weight: 600; margin-top: 4px; font-size: 14px; word-break: break-word; }
  .step .status { margin-top: 8px; font-size: 11px; padding: 2px 8px; border-radius: 10px; display: inline-block; }
  .s-pending { background: rgba(139,148,158,0.2); color: var(--muted); }
  .s-awaiting_work { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .s-awaiting_review { background: rgba(121,192,255,0.2); color: var(--cyan); }
  .s-approved, .s-done { background: rgba(63,185,80,0.2); color: var(--green); }
  .s-rejected, .s-failed { background: rgba(248,81,73,0.2); color: var(--red); }
  .s-in_progress { background: rgba(210,153,34,0.2); color: var(--yellow); }

  .actions { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px; margin-top: 24px; }
  .actions h3 { font-size: 14px; margin-bottom: 12px; }
  .actions button { padding: 8px 16px; margin-right: 8px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 13px; }
  .actions button:hover { background: rgba(255,255,255,0.05); }
  .actions button.primary { background: var(--accent); color: white; border-color: var(--accent); }
  .actions button.danger { background: var(--red); color: white; border-color: var(--red); }
  .actions input, .actions textarea { width: 100%; padding: 8px; margin-top: 8px; margin-bottom: 12px;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text);
    font-family: inherit; font-size: 13px; }
  .actions textarea { min-height: 60px; resize: vertical; }
  .reject-reason, .feedback { display: none; }
  .reject-reason.show, .feedback.show { display: block; }
  .err { color: var(--red); margin-top: 8px; font-size: 12px; }
  pre { background: var(--bg); border: 1px solid var(--border); padding: 8px; border-radius: 4px;
    font-size: 11px; margin-top: 8px; }

  /* ── Builder view ── */
  .subtabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 24px;
    margin: -24px -32px 24px -32px; padding: 0 32px; }
  .subtab { padding: 12px 18px; border: none; background: none; color: var(--muted); cursor: pointer;
    font-size: 13px; border-bottom: 2px solid transparent; }
  .subtab:hover { color: var(--text); }
  .subtab.active { color: var(--text); border-bottom-color: var(--accent-2); }
  .subtab .count { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 10px;
    background: var(--panel); color: var(--muted); font-size: 11px; }
  .subview { display: none; }
  .subview.active { display: block; }

  .workflow { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 20px; margin-bottom: 16px; }
  .workflow-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .workflow-head .id { font-weight: 600; font-size: 15px; color: var(--accent-2); }
  .workflow-head .meta { color: var(--muted); font-size: 12px; }
  .pill { padding: 3px 10px; border-radius: 12px; font-size: 11px; background: var(--panel-2);
    color: var(--muted); border: 1px solid var(--border); }
  .pill.warn { background: rgba(210,153,34,0.15); color: var(--yellow); border-color: rgba(210,153,34,0.4); }
  .step-graph { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .step-box { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 14px; min-width: 110px; display: flex; align-items: center; gap: 10px; }
  .step-box .step-num { color: var(--muted); font-size: 12px; }
  .step-box .step-agent { font-size: 13px; word-break: break-word; }
  .step-box .step-meta { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .arrow { color: var(--muted); font-size: 14px; padding: 0 4px; }

  .agent-card, .skill-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 14px 18px; margin-bottom: 10px; }
  .agent-card .id, .skill-card .id { font-weight: 600; color: var(--accent-2); font-size: 14px; }
  .agent-card .name { color: var(--text); font-weight: 500; }
  .agent-card .meta, .skill-card .meta { color: var(--muted); font-size: 12px; margin-top: 6px;
    display: flex; gap: 12px; flex-wrap: wrap; }
  .chip { background: var(--panel-2); padding: 2px 8px; border-radius: 6px; font-size: 11px; }

  /* ── Epics view ── */
  .epics-filters { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .filter { padding: 6px 14px; border: 1px solid var(--border); border-radius: 16px;
    background: var(--panel); color: var(--muted); cursor: pointer; font-size: 13px; }
  .filter:hover { color: var(--text); }
  .filter.active { background: var(--accent); color: white; border-color: var(--accent); }
  .filter .count { opacity: 0.7; margin-left: 6px; }
  .epic-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 20px; margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s; }
  .epic-card:hover { border-color: var(--accent); }
  .epic-card.expanded { border-color: var(--accent-2); }
  .epic-head { display: flex; align-items: center; gap: 12px; }
  .epic-head .id { font-weight: 600; color: var(--accent-2); font-size: 15px; min-width: 100px; }
  .epic-head .title { flex: 1; font-size: 14px; word-break: break-word; }
  .epic-head .pct { padding: 3px 10px; border-radius: 12px; background: var(--panel-2); font-size: 12px;
    color: var(--accent-2); border: 1px solid var(--border); min-width: 50px; text-align: center; }
  .epic-detail { display: none; padding: 16px 0 0; border-top: 1px solid var(--border); margin-top: 14px; }
  .epic-card.expanded .epic-detail { display: block; }

  /* Misc */
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head><body>

<div class="topbar">
  <div class="brand">
    <div class="brand-dot"></div>
    <span>AIDLC</span>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="runs">Runs</button>
    <button class="tab" data-tab="builder">Builder</button>
    <button class="tab" data-tab="epics">Epics</button>
  </div>
  <span class="live">live</span>
</div>

<!-- ── Runs view ───────────────────────────────────────────────────────────── -->
<div class="view active" id="view-runs">
  <div class="runs-sidebar">
    <h1>Pipeline Runs</h1>
    <div id="runs-list"></div>
  </div>
  <div class="runs-main" id="runs-main">
    <div class="empty">Pick a run from the left.</div>
  </div>
</div>

<!-- ── Builder view ────────────────────────────────────────────────────────── -->
<div class="view" id="view-builder">
  <div class="builder-main" style="width: 100%">
    <div class="subtabs">
      <button class="subtab active" data-sub="workflows">Workflows <span class="count" id="cnt-workflows">0</span></button>
      <button class="subtab" data-sub="agents">Agents <span class="count" id="cnt-agents">0</span></button>
      <button class="subtab" data-sub="skills">Skills <span class="count" id="cnt-skills">0</span></button>
    </div>
    <div class="subview active" id="sub-workflows"></div>
    <div class="subview" id="sub-agents"></div>
    <div class="subview" id="sub-skills"></div>
  </div>
</div>

<!-- ── Epics view ──────────────────────────────────────────────────────────── -->
<div class="view" id="view-epics">
  <div class="epics-main" style="width: 100%">
    <div class="epics-filters" id="epics-filters"></div>
    <div id="epics-list"></div>
  </div>
</div>

<script>
let activeRunId = null;
let activeTab = 'runs';
let activeSubTab = 'workflows';
let activeFilter = 'all';
let runs = [];
let workspace = null;
let epics = [];

const STATUS_LABEL = {
  pending: 'pending', awaiting_work: 'awaiting work',
  awaiting_review: 'awaiting review', approved: 'approved', rejected: 'rejected',
  in_progress: 'in progress', done: 'done', failed: 'failed',
};

// ── Top tab navigation ──────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  // Refresh data for the newly active tab
  if (name === 'runs')    refreshRuns();
  if (name === 'builder') refreshWorkspace();
  if (name === 'epics')   refreshEpics();
}

// ── Runs view ───────────────────────────────────────────────────────────────
async function refreshRuns() {
  runs = await (await fetch('/api/runs')).json();
  renderRunsSidebar();
  if (activeRunId) {
    const cur = runs.find(r => r.runId === activeRunId);
    if (cur) renderRunDetail(cur); else clearRunMain();
  }
}

function renderRunsSidebar() {
  const el = document.getElementById('runs-list');
  if (!runs.length) {
    el.innerHTML = '<div class="empty" style="padding:40px 16px;font-size:13px">No runs yet.<br><br><code>aidlc run start &lt;pipelineId&gt;</code></div>';
    return;
  }
  el.innerHTML = runs.map(r => {
    const done = r.steps.filter(s => s.status === 'approved').length;
    const total = r.steps.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const cls = activeRunId === r.runId ? 'run-card active' : 'run-card';
    return \`<div class="\${cls}" onclick="selectRun('\${r.runId}')">
      <div class="id">\${esc(r.runId)}</div>
      <div class="meta">
        <span>\${esc(r.pipelineId)}</span>
        <span class="badge b-\${r.status}">\${r.status}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:\${pct}%"></div></div>
    </div>\`;
  }).join('');
}

function selectRun(runId) {
  activeRunId = runId;
  renderRunsSidebar();
  const cur = runs.find(r => r.runId === runId);
  if (cur) renderRunDetail(cur);
}

function clearRunMain() {
  document.getElementById('runs-main').innerHTML = '<div class="empty">Pick a run from the left.</div>';
  activeRunId = null;
}

function renderRunDetail(run) {
  const ctx = Object.entries(run.context).map(([k,v]) => \`\${k}=\${v}\`).join(', ');
  const cur = run.steps[run.currentStepIdx];

  const stepsHtml = run.steps.map((s, i) => {
    const cls = i === run.currentStepIdx ? 'step current' : 'step';
    return \`<div class="\${cls}">
      <div class="num">Step \${i + 1}</div>
      <div class="agent">\${esc(s.agent)}</div>
      <div class="status s-\${s.status}">\${STATUS_LABEL[s.status] || s.status}</div>
      \${s.revision > 1 ? '<div class="num" style="margin-top:4px">rev '+s.revision+'</div>' : ''}
    </div>\`;
  }).join('');

  let actions = '';
  if (run.status === 'completed') {
    actions = '<div class="actions"><h3>✓ Run complete</h3></div>';
  } else if (cur && cur.status === 'awaiting_work') {
    actions = \`<div class="actions"><h3>Current step: <strong>\${esc(cur.agent)}</strong> (awaiting work)</h3>
      <p style="color:var(--muted);font-size:12px;margin:8px 0 12px">Run the agent externally, then mark done. The CLI validates produces paths.</p>
      <button class="primary" onclick="runAct('mark-done')">Mark step done</button>
      </div>\`;
  } else if (cur && cur.status === 'awaiting_review') {
    actions = \`<div class="actions"><h3>Current step: <strong>\${esc(cur.agent)}</strong> (awaiting review)</h3>
      <button class="primary" onclick="approveWithComment()">Approve</button>
      <button class="danger" onclick="document.getElementById('reject-form').classList.toggle('show')">Reject</button>
      <div class="reject-reason" id="reject-form">
        <textarea id="reject-reason" placeholder="Why are you rejecting this step?"></textarea>
        <button class="danger" onclick="runAct('reject', { reason: document.getElementById('reject-reason').value })">Confirm reject</button>
      </div>
      </div>\`;
  } else if (cur && cur.status === 'rejected') {
    actions = \`<div class="actions"><h3>Current step: <strong>\${esc(cur.agent)}</strong> (rejected)</h3>
      \${cur.rejectReason ? '<p style="color:var(--red);font-size:13px;margin:8px 0">"'+esc(cur.rejectReason)+'"</p>' : ''}
      <button class="primary" onclick="document.getElementById('feedback-form').classList.toggle('show')">Rerun with feedback</button>
      <div class="feedback" id="feedback-form">
        <textarea id="feedback-text" placeholder="Notes for the next attempt (optional)"></textarea>
        <button class="primary" onclick="runAct('rerun', { feedback: document.getElementById('feedback-text').value })">Confirm rerun</button>
      </div>
      </div>\`;
  }

  document.getElementById('runs-main').innerHTML = \`
    <div class="header">
      <h2>\${esc(run.runId)}</h2>
      <div class="ctx">pipeline: \${esc(run.pipelineId)} \${ctx ? '· context: '+esc(ctx) : ''}</div>
    </div>
    <div class="pipeline">\${stepsHtml}</div>
    \${actions}
    <div id="action-result"></div>
  \`;
}

async function approveWithComment() {
  const comment = prompt('Optional approval comment:') ?? '';
  await runAct('approve', comment ? { comment } : {});
}

async function runAct(type, extra = {}) {
  if (!activeRunId) return;
  const result = document.getElementById('action-result');
  result.innerHTML = '<div style="color:var(--muted);font-size:12px;margin-top:12px">working…</div>';
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: activeRunId, type, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) {
    let html = '<div class="err">✘ '+esc(data.error || 'failed')+'</div>';
    if (data.missing && data.missing.length) {
      html += '<pre>missing artifacts:\\n' + data.missing.map(m => '  '+m).join('\\n') + '</pre>';
    }
    result.innerHTML = html;
  } else {
    result.innerHTML = '<div style="color:var(--green);font-size:12px;margin-top:12px">✓ done</div>';
    document.querySelectorAll('.reject-reason.show, .feedback.show').forEach(el => el.classList.remove('show'));
    setTimeout(() => result.innerHTML = '', 2000);
  }
  await refreshRuns();
}

// ── Builder view ────────────────────────────────────────────────────────────
document.querySelectorAll('.subtab').forEach(btn => {
  btn.addEventListener('click', () => switchSubTab(btn.dataset.sub));
});

function switchSubTab(name) {
  activeSubTab = name;
  document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  document.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
  document.getElementById('sub-' + name).classList.add('active');
}

async function refreshWorkspace() {
  workspace = await (await fetch('/api/workspace')).json();
  document.getElementById('cnt-workflows').textContent = (workspace.pipelines || []).length;
  document.getElementById('cnt-agents').textContent    = (workspace.agents    || []).length;
  document.getElementById('cnt-skills').textContent    = (workspace.skills    || []).length;
  renderWorkflows();
  renderAgents();
  renderSkills();
}

function renderWorkflows() {
  const el = document.getElementById('sub-workflows');
  const pipelines = workspace?.pipelines || [];
  if (!pipelines.length) {
    el.innerHTML = '<div class="empty">No workflows. Try: <code>aidlc pipeline add</code></div>';
    return;
  }
  el.innerHTML = pipelines.map(p => {
    const onFailure = p.on_failure || 'stop';
    const stepsHtml = (p.steps || []).map((s, i) => {
      const agent = typeof s === 'string' ? s : (s.agent || '?');
      const review = typeof s === 'object' && s.human_review ? '<div class="step-meta">human review</div>' : '';
      const arrow = i < p.steps.length - 1 ? '<span class="arrow">→</span>' : '';
      return \`<div class="step-box"><span class="step-num">\${i+1}</span><div><div class="step-agent">\${esc(agent)}</div>\${review}</div></div>\${arrow}\`;
    }).join('');
    return \`<div class="workflow">
      <div class="workflow-head">
        <div><span class="id">\${esc(p.id)}</span> <span class="meta">\${(p.steps || []).length} steps</span></div>
        <span class="pill \${onFailure === 'stop' ? 'warn' : ''}">on_failure: \${esc(onFailure)}</span>
      </div>
      <div class="step-graph">\${stepsHtml}</div>
    </div>\`;
  }).join('');
}

function renderAgents() {
  const el = document.getElementById('sub-agents');
  const agents = workspace?.agents || [];
  if (!agents.length) {
    el.innerHTML = '<div class="empty">No agents. Try: <code>aidlc agent add</code></div>';
    return;
  }
  el.innerHTML = agents.map(a => {
    const caps = (a.capabilities || []).map(c => '<span class="chip">'+esc(c)+'</span>').join(' ');
    return \`<div class="agent-card">
      <div><span class="id">\${esc(a.id)}</span> <span class="name">\${esc(a.name || '')}</span></div>
      <div class="meta">
        <span class="chip">skill: \${esc(a.skill || '')}</span>
        \${a.model ? '<span class="chip">'+esc(a.model)+'</span>' : ''}
        \${a.runner && a.runner !== 'default' ? '<span class="chip">runner: '+esc(a.runner)+'</span>' : ''}
        \${caps}
      </div>
      \${a.description ? '<div class="meta" style="margin-top:8px;font-style:italic">'+esc(a.description)+'</div>' : ''}
    </div>\`;
  }).join('');
}

function renderSkills() {
  const el = document.getElementById('sub-skills');
  const skills = workspace?.skills || [];
  if (!skills.length) {
    el.innerHTML = '<div class="empty">No skills. Try: <code>aidlc skill add --template hello-world</code></div>';
    return;
  }
  el.innerHTML = skills.map(s => {
    const source = s.builtin ? '<span class="chip">builtin</span>' : '<span class="chip">'+esc(s.path || '')+'</span>';
    return \`<div class="skill-card">
      <div><span class="id">\${esc(s.id)}</span></div>
      <div class="meta">\${source}</div>
    </div>\`;
  }).join('');
}

// ── Epics view ──────────────────────────────────────────────────────────────
async function refreshEpics() {
  epics = await (await fetch('/api/epics')).json();
  renderEpicFilters();
  renderEpicsList();
}

function renderEpicFilters() {
  const counts = { all: epics.length, pending: 0, in_progress: 0, done: 0, failed: 0 };
  for (const e of epics) {
    if (counts[e.status] !== undefined) counts[e.status]++;
  }
  const labels = [
    ['all', 'All'], ['in_progress', 'In progress'],
    ['pending', 'Pending'], ['done', 'Done'], ['failed', 'Failed'],
  ];
  const el = document.getElementById('epics-filters');
  el.innerHTML = labels.map(([k, label]) => {
    const cls = activeFilter === k ? 'filter active' : 'filter';
    return \`<button class="\${cls}" onclick="setEpicFilter('\${k}')">\${label} <span class="count">\${counts[k]}</span></button>\`;
  }).join('');
}

function setEpicFilter(k) {
  activeFilter = k;
  renderEpicFilters();
  renderEpicsList();
}

function renderEpicsList() {
  const el = document.getElementById('epics-list');
  const filtered = activeFilter === 'all' ? epics : epics.filter(e => e.status === activeFilter);
  if (!filtered.length) {
    el.innerHTML = '<div class="empty">No epics match this filter.</div>';
    return;
  }
  el.innerHTML = filtered.map(e => {
    const total = (e.stepDetails || []).length;
    const done  = (e.stepDetails || []).filter(s => s.status === 'done').length;
    const pct   = total ? Math.round((done / total) * 100) : 0;

    const stepsHtml = (e.stepDetails || []).map((s, i) => {
      const cls = i === e.currentStep && e.status === 'in_progress' ? 'step current' : 'step';
      return \`<div class="\${cls}">
        <div class="num">Step \${i + 1}</div>
        <div class="agent">\${esc(s.agent)}</div>
        <div class="status s-\${s.status}">\${STATUS_LABEL[s.status] || s.status}</div>
      </div>\`;
    }).join('');

    return \`<div class="epic-card" onclick="this.classList.toggle('expanded')">
      <div class="epic-head">
        <div class="id">\${esc(e.id)}</div>
        <div class="title">\${esc(e.title || '(untitled)')}</div>
        <div class="pct">\${pct}%</div>
        <span class="badge b-\${e.status}">\${STATUS_LABEL[e.status] || e.status}</span>
      </div>
      <div class="epic-detail">
        \${e.description ? '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">'+esc(e.description)+'</div>' : ''}
        \${e.pipeline ? '<div style="color:var(--muted);font-size:12px;margin-bottom:12px">pipeline: <code>'+esc(e.pipeline)+'</code></div>' : ''}
        \${total ? '<div class="pipeline">'+stepsHtml+'</div>' : ''}
      </div>
    </div>\`;
  }).join('');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const sse = new EventSource('/events');
sse.onmessage = () => {
  if (activeTab === 'runs')    refreshRuns();
  if (activeTab === 'builder') refreshWorkspace();
  if (activeTab === 'epics')   refreshEpics();
};

// Initial load — kick all three so they're ready when user clicks the tab
refreshRuns();
refreshWorkspace();
refreshEpics();
</script>
</body></html>`;
