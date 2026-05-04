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

program.parse(process.argv);
