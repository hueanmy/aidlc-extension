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

const RUNS_GLOB     = '.aidlc/runs/*.json';
const WORKSPACE_YML = '.aidlc/workspace.yaml';

export function registerDashboard(program: Command): void {
  program
    .command('dashboard')
    .description('Serve a browser dashboard for runs (live, click-to-approve)')
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

      // Watch state files and broadcast SSE events
      const watcher = chokidar.watch(
        [path.join(root, RUNS_GLOB), path.join(root, WORKSPACE_YML)],
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

const MAX_BODY_BYTES = 64 * 1024;   // 64 KiB — actions are tiny JSON objects

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

// ── HTML UI (single file, no build step) ─────────────────────────────────────

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>aidlc dashboard</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d;
    --text: #c9d1d9; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149; --cyan: #79c0ff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, sans-serif; }
  body { background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 320px; border-right: 1px solid var(--border); overflow-y: auto; flex-shrink: 0; }
  .sidebar h1 { font-size: 13px; padding: 12px 16px; border-bottom: 1px solid var(--border);
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .run-card { padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .run-card:hover { background: rgba(255,255,255,0.04); }
  .run-card.active { background: rgba(88,166,255,0.1); border-left: 2px solid var(--accent); padding-left: 14px; }
  .run-card .id { font-weight: 600; font-size: 14px; }
  .run-card .meta { font-size: 12px; color: var(--muted); margin-top: 4px; display: flex; gap: 8px; align-items: center; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .b-running { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .b-completed { background: rgba(63,185,80,0.2); color: var(--green); }
  .b-failed { background: rgba(248,81,73,0.2); color: var(--red); }
  .progress-bar { height: 4px; background: var(--border); border-radius: 2px; margin-top: 8px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }
  .main { flex: 1; padding: 24px 32px; overflow-y: auto; }
  .empty { color: var(--muted); text-align: center; padding: 80px 0; }
  .header { margin-bottom: 24px; }
  .header h2 { font-size: 24px; }
  .header .ctx { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .pipeline { display: flex; align-items: stretch; gap: 12px; margin: 32px 0; }
  .step { flex: 1; padding: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; min-width: 140px; }
  .step.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .step .num { font-size: 11px; color: var(--muted); }
  .step .agent { font-weight: 600; margin-top: 4px; font-size: 14px; word-break: break-word; }
  .step .status { margin-top: 8px; font-size: 11px; padding: 2px 8px; border-radius: 10px; display: inline-block; }
  .s-pending { background: rgba(139,148,158,0.2); color: var(--muted); }
  .s-awaiting_work { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .s-awaiting_review { background: rgba(121,192,255,0.2); color: var(--cyan); }
  .s-approved { background: rgba(63,185,80,0.2); color: var(--green); }
  .s-rejected { background: rgba(248,81,73,0.2); color: var(--red); }
  .actions { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px; margin-top: 24px; }
  .actions h3 { font-size: 14px; margin-bottom: 12px; }
  .actions button { padding: 8px 16px; margin-right: 8px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--panel); color: var(--text); cursor: pointer;
    font-size: 13px; }
  .actions button:hover { background: rgba(255,255,255,0.05); }
  .actions button.primary { background: var(--accent); color: white; border-color: var(--accent); }
  .actions button.primary:hover { background: #4493e0; }
  .actions button.danger { background: var(--red); color: white; border-color: var(--red); }
  .actions button.danger:hover { background: #d04341; }
  .actions input, .actions textarea { width: 100%; padding: 8px; margin-top: 8px; margin-bottom: 12px;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text);
    font-family: inherit; font-size: 13px; }
  .actions textarea { min-height: 60px; resize: vertical; }
  .reject-reason, .feedback { display: none; }
  .reject-reason.show, .feedback.show { display: block; }
  .live { display: inline-flex; align-items: center; gap: 6px; color: var(--green); font-size: 11px;
    margin-left: 12px; }
  .live::before { content: ''; width: 8px; height: 8px; background: var(--green); border-radius: 50%;
    animation: pulse 2s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .err { color: var(--red); margin-top: 8px; font-size: 12px; }
  pre { background: var(--bg); border: 1px solid var(--border); padding: 8px; border-radius: 4px;
    font-size: 11px; margin-top: 8px; }
</style>
</head><body>

<div class="sidebar">
  <h1>Runs <span class="live">live</span></h1>
  <div id="runs"></div>
</div>

<div class="main" id="main">
  <div class="empty">Pick a run from the left.</div>
</div>

<script>
let activeRunId = null;
let runs = [];

const STATUS_LABEL = {
  pending: 'pending', awaiting_work: 'awaiting work',
  awaiting_review: 'awaiting review', approved: 'approved', rejected: 'rejected',
};

async function fetchRuns() {
  const res = await fetch('/api/runs');
  runs = await res.json();
  renderSidebar();
  if (activeRunId) {
    const cur = runs.find(r => r.runId === activeRunId);
    if (cur) renderMain(cur); else clearMain();
  }
}

function renderSidebar() {
  const el = document.getElementById('runs');
  if (!runs.length) {
    el.innerHTML = '<div class="empty" style="padding:40px 16px;font-size:13px">No runs yet.<br><br>Try:<br><code>aidlc run start &lt;pipelineId&gt;</code></div>';
    return;
  }
  el.innerHTML = runs.map(r => {
    const done = r.steps.filter(s => s.status === 'approved').length;
    const total = r.steps.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const cls = activeRunId === r.runId ? 'run-card active' : 'run-card';
    return \`
      <div class="\${cls}" onclick="select('\${r.runId}')">
        <div class="id">\${esc(r.runId)}</div>
        <div class="meta">
          <span>\${esc(r.pipelineId)}</span>
          <span class="badge b-\${r.status}">\${r.status}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:\${pct}%"></div></div>
      </div>
    \`;
  }).join('');
}

function select(runId) {
  activeRunId = runId;
  renderSidebar();
  const cur = runs.find(r => r.runId === runId);
  if (cur) renderMain(cur);
}

function clearMain() {
  document.getElementById('main').innerHTML = '<div class="empty">Pick a run from the left.</div>';
  activeRunId = null;
}

function renderMain(run) {
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
      <button class="primary" onclick="act('mark-done')">Mark step done</button>
      </div>\`;
  } else if (cur && cur.status === 'awaiting_review') {
    actions = \`<div class="actions"><h3>Current step: <strong>\${esc(cur.agent)}</strong> (awaiting review)</h3>
      <button class="primary" onclick="approveWithComment()">Approve</button>
      <button class="danger" onclick="toggleReject()">Reject</button>
      <div class="reject-reason" id="reject-form">
        <textarea id="reject-reason" placeholder="Why are you rejecting this step?"></textarea>
        <button class="danger" onclick="act('reject', { reason: document.getElementById('reject-reason').value })">Confirm reject</button>
      </div>
      </div>\`;
  } else if (cur && cur.status === 'rejected') {
    actions = \`<div class="actions"><h3>Current step: <strong>\${esc(cur.agent)}</strong> (rejected)</h3>
      \${cur.rejectReason ? '<p style="color:var(--red);font-size:13px;margin:8px 0">"'+esc(cur.rejectReason)+'"</p>' : ''}
      <button class="primary" onclick="toggleRerun()">Rerun with feedback</button>
      <div class="feedback" id="feedback-form">
        <textarea id="feedback-text" placeholder="Notes for the next attempt (optional)"></textarea>
        <button class="primary" onclick="act('rerun', { feedback: document.getElementById('feedback-text').value })">Confirm rerun</button>
      </div>
      </div>\`;
  }

  document.getElementById('main').innerHTML = \`
    <div class="header">
      <h2>\${esc(run.runId)}</h2>
      <div class="ctx">pipeline: \${esc(run.pipelineId)} \${ctx ? '· context: '+esc(ctx) : ''}</div>
    </div>
    <div class="pipeline">\${stepsHtml}</div>
    \${actions}
    <div id="action-result"></div>
  \`;
}

function toggleReject() { document.getElementById('reject-form').classList.toggle('show'); }
function toggleRerun() { document.getElementById('feedback-form').classList.toggle('show'); }

async function approveWithComment() {
  const comment = prompt('Optional approval comment:') ?? '';
  await act('approve', comment ? { comment } : {});
}

async function act(type, extra = {}) {
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
    // Close any open action drawers (reject reason / feedback textarea)
    document.querySelectorAll('.reject-reason.show, .feedback.show').forEach(el => el.classList.remove('show'));
    setTimeout(() => result.innerHTML = '', 2000);
  }
  await fetchRuns();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const sse = new EventSource('/events');
sse.onmessage = () => fetchRuns();

fetchRuns();
</script>
</body></html>`;
