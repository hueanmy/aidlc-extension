/**
 * Claude Code token usage monitor — status bar surface.
 *
 * Ports the JSONL reader + cost calculation from
 * https://github.com/emtyty/claude-token-monitor (MIT, monitor.py)
 * to TypeScript so the extension can show today/month spend without
 * shelling out to Python.
 *
 * Reads `~/.claude/projects/<encoded>/*.jsonl`, sums usage from
 * assistant messages, and renders a compact status bar item.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

import { calcCost, type Usage } from './tokenPricing';
import { TokenReportWebview } from './tokenReportWebview';

interface Totals extends Usage {
  cost: number;
  calls: number;
}

interface Snapshot {
  today: Totals;
  month: Totals;
  scannedFiles: number;
  scannedAt: number;
}

function emptyTotals(): Totals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost: 0,
    calls: 0,
  };
}

function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Walk `~/.claude/projects` and aggregate usage for today + this month.
 * Files whose mtime is before the start of the current month are skipped
 * entirely — they cannot contain records for either bucket.
 *
 * Dedupes by (sessionId, message.id) because Claude Code emits one JSONL
 * entry per content block but reuses the same per-call usage total.
 */
async function readSnapshot(): Promise<Snapshot> {
  const root = projectsRoot();
  const today = emptyTotals();
  const month = emptyTotals();
  const snap: Snapshot = { today, month, scannedFiles: 0, scannedAt: Date.now() };

  if (!fs.existsSync(root)) return snap;

  const now = new Date();
  const monthStart = startOfMonth(now).getTime();
  const todayStart = startOfDay(now).getTime();
  const seen = new Set<string>();

  let projectDirs: fs.Dirent[];
  try {
    projectDirs = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return snap;
  }

  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const projectDir = path.join(root, dirent.name);
    let files: string[];
    try {
      files = await fs.promises.readdir(projectDir);
    } catch {
      continue;
    }

    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(projectDir, name);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        continue;
      }
      if (stat.mtimeMs < monthStart) continue;
      snap.scannedFiles++;

      await processFile(file, todayStart, seen, today, month);
    }
  }

  return snap;
}

async function processFile(
  file: string,
  todayStart: number,
  seen: Set<string>,
  today: Totals,
  month: Totals,
): Promise<void> {
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(file, { encoding: 'utf8' });
  } catch {
    return;
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line || line[0] !== '{') continue;

      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== 'assistant') continue;

      const msg = entry.message;
      if (!msg || !msg.usage) continue;

      const sessionId = entry.sessionId || '';
      const msgId = msg.id || '';
      const key = `${sessionId}\0${msgId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(ts)) continue;

      const usage: Usage = {
        input_tokens: Number(msg.usage.input_tokens) || 0,
        output_tokens: Number(msg.usage.output_tokens) || 0,
        cache_read_input_tokens: Number(msg.usage.cache_read_input_tokens) || 0,
        cache_creation_input_tokens: Number(msg.usage.cache_creation_input_tokens) || 0,
      };
      const model = msg.model || 'unknown';
      const cost = calcCost(usage, model);

      addInto(month, usage, cost);
      if (ts >= todayStart) addInto(today, usage, cost);
    }
  } finally {
    rl.close();
    stream.close();
  }
}

function addInto(t: Totals, u: Usage, cost: number): void {
  t.input_tokens += u.input_tokens;
  t.output_tokens += u.output_tokens;
  t.cache_read_input_tokens += u.cache_read_input_tokens;
  t.cache_creation_input_tokens += u.cache_creation_input_tokens;
  t.cost += cost;
  t.calls += 1;
}

function fmtCost(c: number): string {
  if (c >= 100) return `$${c.toFixed(0)}`;
  if (c >= 10) return `$${c.toFixed(1)}`;
  return `$${c.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildTooltip(snap: Snapshot): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  const row = (label: string, t: Totals) =>
    `| **${label}** | ${fmtCost(t.cost)} | ${fmtTokens(t.input_tokens)} | ${fmtTokens(t.output_tokens)} | ${fmtTokens(t.cache_read_input_tokens)} | ${fmtTokens(t.cache_creation_input_tokens)} | ${t.calls} |`;
  md.appendMarkdown('### Claude Code token usage\n\n');
  md.appendMarkdown('| | Cost | In | Out | Cache rd | Cache wr | Calls |\n');
  md.appendMarkdown('|---|---|---|---|---|---|---|\n');
  md.appendMarkdown(row('Today', snap.today) + '\n');
  md.appendMarkdown(row('Month', snap.month) + '\n\n');
  md.appendMarkdown(`_${snap.scannedFiles} log file(s) scanned · click for breakdown_\n\n`);
  md.appendMarkdown('Source: [claude-token-monitor](https://github.com/emtyty/claude-token-monitor)');
  return md;
}

const SHOW_DETAILS_COMMAND = 'aidlc.showTokenUsage';
const REFRESH_COMMAND = 'aidlc.refreshTokenUsage';

export function registerTokenMonitor(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  extensionUri: vscode.Uri,
): void {
  const cfg = () => vscode.workspace.getConfiguration('aidlc.tokenMonitor');
  if (!cfg().get<boolean>('enabled', true)) {
    output.appendLine('Token monitor disabled by setting (aidlc.tokenMonitor.enabled).');
    return;
  }

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '$(graph) …';
  item.tooltip = 'Loading Claude token usage…';
  item.command = SHOW_DETAILS_COMMAND;
  item.show();
  context.subscriptions.push(item);

  let inFlight = false;

  const refresh = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const snap = await readSnapshot();
      item.text = `$(graph) ${fmtCost(snap.today.cost)} today · ${fmtCost(snap.month.cost)} mo`;
      item.tooltip = buildTooltip(snap);
    } catch (err) {
      output.appendLine(`Token monitor refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      item.text = '$(graph) —';
      item.tooltip = 'Token monitor: failed to read ~/.claude/projects';
    } finally {
      inFlight = false;
    }
  };

  void refresh();

  const intervalSec = Math.max(15, cfg().get<number>('refreshSeconds', 60));
  const timer = setInterval(() => { void refresh(); }, intervalSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('aidlc.tokenMonitor')) return;
      // Easiest: prompt the user to reload — interval / enabled changes are rare.
      void vscode.window.showInformationMessage(
        'AIDLC token monitor settings changed. Reload window to apply.',
        'Reload Window',
      ).then((pick) => {
        if (pick === 'Reload Window') {
          void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_DETAILS_COMMAND, () => {
      // Click on the status-bar item opens the full-dashboard report panel
      // (Overview / By Model / Daily / Top Projects / Heatmap / Suggestions).
      // The panel reuses an existing instance if already open.
      TokenReportWebview.show(extensionUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(REFRESH_COMMAND, () => refresh()),
  );

  output.appendLine(`Token monitor enabled (refresh every ${intervalSec}s).`);
}
