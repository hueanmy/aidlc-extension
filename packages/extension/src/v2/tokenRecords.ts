/**
 * Per-call record loader for the suggest-engine. Distinct from
 * `tokenMonitor.ts` which only aggregates today/month totals — here we
 * keep one Record per assistant call, including tool names and Read
 * targets, because the suggestion rules need that grain.
 *
 * Ports `iter_records` from
 * https://github.com/emtyty/claude-token-monitor/blob/main/monitor.py
 *
 * Multiple JSONL entries can share `message.id` when an assistant turn has
 * several content blocks; their `usage` block is the per-call total
 * duplicated across blocks. We dedupe by (sessionId, msgId) and accumulate
 * tool-use blocks across entries with the same id.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

import { calcCost, type Usage } from './tokenPricing';

export interface CallRecord {
  /** Encoded project dir name under `~/.claude/projects/` (paths slashed → `-`). */
  project: string;
  sessionId: string;
  /** ISO timestamp from the JSONL entry. */
  timestamp: string;
  /** Model id from `message.model`. */
  model: string;
  usage: Usage;
  /** Calculated USD cost (API-equivalent). */
  cost: number;
  /** `cwd` field — workspace root the session ran against, when present. */
  cwd: string;
  msgId: string;
  /** Tool names invoked in this assistant turn. */
  tools: string[];
  /** `file_path` args passed to the Read tool, when present. */
  readPaths: string[];
}

export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Decode a project dir name back to its filesystem path. Claude Code
 * encodes `/path/to/project` as `-path-to-project` on disk, so we reverse
 * the mapping for human-friendly display.
 */
export function decodeProject(folder: string): string {
  if (folder.startsWith('-')) {
    return folder.replace(/-/g, '/');
  }
  return folder;
}

export function shortenPath(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) { return '~' + p.slice(home.length); }
  return p;
}

interface PartialRecord {
  tools: string[];
  readPaths: string[];
  base: Omit<CallRecord, 'tools' | 'readPaths'> | null;
}

/**
 * Load all assistant-call records from `~/.claude/projects/`. `windowDays`
 * filters by file mtime (cheap pre-filter) — files older than the cutoff
 * are skipped entirely. Pass 0 to scan everything.
 */
export async function loadAllRecords(windowDays = 30): Promise<CallRecord[]> {
  const root = projectsRoot();
  if (!fs.existsSync(root)) { return []; }

  const cutoff = windowDays > 0
    ? Date.now() - windowDays * 24 * 60 * 60 * 1000
    : 0;

  let projectDirs: fs.Dirent[];
  try {
    projectDirs = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const partial = new Map<string, PartialRecord>();

  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) { continue; }
    const projectDir = path.join(root, dirent.name);
    let files: string[];
    try {
      files = await fs.promises.readdir(projectDir);
    } catch {
      continue;
    }

    for (const name of files) {
      if (!name.endsWith('.jsonl')) { continue; }
      const file = path.join(projectDir, name);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        continue;
      }
      if (cutoff > 0 && stat.mtimeMs < cutoff) { continue; }
      await processFile(file, dirent.name, partial, cutoff);
    }
  }

  const out: CallRecord[] = [];
  for (const info of partial.values()) {
    if (info.base === null) { continue; }
    out.push({ ...info.base, tools: info.tools, readPaths: info.readPaths });
  }
  return out;
}

async function processFile(
  file: string,
  project: string,
  partial: Map<string, PartialRecord>,
  cutoff: number,
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
      if (!line || line[0] !== '{') { continue; }
      let entry: RawEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== 'assistant') { continue; }
      const msg = entry.message;
      if (!msg) { continue; }
      const sessionId: string = entry.sessionId ?? '';
      const msgId: string = msg.id ?? '';
      if (cutoff > 0 && entry.timestamp) {
        const ts = Date.parse(entry.timestamp);
        if (Number.isFinite(ts) && ts < cutoff) { continue; }
      }
      const key = `${sessionId}\0${msgId}`;
      let info = partial.get(key);
      if (!info) {
        info = { tools: [], readPaths: [], base: null };
        partial.set(key, info);
      }

      const [tools, readPaths] = extractToolInfo(msg);
      info.tools.push(...tools);
      info.readPaths.push(...readPaths);

      if (info.base === null && msg.usage) {
        const usage: Usage = {
          input_tokens: Number(msg.usage.input_tokens) || 0,
          output_tokens: Number(msg.usage.output_tokens) || 0,
          cache_read_input_tokens: Number(msg.usage.cache_read_input_tokens) || 0,
          cache_creation_input_tokens: Number(msg.usage.cache_creation_input_tokens) || 0,
        };
        const model: string = msg.model ?? 'unknown';
        info.base = {
          project,
          sessionId,
          timestamp: entry.timestamp ?? '',
          model,
          usage,
          cost: calcCost(usage, model),
          cwd: entry.cwd ?? '',
          msgId,
        };
      }
    }
  } finally {
    rl.close();
    stream.close();
  }
}

interface RawEntry {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    content?: unknown;
  };
}

function extractToolInfo(msg: NonNullable<RawEntry['message']>): [string[], string[]] {
  const content = msg.content;
  if (!Array.isArray(content)) { return [[], []]; }
  const tools: string[] = [];
  const paths: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') { continue; }
    const c = block as { type?: string; name?: string; input?: { file_path?: string } };
    if (c.type !== 'tool_use') { continue; }
    const name = c.name ?? '';
    if (name) { tools.push(name); }
    if (name === 'Read' && c.input && typeof c.input.file_path === 'string') {
      paths.push(c.input.file_path);
    }
  }
  return [tools, paths];
}
