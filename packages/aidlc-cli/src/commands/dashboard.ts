import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import chokidar from 'chokidar';
import {
  EpicScanner, approvePhase, rejectPhase, setPhaseStatus,
  PHASE_ID_SET, REJECT_TO,
  type EpicStatus, type PhaseStatus,
} from '@aidlc/core';
import { readConfig } from '../cliConfig';

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function phaseClass(status: string): string {
  if (status === 'done' || status === 'passed') { return 'done'; }
  if (status === 'in_progress' || status === 'in-progress') { return 'active'; }
  if (status === 'awaiting_human_review') { return 'review'; }
  if (status === 'rejected') { return 'rejected'; }
  if (status === 'stale') { return 'stale'; }
  if (status === 'failed_needs_human') { return 'failed'; }
  return 'pending';
}

function phaseIcon(status: string): string {
  if (status === 'done' || status === 'passed') { return '✓'; }
  if (status === 'awaiting_human_review') { return '🔔'; }
  if (status === 'rejected') { return '✕'; }
  if (status === 'stale') { return '!'; }
  if (status === 'failed_needs_human') { return '✕'; }
  return '';
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebarEpic(epic: EpicStatus): string {
  const current = epic.phases[epic.currentPhase];
  const cls = epic.progress === 100 ? 'done' : epic.currentPhase > 0 ? 'active' : 'pending';

  const phaseItems = epic.phases.map(p => {
    const pc = phaseClass(p.status);
    const icon = phaseIcon(p.status) || p.agentEmoji;
    const rejectOpts = REJECT_TO[p.id] ?? [];
    return `
    <div class="sb-phase" data-pc="${pc}"
      data-epic="${esc(epic.key)}" data-phase="${esc(p.id)}"
      data-status="${esc(p.status)}"
      data-reject='${JSON.stringify(rejectOpts)}'
      onclick="openAction('${esc(epic.key)}','${esc(p.id)}',this)">
      <span class="sb-phase-dot ${pc}">${esc(icon)}</span>
      <span class="sb-phase-name">${esc(p.name)}</span>
      <span class="sb-phase-agent">${esc(p.agentEmoji)} ${esc(p.agent)}</span>
    </div>`;
  }).join('');

  return `
  <div class="sb-epic" id="sb-${esc(epic.key)}">
    <div class="sb-epic-row" onclick="toggleSbEpic('${esc(epic.key)}')">
      <span class="sb-epic-dot ${cls}"></span>
      <div class="sb-epic-info">
        <span class="sb-epic-key">${esc(epic.key)}</span>
        <span class="sb-epic-meta">${epic.progress}% — ${esc(current?.name ?? 'Done')}</span>
      </div>
      <span class="sb-chevron">›</span>
    </div>
    <div class="sb-phases" id="sbp-${esc(epic.key)}">${phaseItems}</div>
  </div>`;
}

// ── Main cards ────────────────────────────────────────────────────────────────

function renderPhaseDot(phase: PhaseStatus, index: number, total: number, epicKey: string): string {
  const cls = phaseClass(phase.status);
  const icon = phaseIcon(phase.status) || String(index + 1);
  const connector = index < total - 1
    ? `<div class="connector ${cls === 'done' ? 'connector-done' : ''}"></div>` : '';
  const rejectOpts = REJECT_TO[phase.id] ?? [];
  return `
  <div class="phase-wrap">
    ${connector}
    <div class="phase-dot ${cls}"
      data-epic="${esc(epicKey)}" data-phase="${esc(phase.id)}"
      data-status="${esc(phase.status)}"
      data-reject='${JSON.stringify(rejectOpts)}'
      onclick="openAction('${esc(epicKey)}','${esc(phase.id)}',this)"
      title="${esc(phase.status)}">${esc(icon)}</div>
    <div class="phase-label">${esc(phase.name)}</div>
    <div class="phase-agent">${esc(phase.agentEmoji)}</div>
  </div>`;
}

function renderCard(epic: EpicStatus): string {
  const badge = epic.progress === 100
    ? '<span class="badge badge-done">Complete</span>'
    : epic.progress > 0
      ? `<span class="badge badge-active">${epic.progress}%</span>`
      : '<span class="badge badge-new">New</span>';
  const flags = [
    epic.hasAwaitingReview ? '<span class="flag flag-review">🔔 Review needed</span>' : '',
    epic.hasFailure        ? '<span class="flag flag-fail">🔴 Agent failed</span>' : '',
  ].filter(Boolean).join('');

  return `
  <div class="epic-card" id="card-${esc(epic.key)}">
    <div class="epic-head" onclick="toggleCard('${esc(epic.key)}')">
      <div>
        <div class="epic-title">
          <span class="epic-key">${esc(epic.key)}</span>
          ${epic.title !== epic.key ? `<span class="epic-name"> — ${esc(epic.title)}</span>` : ''}
        </div>
        ${flags ? `<div class="epic-flags">${flags}</div>` : ''}
      </div>
      <div class="epic-head-right">${badge}
        <button class="expand-btn" aria-label="Toggle">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="epic-body" id="body-${esc(epic.key)}">
      <div class="progress-track">
        <div class="progress-fill" style="width:${epic.progress}%"></div>
      </div>
      <div class="pipeline">
        ${epic.phases.map((p, i) => renderPhaseDot(p, i, epic.phases.length, epic.key)).join('')}
      </div>
      <div class="action-drawer" id="ad-${esc(epic.key)}"></div>
    </div>
  </div>`;
}

function renderStats(epics: EpicStatus[]): string {
  const total    = epics.length;
  const complete = epics.filter(e => e.progress === 100).length;
  const active   = epics.filter(e => e.progress > 0 && e.progress < 100).length;
  const pending  = epics.filter(e => e.progress === 0).length;
  return `
  <div class="stats">
    <div class="stat-card"><div class="stat-val">${total}</div><div class="stat-lbl">Total Epics</div></div>
    <div class="stat-card"><div class="stat-val done-c">${complete}</div><div class="stat-lbl">Complete</div></div>
    <div class="stat-card"><div class="stat-val prog-c">${active}</div><div class="stat-lbl">In Progress</div></div>
    <div class="stat-card"><div class="stat-val pend-c">${pending}</div><div class="stat-lbl">Pending</div></div>
  </div>`;
}

// ── Full page ─────────────────────────────────────────────────────────────────

function buildHtml(epics: EpicStatus[], port: number): string {
  const sidebar = epics.map(renderSidebarEpic).join('');
  const cards   = epics.length === 0
    ? '<p class="empty">No epics found. Run <code>aidlc epic new KEY "Title"</code> to create one.</p>'
    : epics.map(renderCard).join('');
  const stats = renderStats(epics);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIDLC Pipeline Dashboard</title>
<style>
  :root {
    --bg:    #07090f;
    --sb:    #0d0f18;
    --card:  rgba(255,255,255,0.04);
    --border:rgba(94,234,212,0.14);
    --text:  rgba(255,255,255,0.92);
    --muted: rgba(255,255,255,0.48);
    --acc:   #5eead4;
    --acc2:  #2dd4bf;
    --done:  #86d4a8;
    --prog:  #e8c872;
    --pend:  rgba(255,255,255,0.22);
    --review:#79c0ff;
    --rej:   #eca4b8;
    --stale: #d29922;
    --shadow:0 20px 60px -20px rgba(0,0,0,0.6),0 2px 8px rgba(0,0,0,0.3);
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;
    background:var(--bg);color:var(--text);display:flex;flex-direction:column;
    -webkit-font-smoothing:antialiased;
  }

  /* ── Topbar ── */
  .topbar{
    display:flex;align-items:center;gap:12px;
    padding:12px 20px;border-bottom:1px solid var(--border);
    background:rgba(7,9,15,0.85);backdrop-filter:blur(20px);
    flex-shrink:0;z-index:10;
  }
  .live-dot{width:8px;height:8px;border-radius:50%;background:#3fb950;
    animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .topbar h1{font-size:14px;font-weight:700;letter-spacing:.01em;
    background:linear-gradient(135deg,var(--acc),var(--acc2));
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .topbar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
  .topbar-right a{font-size:11px;color:var(--muted);text-decoration:none}
  .topbar-right a:hover{color:var(--acc)}

  /* ── Layout ── */
  .layout{display:flex;flex:1;overflow:hidden}

  /* ── Sidebar ── */
  .sidebar{
    width:270px;flex-shrink:0;
    background:var(--sb);border-right:1px solid var(--border);
    overflow-y:auto;padding:12px 0;
  }
  .sidebar::-webkit-scrollbar{width:4px}
  .sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
  .sb-section{
    font-size:10px;font-weight:700;color:var(--muted);
    text-transform:uppercase;letter-spacing:.14em;
    padding:8px 16px 6px;
  }
  .sb-epic{border-bottom:1px solid rgba(255,255,255,0.05)}
  .sb-epic-row{
    display:flex;align-items:center;gap:10px;
    padding:9px 16px;cursor:pointer;
    transition:background .15s;
  }
  .sb-epic-row:hover{background:rgba(255,255,255,0.04)}
  .sb-epic.open>.sb-epic-row{background:rgba(94,234,212,0.06)}
  .sb-epic-dot{
    width:10px;height:10px;border-radius:50%;flex-shrink:0;
    background:var(--pend);border:1px solid rgba(255,255,255,0.2);
  }
  .sb-epic-dot.done{background:var(--done);border-color:var(--done)}
  .sb-epic-dot.active{background:var(--prog);border-color:var(--prog)}
  .sb-epic-dot.review{background:var(--review);border-color:var(--review)}
  .sb-epic-info{flex:1;min-width:0}
  .sb-epic-key{display:block;font-size:12px;font-weight:700;color:var(--acc);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sb-epic-meta{display:block;font-size:10px;color:var(--muted);margin-top:1px}
  .sb-chevron{color:var(--muted);font-size:14px;transition:transform .2s;flex-shrink:0}
  .sb-epic.open>.sb-epic-row .sb-chevron{transform:rotate(90deg)}
  .sb-phases{display:none;padding:4px 0 8px}
  .sb-epic.open .sb-phases{display:block}
  .sb-phase{
    display:flex;align-items:center;gap:8px;
    padding:6px 16px 6px 28px;cursor:pointer;
    transition:background .15s;
  }
  .sb-phase:hover{background:rgba(255,255,255,0.04)}
  .sb-phase.selected{background:rgba(94,234,212,0.08)}
  .sb-phase-dot{
    width:18px;height:18px;border-radius:50%;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
    font-size:9px;font-weight:700;
    background:rgba(255,255,255,0.06);border:1px solid var(--pend);color:var(--muted);
  }
  .sb-phase-dot.done{background:rgba(134,212,168,.18);border-color:var(--done);color:var(--done)}
  .sb-phase-dot.active{background:rgba(232,200,114,.18);border-color:var(--prog);color:var(--prog)}
  .sb-phase-dot.review{background:rgba(121,192,255,.14);border-color:var(--review);color:var(--review)}
  .sb-phase-dot.rejected{background:rgba(236,164,184,.14);border-color:var(--rej);color:var(--rej)}
  .sb-phase-dot.stale{background:rgba(210,153,34,.14);border-color:var(--stale);color:var(--stale)}
  .sb-phase-dot.failed{background:rgba(248,81,73,.14);border-color:#f85149;color:#f85149}
  .sb-phase-name{font-size:11px;color:var(--text);flex:1}
  .sb-phase-agent{font-size:10px;color:var(--muted);white-space:nowrap}

  /* ── Main ── */
  .main{flex:1;overflow-y:auto;padding:20px 24px 40px}
  .main::-webkit-scrollbar{width:5px}
  .main::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}

  /* ── Stats ── */
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
  .stat-card{
    background:var(--card);border:1px solid var(--border);border-radius:16px;
    padding:16px 18px;box-shadow:var(--shadow);
  }
  .stat-val{font-size:30px;font-weight:700;letter-spacing:-.02em;
    background:linear-gradient(135deg,#fff,#c9e8ff);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .done-c{background:linear-gradient(135deg,var(--done),var(--acc)) !important;
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .prog-c{background:linear-gradient(135deg,var(--prog),#eca4b8) !important;
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .pend-c{color:var(--muted) !important;background:none !important}
  .stat-lbl{font-size:10px;color:var(--muted);margin-top:4px;
    text-transform:uppercase;letter-spacing:.1em;font-weight:600}

  .section-title{
    font-size:10px;font-weight:700;color:var(--muted);
    text-transform:uppercase;letter-spacing:.16em;
    margin-bottom:16px;padding-bottom:10px;
    border-bottom:1px solid var(--border);
  }
  .empty{color:var(--muted);text-align:center;padding:40px;font-size:13px}
  .empty code{color:var(--acc);background:rgba(94,234,212,.1);
    border:1px solid rgba(94,234,212,.2);padding:2px 6px;border-radius:4px}

  /* ── Epic card ── */
  .epic-card{
    background:var(--card);border:1px solid var(--border);
    border-radius:18px;margin-bottom:14px;overflow:hidden;
    box-shadow:var(--shadow);transition:box-shadow .25s;
  }
  .epic-card:hover{box-shadow:var(--shadow),0 0 0 1px rgba(94,234,212,.12)}
  .epic-card.collapsed .epic-body{display:none}
  .epic-card.collapsed{margin-bottom:8px}
  .epic-head{
    display:flex;align-items:center;justify-content:space-between;
    padding:16px 20px;cursor:pointer;gap:12px;
  }
  .epic-head:hover{background:rgba(255,255,255,.02)}
  .epic-title{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
  .epic-key{font-size:14px;font-weight:700;
    background:linear-gradient(135deg,var(--acc),var(--acc2));
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .epic-name{font-size:13px;color:var(--muted)}
  .epic-flags{display:flex;gap:8px;margin-top:4px;flex-wrap:wrap}
  .flag{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600}
  .flag-review{background:rgba(121,192,255,.12);color:var(--review);border:1px solid rgba(121,192,255,.25)}
  .flag-fail{background:rgba(248,81,73,.12);color:#f85149;border:1px solid rgba(248,81,73,.25)}
  .epic-head-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
  .badge{font-size:11px;padding:4px 10px;border-radius:999px;font-weight:700;
    border:1px solid rgba(255,255,255,.14)}
  .badge-done{background:rgba(134,212,168,.18);color:var(--done);border-color:rgba(134,212,168,.3)}
  .badge-active{background:rgba(232,200,114,.18);color:var(--prog);border-color:rgba(232,200,114,.3)}
  .badge-new{background:rgba(255,255,255,.06);color:var(--muted)}
  .expand-btn{
    width:24px;height:24px;border-radius:7px;border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.04);color:var(--muted);cursor:pointer;
    display:flex;align-items:center;justify-content:center;transition:all .2s;
  }
  .expand-btn:hover{border-color:rgba(94,234,212,.4);color:var(--acc)}
  .expand-btn svg{width:12px;height:12px;transition:transform .2s}
  .epic-card.collapsed .expand-btn svg{transform:rotate(-90deg)}

  .epic-body{padding:0 20px 18px}
  .progress-track{height:3px;background:rgba(255,255,255,.08);
    border-radius:999px;margin-bottom:18px;overflow:hidden}
  .progress-fill{height:100%;border-radius:999px;
    background:linear-gradient(90deg,var(--acc),var(--acc2),#eca4b8);
    box-shadow:0 0 10px rgba(45,212,191,.5);transition:width .5s}

  /* ── Pipeline ── */
  .pipeline{display:flex;flex-wrap:wrap;row-gap:20px;padding-bottom:4px}
  .phase-wrap{
    display:flex;flex-direction:column;align-items:center;
    flex:1 1 80px;min-width:80px;max-width:140px;position:relative;
  }
  .connector{
    position:absolute;top:16px;left:50%;width:100%;height:2px;z-index:0;
    background:rgba(255,255,255,.08);border-radius:999px;
  }
  .connector-done{
    background:linear-gradient(90deg,var(--done),var(--acc));
    box-shadow:0 0 8px rgba(134,212,168,.3);
  }
  .phase-dot{
    width:32px;height:32px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:700;z-index:1;position:relative;cursor:pointer;
    border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 4px 12px rgba(0,0,0,.3);
    transition:transform .2s,box-shadow .2s;
  }
  .phase-dot:hover{transform:scale(1.12)}
  .phase-dot.done{background:radial-gradient(circle at 30% 25%,#b5e5cc,var(--done) 60%,#5fb889);
    color:#0d2e1e;box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 0 18px rgba(134,212,168,.35),0 4px 12px rgba(0,0,0,.3)}
  .phase-dot.active{background:radial-gradient(circle at 30% 25%,#f2dea0,var(--prog) 60%,#ccac58);
    color:#3a2a08;animation:glow 2.2s ease-in-out infinite}
  .phase-dot.review{background:rgba(121,192,255,.18);color:var(--review);
    border-color:rgba(121,192,255,.45);animation:glow-review 2s ease-in-out infinite}
  .phase-dot.rejected{background:rgba(236,164,184,.18);color:var(--rej);border-color:rgba(236,164,184,.4)}
  .phase-dot.stale{background:rgba(210,153,34,.18);color:var(--stale);
    border-color:rgba(210,153,34,.4);border-style:dashed}
  .phase-dot.failed{background:rgba(248,81,73,.18);color:#f85149;border-color:rgba(248,81,73,.4)}
  .phase-dot.selected{outline:2px solid var(--acc);outline-offset:3px}
  @keyframes glow{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 0 0 0 rgba(232,200,114,.4),0 4px 12px rgba(0,0,0,.3)}
    50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 0 0 10px rgba(232,200,114,0),0 4px 12px rgba(0,0,0,.3)}}
  @keyframes glow-review{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 0 0 0 rgba(121,192,255,.35),0 4px 12px rgba(0,0,0,.3)}
    50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 0 0 10px rgba(121,192,255,0),0 4px 12px rgba(0,0,0,.3)}}
  .phase-label{font-size:9px;font-weight:700;margin-top:7px;text-align:center;
    color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
  .phase-agent{font-size:9px;color:rgba(255,255,255,.3);margin-top:2px}
  .phase-dot.done+.phase-label,.phase-dot.done~.phase-label,
  .phase-wrap .phase-dot.done ~ .phase-label{
    background:linear-gradient(135deg,var(--done),var(--acc));
    -webkit-background-clip:text;background-clip:text;color:transparent}

  /* ── Action drawer ── */
  .action-drawer{
    margin-top:12px;background:rgba(255,255,255,.04);
    border:1px solid var(--border);border-radius:12px;
    padding:16px;display:none;
  }
  .action-drawer.open{display:block}
  .ad-title{font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px}
  .ad-sub{font-size:11px;color:var(--muted);margin-bottom:14px}
  .ad-actions{display:flex;flex-wrap:wrap;gap:8px}
  .ad-btn{
    padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;
    border:1px solid rgba(255,255,255,.14);cursor:pointer;
    background:rgba(255,255,255,.06);color:var(--text);
    transition:all .2s;
  }
  .ad-btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25)}
  .ad-btn:disabled{opacity:.4;cursor:not-allowed}
  .ad-btn.approve{background:rgba(134,212,168,.14);color:var(--done);border-color:rgba(134,212,168,.3)}
  .ad-btn.approve:hover{background:rgba(134,212,168,.25)}
  .ad-btn.reject{background:rgba(236,164,184,.12);color:var(--rej);border-color:rgba(236,164,184,.28)}
  .ad-btn.reject:hover{background:rgba(236,164,184,.22)}
  .ad-btn.start{background:rgba(232,200,114,.12);color:var(--prog);border-color:rgba(232,200,114,.28)}
  .ad-btn.start:hover{background:rgba(232,200,114,.22)}
  .ad-form{margin-top:12px;display:none}
  .ad-form.open{display:block}
  .ad-label{font-size:11px;color:var(--muted);margin-bottom:4px;display:block}
  .ad-input,.ad-select,.ad-textarea{
    width:100%;padding:7px 10px;border-radius:8px;font-size:12px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);
    color:var(--text);font-family:inherit;margin-bottom:10px;
  }
  .ad-select option{background:#1c1d2e;color:#fff}
  .ad-textarea{min-height:60px;resize:vertical}
  .ad-submit{
    padding:7px 18px;border-radius:8px;font-size:12px;font-weight:700;
    border:none;cursor:pointer;transition:all .2s;
  }
  .ad-submit.approve{background:linear-gradient(135deg,#5fb889,var(--acc));color:#0d2e1e}
  .ad-submit.reject{background:linear-gradient(135deg,#d1859a,var(--rej));color:#3a1823}
  .ad-submit.phase{background:linear-gradient(135deg,var(--acc2),var(--acc));color:#0d2e1e}
  .ad-msg{font-size:11px;margin-top:8px;padding:6px 10px;border-radius:6px;display:none}
  .ad-msg.ok{background:rgba(134,212,168,.14);color:var(--done);display:block}
  .ad-msg.err{background:rgba(236,164,184,.14);color:var(--rej);display:block}
</style>
</head>
<body>
<div class="topbar">
  <div class="live-dot" id="liveDot"></div>
  <h1>AIDLC Pipeline Dashboard</h1>
  <div class="topbar-right">
    <a href="/api/epics">JSON API</a>
    <span style="color:var(--muted);font-size:11px">:${port}</span>
  </div>
</div>
<div class="layout">
  <aside class="sidebar">
    <div class="sb-section">SDLC Pipeline</div>
    <div id="sidebarEpics">${sidebar}</div>
  </aside>
  <main class="main">
    <div id="stats">${stats}</div>
    <div class="section-title">Active Epics</div>
    <div id="epics">${cards}</div>
  </main>
</div>

<script>
// ── SSE ──────────────────────────────────────────────────────
const dot = document.getElementById('liveDot');
const src = new EventSource('/events');
src.addEventListener('message', () => {
  fetch('/api/epics').then(r => r.json()).then(data => {
    document.getElementById('sidebarEpics').innerHTML = data.sidebar;
    document.getElementById('stats').innerHTML         = data.stats;
    document.getElementById('epics').innerHTML         = data.cards;
    dot.style.background = '#3fb950';
  }).catch(() => { dot.style.background = '#f85149'; });
});
src.onerror = () => { dot.style.background = '#f85149'; };

// ── Sidebar ───────────────────────────────────────────────────
function toggleSbEpic(key) {
  const el = document.getElementById('sb-' + key);
  el.classList.toggle('open');
}

function scrollToCard(key) {
  const card = document.getElementById('card-' + key);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // ensure card is expanded
    card.classList.remove('collapsed');
  }
}

// ── Epic card collapse ────────────────────────────────────────
function toggleCard(key) {
  document.getElementById('card-' + key).classList.toggle('collapsed');
}

// ── Action drawer ─────────────────────────────────────────────
let activeEl = null;

function openAction(epic, phase, el) {
  // If same dot clicked again, toggle off
  if (activeEl === el) {
    closeAllDrawers();
    activeEl = null;
    return;
  }
  closeAllDrawers();
  activeEl = el;

  // Highlight dot
  el.classList.add('selected');
  // Highlight sidebar phase
  document.querySelectorAll('.sb-phase').forEach(p => p.classList.remove('selected'));
  const sbPhase = document.querySelector(\`.sb-phase[data-epic="\${epic}"][data-phase="\${phase}"]\`);
  if (sbPhase) sbPhase.classList.add('selected');

  const status     = el.dataset.status;
  const rejectOpts = JSON.parse(el.dataset.reject || '[]');
  const drawerId   = 'ad-' + epic;
  const drawer     = document.getElementById(drawerId);
  if (!drawer) return;

  // Scroll sidebar epic open
  const sbEpic = document.getElementById('sb-' + epic);
  if (sbEpic && !sbEpic.classList.contains('open')) sbEpic.classList.add('open');
  // Scroll to card
  scrollToCard(epic);

  const isDone     = status === 'done' || status === 'passed';
  const isActive   = status === 'in_progress' || status === 'in-progress';
  const isReview   = status === 'awaiting_human_review';
  const isRejected = status === 'rejected' || status === 'stale';
  const isPending  = status === 'pending';

  let approveForm = '';
  let rejectForm  = '';

  if (isReview) {
    approveForm = \`
      <div class="ad-form open" id="form-approve-\${epic}-\${phase}">
        <label class="ad-label">Comment (optional)</label>
        <input class="ad-input" id="approve-comment-\${epic}-\${phase}" placeholder="LGTM…">
        <button class="ad-submit approve" onclick="submitAction('\${epic}','\${phase}','approve')">✅ Confirm Approve</button>
        <div class="ad-msg" id="msg-\${epic}-\${phase}"></div>
      </div>\`;

    const rejectOptsHtml = rejectOpts.map(o =>
      \`<option value="\${o}">\${o}</option>\`).join('');
    rejectForm = \`
      <div class="ad-form" id="form-reject-\${epic}-\${phase}">
        <label class="ad-label">Reject to</label>
        <select class="ad-select" id="reject-to-\${epic}-\${phase}">
          <option value="">— pick —</option>
          \${rejectOptsHtml}
        </select>
        <label class="ad-label">Reason (required)</label>
        <textarea class="ad-textarea" id="reject-reason-\${epic}-\${phase}" placeholder="What needs to change upstream?"></textarea>
        <button class="ad-submit reject" onclick="submitAction('\${epic}','\${phase}','reject')">❌ Confirm Reject</button>
        <div class="ad-msg" id="msg-reject-\${epic}-\${phase}"></div>
      </div>\`;
  }

  const btns = [];
  if (isReview) {
    btns.push(\`<button class="ad-btn approve" onclick="toggleForm('form-approve-\${epic}-\${phase}')">✅ Approve</button>\`);
    btns.push(\`<button class="ad-btn reject" onclick="toggleForm('form-reject-\${epic}-\${phase}')">❌ Reject</button>\`);
  }
  if (!isDone && !isActive) {
    btns.push(\`<button class="ad-btn start" onclick="submitAction('\${epic}','\${phase}','start')">▶ Start</button>\`);
  }
  if (!isDone) {
    btns.push(\`<button class="ad-btn" onclick="submitAction('\${epic}','\${phase}','done')">✓ Mark Done</button>\`);
    btns.push(\`<button class="ad-btn" onclick="submitAction('\${epic}','\${phase}','skip')">⤼ Skip</button>\`);
  }
  if (!isPending) {
    btns.push(\`<button class="ad-btn" onclick="submitAction('\${epic}','\${phase}','reset')">↺ Reset</button>\`);
  }

  const statusLabel = status.replace(/_/g,' ');
  drawer.innerHTML = \`
    <div class="ad-title">\${phase.replace(/-/g,' ').replace(/\\b\\w/g,c=>c.toUpperCase())} — <span style="color:var(--muted)">\${statusLabel}</span></div>
    <div class="ad-sub">Epic \${epic} · Click an action below</div>
    <div class="ad-actions">\${btns.join('')}</div>
    \${approveForm}
    \${rejectForm}
    <div class="ad-msg" id="msg-\${epic}-\${phase}"></div>
  \`;
  drawer.classList.add('open');
}

function toggleForm(id) {
  const f = document.getElementById(id);
  if (f) f.classList.toggle('open');
}

function closeAllDrawers() {
  document.querySelectorAll('.action-drawer').forEach(d => {
    d.classList.remove('open');
    d.innerHTML = '';
  });
  document.querySelectorAll('.phase-dot.selected').forEach(d => d.classList.remove('selected'));
  document.querySelectorAll('.sb-phase.selected').forEach(d => d.classList.remove('selected'));
}

// ── Submit action ─────────────────────────────────────────────
async function submitAction(epic, phase, type) {
  const body = { epic, phase, type };

  if (type === 'approve') {
    const inp = document.getElementById(\`approve-comment-\${epic}-\${phase}\`);
    body.comment = inp ? inp.value : '';
  }
  if (type === 'reject') {
    const toEl  = document.getElementById(\`reject-to-\${epic}-\${phase}\`);
    const rnEl  = document.getElementById(\`reject-reason-\${epic}-\${phase}\`);
    body.rejectTo = toEl ? toEl.value : '';
    body.reason   = rnEl ? rnEl.value : '';
    if (!body.rejectTo) { showMsg(\`msg-reject-\${epic}-\${phase}\`, 'Pick a target phase.', true); return; }
    if (!body.reason || body.reason.trim().length < 5) {
      showMsg(\`msg-reject-\${epic}-\${phase}\`, 'Reason must be ≥ 5 chars.', true); return;
    }
  }

  // Disable all buttons in this drawer
  document.querySelectorAll(\`#ad-\${epic} .ad-btn, #ad-\${epic} .ad-submit\`).forEach(b => b.disabled = true);

  try {
    const res  = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const msgId = type === 'reject' ? \`msg-reject-\${epic}-\${phase}\` : \`msg-\${epic}-\${phase}\`;
    if (data.ok) {
      showMsg(msgId, '✔ Done — refreshing…', false);
      activeEl = null;
      // SSE will trigger the refresh; also do it immediately
      setTimeout(() => {
        fetch('/api/epics').then(r => r.json()).then(d => {
          document.getElementById('sidebarEpics').innerHTML = d.sidebar;
          document.getElementById('stats').innerHTML         = d.stats;
          document.getElementById('epics').innerHTML         = d.cards;
        });
      }, 300);
    } else {
      showMsg(msgId, '✘ ' + (data.error || 'Unknown error'), true);
      document.querySelectorAll(\`#ad-\${epic} .ad-btn, #ad-\${epic} .ad-submit\`).forEach(b => b.disabled = false);
    }
  } catch (e) {
    showMsg(\`msg-\${epic}-\${phase}\`, '✘ Network error', true);
    document.querySelectorAll(\`#ad-\${epic} .ad-btn, #ad-\${epic} .ad-submit\`).forEach(b => b.disabled = false);
  }
}

function showMsg(id, text, isErr) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = 'ad-msg ' + (isErr ? 'err' : 'ok');
}
</script>
</body>
</html>`;
}

// ── Action handler ────────────────────────────────────────────────────────────

interface ActionBody {
  epic?: string;
  phase?: string;
  type?: string;
  comment?: string;
  rejectTo?: string;
  reason?: string;
}

function handleAction(
  body: ActionBody,
  workspaceRoot: string,
  epicsPath: string,
): { ok: boolean; error?: string } {
  const { epic, phase, type } = body;
  if (!epic || !phase || !type) { return { ok: false, error: 'Missing epic, phase, or type.' }; }

  // Validate key format (guards against injection into filesystem)
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(epic)) { return { ok: false, error: `Invalid epic key: ${epic}` }; }
  if (!PHASE_ID_SET.has(phase)) { return { ok: false, error: `Unknown phase: ${phase}` }; }

  const epicsDir    = path.resolve(workspaceRoot, epicsPath);
  const epicFolder  = path.join(epicsDir, epic);
  const by          = os.userInfo().username;

  try {
    switch (type) {
      case 'approve':
        approvePhase({ phaseId: phase, epicFolderPath: epicFolder, reviewer: by,
          comment: body.comment, actor: 'cli' });
        break;
      case 'reject': {
        const rejectTo = body.rejectTo ?? '';
        const reason   = body.reason   ?? '';
        if (!PHASE_ID_SET.has(rejectTo)) { return { ok: false, error: `Unknown reject-to: ${rejectTo}` }; }
        if (reason.trim().length < 5)    { return { ok: false, error: 'Reason must be ≥ 5 chars.' }; }
        rejectPhase({ fromPhaseId: phase, rejectTo, epicFolderPath: epicFolder,
          reviewer: by, reason, actor: 'cli' });
        break;
      }
      case 'start': setPhaseStatus({ epicFolderPath: epicFolder, phaseId: phase,
        status: 'in_progress', by, actor: 'cli', reason: 'started from dashboard' }); break;
      case 'done':  setPhaseStatus({ epicFolderPath: epicFolder, phaseId: phase,
        status: 'passed', by, actor: 'cli', reason: 'marked done from dashboard' }); break;
      case 'skip':  setPhaseStatus({ epicFolderPath: epicFolder, phaseId: phase,
        status: 'passed', by, actor: 'cli', reason: 'skipped from dashboard' }); break;
      case 'reset': setPhaseStatus({ epicFolderPath: epicFolder, phaseId: phase,
        status: 'pending', by, actor: 'cli', reason: 'reset from dashboard' }); break;
      default: return { ok: false, error: `Unknown action: ${type}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export function cmdDashboard(
  workspaceRoot: string,
  opts: { port?: string; host?: string },
): void {
  const port   = parseInt(opts.port ?? '8787', 10);
  const host   = opts.host ?? '127.0.0.1';
  const config = readConfig(workspaceRoot);
  const epicsDir = path.resolve(workspaceRoot, config.epicsPath);

  const sseClients = new Set<http.ServerResponse>();

  function pushUpdate() {
    for (const res of Array.from(sseClients)) {
      try { res.write('data: refresh\n\n'); } catch { sseClients.delete(res); }
    }
  }

  const heartbeat = setInterval(() => {
    for (const res of Array.from(sseClients)) {
      try { res.write(': heartbeat\n\n'); } catch { sseClients.delete(res); }
    }
  }, 25_000);

  function getEpics(): EpicStatus[] {
    return new EpicScanner(workspaceRoot, config.epicsPath).scanAll();
  }

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];

    // ── SSE ──
    if (pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ── API: read ──
    if (pathname === '/api/epics') {
      const epics   = getEpics();
      const sidebar = epics.map(renderSidebarEpic).join('');
      const cards   = epics.length === 0
        ? '<p class="empty">No epics found.</p>'
        : epics.map(renderCard).join('');
      const stats = renderStats(epics);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ epics, sidebar, stats, cards }));
      return;
    }

    // ── API: action ──
    if (pathname === '/api/action' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        let parsed: ActionBody = {};
        try { parsed = JSON.parse(body) as ActionBody; } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
          return;
        }
        const result = handleAction(parsed, workspaceRoot, config.epicsPath);
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        if (result.ok) { setTimeout(pushUpdate, 50); }
      });
      return;
    }

    // ── Dashboard HTML ──
    if (pathname === '/') {
      const epics = getEpics();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildHtml(epics, port));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // Watch for file changes
  const watcher = chokidar.watch([
    path.join(epicsDir, '**', 'status.json'),
    path.join(epicsDir, '**', 'pipeline.json'),
    path.join(epicsDir, '**', '.aidlc', 'events.jsonl'),
  ], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 } });

  let debounce: ReturnType<typeof setTimeout> | undefined;
  watcher.on('all', () => {
    clearTimeout(debounce);
    debounce = setTimeout(pushUpdate, 100);
  });

  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(chalk.green('✔') + ' Dashboard at ' + chalk.cyan(url));
    if (host === '0.0.0.0') {
      console.log(chalk.dim('  Exposed on all interfaces.'));
    }
    console.log(chalk.dim('  Live updates via SSE · click phase dots to take action · Ctrl+C to stop.\n'));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    clearInterval(heartbeat);
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`Port ${port} is already in use. Try --port <n>.`));
    } else {
      console.error(chalk.red(`Server error: ${err.message}`));
    }
    process.exit(1);
  });

  process.on('SIGINT', () => {
    clearInterval(heartbeat);
    for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
    sseClients.clear();
    void watcher.close();
    server.close(() => process.exit(0));
  });
}
