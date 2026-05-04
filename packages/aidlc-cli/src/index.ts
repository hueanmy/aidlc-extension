#!/usr/bin/env node
import { Command } from 'commander';
import { resolveWorkspace } from './workspace';
import { cmdInit } from './commands/init';
import { cmdList } from './commands/list';
import { cmdStatus } from './commands/status';
import { cmdEpicNew } from './commands/epic';
import { cmdMigrate } from './commands/migrate';
import { cmdReview } from './commands/review';
import { cmdConfigShow, cmdConfigSet } from './commands/config';
import { cmdWatch } from './commands/watch';
import { cmdTail } from './commands/tail';
import { cmdDashboard } from './commands/dashboard';
import { cmdDoctor } from './commands/doctor';
import {
  cmdPhaseSet, cmdPhaseStart, cmdPhaseDone, cmdPhaseReset, cmdPhaseSkip,
} from './commands/phase';

const program = new Command();

program
  .name('aidlc')
  .description('AI-driven SDLC workflow — terminal CLI')
  .version('0.1.0')
  .option('-w, --workspace <path>', 'Workspace root (default: auto-detect via AIDLC_WORKSPACE or docs/sdlc/ walk-up)');

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Scaffold docs/sdlc/epics/ and .aidlc/config.json in the workspace')
  .option('--mcp', 'Also write .claude/settings.json MCP entry (uses config values)')
  .action(async (opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    await cmdInit(ws, opts);
  });

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all epics and their pipeline progress')
  .option('--json', 'Output raw JSON')
  .action((opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdList(ws, opts);
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status <epic>')
  .description('Show phase-by-phase status for a single epic (e.g. ABC-123)')
  .option('--json', 'Output raw JSON')
  .action((epic, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdStatus(ws, epic.toUpperCase(), opts);
  });

// ── epic ──────────────────────────────────────────────────────────────────────
const epicCmd = program
  .command('epic')
  .description('Epic management');

epicCmd
  .command('new <key> <title>')
  .description('Bootstrap a new epic folder from templates (e.g. aidlc epic new ABC-123 "My Feature")')
  .action(async (key: string, title: string, _opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    await cmdEpicNew(ws, key.toUpperCase(), title);
  });

// ── migrate ───────────────────────────────────────────────────────────────────
program
  .command('migrate')
  .description('Run idempotent schema migrations on all epics (e.g. uat → execute-test rename)')
  .action((_opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdMigrate(ws);
  });

// ── review ────────────────────────────────────────────────────────────────────
program
  .command('review <phase> <epic>')
  .description('Approve or reject a phase awaiting human review')
  .option('--approve [comment]', 'Approve the phase with an optional comment')
  .option('--reject <reason>',   'Reject the phase with a required reason (≥ 5 chars)')
  .option('--reject-to <phase>', 'Target phase for the rejection cascade (defaults to immediate upstream)')
  .option('--reviewer <name>',   'Reviewer name (defaults to OS username)')
  .action(async (phase: string, epic: string, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    await cmdReview(ws, phase, epic.toUpperCase(), {
      approve:  opts.approve,
      reject:   opts.reject,
      rejectTo: opts.rejectTo,
      reviewer: opts.reviewer,
    });
  });

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Read or update .aidlc/config.json');

configCmd
  .command('show')
  .description('Print current config')
  .action((_opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdConfigShow(ws);
  });

configCmd
  .command('set <key> <value>')
  .description('Set a config value (e.g. aidlc config set platform mobile)')
  .action((key: string, value: string, _opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdConfigSet(ws, key, value);
  });

// ── phase ─────────────────────────────────────────────────────────────────────
const phaseCmd = program
  .command('phase')
  .description('Directly control a phase status (bypass the review gate)');

phaseCmd
  .command('set <epic> <phase> <status>')
  .description('Set any phase to any valid status')
  .option('--reviewer <name>', 'Actor name (defaults to OS username)')
  .option('--reason <text>',   'Reason recorded in the event log')
  .action((epic: string, phase: string, status: string, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdPhaseSet(ws, epic.toUpperCase(), phase, status, opts);
  });

phaseCmd
  .command('start <epic> <phase>')
  .description('Mark a phase as in_progress')
  .option('--reviewer <name>')
  .action((epic: string, phase: string, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdPhaseStart(ws, epic.toUpperCase(), phase, opts);
  });

phaseCmd
  .command('done <epic> <phase>')
  .description('Mark a phase as passed (bypass approve gate)')
  .option('--reviewer <name>')
  .action((epic: string, phase: string, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdPhaseDone(ws, epic.toUpperCase(), phase, opts);
  });

phaseCmd
  .command('reset <epic> <phase>')
  .description('Reset a phase to pending (no cascade)')
  .option('--reviewer <name>')
  .action((epic: string, phase: string, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdPhaseReset(ws, epic.toUpperCase(), phase, opts);
  });

phaseCmd
  .command('skip <epic> <phase>')
  .description('Mark a phase as passed without running it (jump forward)')
  .option('--reviewer <name>')
  .action((epic: string, phase: string, opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.parent?.opts().workspace);
    cmdPhaseSkip(ws, epic.toUpperCase(), phase, opts);
  });

// ── watch ─────────────────────────────────────────────────────────────────────
program
  .command('watch [epic]')
  .description('Re-render status on every status.json / pipeline.json change')
  .action((epic: string | undefined, _opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdWatch(ws, epic);
  });

// ── tail ──────────────────────────────────────────────────────────────────────
program
  .command('tail [epic]')
  .description('Stream the event log in real time (approve / reject history)')
  .action((epic: string | undefined, _opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdTail(ws, epic);
  });

// ── dashboard ─────────────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Serve the pipeline dashboard in a browser (no VS Code required)')
  .option('-p, --port <number>', 'Port to listen on', '8787')
  .option('--host <host>', 'Host to bind (use 0.0.0.0 to expose on network)', '127.0.0.1')
  .action((opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdDashboard(ws, opts);
  });

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Validate workspace structure, MCP config, and event log integrity')
  .action((_opts, cmd) => {
    const ws = resolveWorkspace(cmd.parent?.opts().workspace);
    cmdDoctor(ws);
  });

program.parse(process.argv);
