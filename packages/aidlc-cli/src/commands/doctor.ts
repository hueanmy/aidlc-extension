import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EpicScanner } from '@aidlc/core';
import { readConfig, configPath } from '../cliConfig';

interface Check {
  label: string;
  pass: boolean;
  info?: string;
}

function check(label: string, pass: boolean, info?: string): Check {
  return { label, pass, info };
}

function printChecks(title: string, checks: Check[]): void {
  console.log(chalk.bold(`\n${title}`));
  for (const c of checks) {
    const icon = c.pass ? chalk.green('✔') : chalk.red('✘');
    const detail = c.info ? chalk.dim(`  ${c.info}`) : '';
    console.log(`  ${icon}  ${c.label}${detail}`);
  }
}

export function cmdDoctor(workspaceRoot: string): void {
  const config = readConfig(workspaceRoot);
  const epicsDir = path.resolve(workspaceRoot, config.epicsPath);
  const claudeSettingsPath = path.join(workspaceRoot, '.claude', 'settings.json');

  // ── Workspace ──────────────────────────────────────────────────────────────
  const workspaceChecks: Check[] = [
    check(
      'docs/sdlc/ directory exists',
      fs.existsSync(path.join(workspaceRoot, 'docs', 'sdlc')),
      path.join(workspaceRoot, 'docs', 'sdlc'),
    ),
    check(
      'Epics directory exists',
      fs.existsSync(epicsDir),
      epicsDir,
    ),
    check(
      '.aidlc/config.json readable',
      fs.existsSync(configPath(workspaceRoot)),
      configPath(workspaceRoot),
    ),
  ];

  // ── MCP ────────────────────────────────────────────────────────────────────
  let mcpEntry = false;
  let mcpEntryName = '';
  let claudeSettingsReadable = false;

  if (fs.existsSync(claudeSettingsPath)) {
    claudeSettingsReadable = true;
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
      if (settings.mcpServers && config.serverName in settings.mcpServers) {
        mcpEntry = true;
        mcpEntryName = config.serverName;
      }
    } catch { /* parse error handled below */ }
  }

  const mcpChecks: Check[] = [
    check('.claude/settings.json exists', claudeSettingsReadable, claudeSettingsPath),
    check(
      `MCP server entry "${config.serverName}" present`,
      mcpEntry,
      mcpEntry ? `key: ${mcpEntryName}` : 'run: aidlc init --mcp',
    ),
    check(
      'mcpPackage configured',
      config.mcpPackage.trim().length > 0,
      config.mcpPackage || 'empty — set via: aidlc config set mcpPackage <pkg>',
    ),
  ];

  // ── Runtime ────────────────────────────────────────────────────────────────
  const nodeVersion = process.versions.node;
  const [nodeMajor] = nodeVersion.split('.').map(Number);
  const runtimeChecks: Check[] = [
    check(
      `Node.js >= 18 (found ${nodeVersion})`,
      nodeMajor >= 18,
      nodeMajor < 18 ? 'Upgrade Node.js to v18 or later' : undefined,
    ),
  ];

  // ── Epics ──────────────────────────────────────────────────────────────────
  const epicChecks: Check[] = [];
  let epicCount = 0;

  if (fs.existsSync(epicsDir)) {
    const scanner = new EpicScanner(workspaceRoot, config.epicsPath);
    const epics = scanner.scanAll();
    epicCount = epics.length;

    epicChecks.push(check(
      `${epicCount} epic${epicCount === 1 ? '' : 's'} found`,
      epicCount > 0,
      epicCount === 0 ? 'run: aidlc epic new <KEY> "Title"' : undefined,
    ));

    // Event log integrity
    let logErrors = 0;
    for (const epic of epics) {
      const logFile = path.join(epic.folderPath, '.aidlc', 'events.jsonl');
      if (!fs.existsSync(logFile)) { continue; }
      try {
        const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try { JSON.parse(line); } catch { logErrors++; }
        }
      } catch { logErrors++; }
    }

    if (epicCount > 0) {
      epicChecks.push(check(
        'Event logs parseable',
        logErrors === 0,
        logErrors > 0 ? `${logErrors} corrupted line(s) found` : undefined,
      ));
    }

    // Awaiting review summary
    const awaitingReview = epics.filter(e => e.hasAwaitingReview);
    if (awaitingReview.length > 0) {
      epicChecks.push(check(
        `${awaitingReview.length} epic(s) awaiting human review`,
        false,
        awaitingReview.map(e => e.key).join(', '),
      ));
    }

    const failed = epics.filter(e => e.hasFailure);
    if (failed.length > 0) {
      epicChecks.push(check(
        `${failed.length} epic(s) with agent failure`,
        false,
        failed.map(e => e.key).join(', '),
      ));
    }
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  console.log(chalk.bold('\naidlc doctor'));
  console.log(chalk.dim(`workspace: ${workspaceRoot}\n`));

  printChecks('Workspace', workspaceChecks);
  printChecks('MCP', mcpChecks);
  printChecks('Runtime', runtimeChecks);
  if (epicChecks.length > 0) { printChecks('Epics', epicChecks); }

  // Overall
  const allChecks = [...workspaceChecks, ...mcpChecks, ...runtimeChecks, ...epicChecks];
  const failures = allChecks.filter(c => !c.pass);
  console.log();
  if (failures.length === 0) {
    console.log(chalk.green('✔ All checks passed.'));
  } else {
    console.log(chalk.yellow(`⚠ ${failures.length} check(s) failed.`));
  }
  console.log();
}
