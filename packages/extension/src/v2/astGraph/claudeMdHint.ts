/**
 * Write a small, idempotent block to `<workspace>/.claude/CLAUDE.md`
 * telling Claude *when* to prefer the `ast-graph` MCP tools over plain
 * grep/read. Without this hint, Claude has the tools available but no
 * reason to reach for them first — which is the whole point of running
 * the scan.
 *
 * The block is delimited by HTML-comment markers so we can replace it
 * cleanly on rescan / version bump without touching the rest of the file.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '<!-- aidlc:ast-graph:start -->';
const MARKER_END = '<!-- aidlc:ast-graph:end -->';

/**
 * Ensure the ast-graph hint block exists in `<folder>/.claude/CLAUDE.md`.
 * Creates the file (and `.claude/` dir) when missing. Replaces the block
 * in-place when found, leaves the rest of the file untouched.
 *
 * Returns the resolved path so callers can surface it in the UI.
 */
export async function ensureClaudeMdHint(folder: vscode.WorkspaceFolder): Promise<string> {
  const dir = path.join(folder.uri.fsPath, '.claude');
  const file = path.join(dir, 'CLAUDE.md');
  await fs.promises.mkdir(dir, { recursive: true });

  const block = buildBlock();
  let body = '';
  try {
    body = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const next = upsertBlock(body, block);
  if (next === body) return file;
  await fs.promises.writeFile(file, next, 'utf8');
  return file;
}

/**
 * Remove the ast-graph block from `<folder>/.claude/CLAUDE.md` if
 * present. Safe to call even if the file doesn't exist.
 */
export async function removeClaudeMdHint(folder: vscode.WorkspaceFolder): Promise<void> {
  const file = path.join(folder.uri.fsPath, '.claude', 'CLAUDE.md');
  let body: string;
  try {
    body = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const stripped = removeBlock(body);
  if (stripped === body) return;
  await fs.promises.writeFile(file, stripped.trimEnd() + (stripped.trimEnd() ? '\n' : ''), 'utf8');
}

function upsertBlock(body: string, block: string): string {
  const start = body.indexOf(MARKER_START);
  const end = body.indexOf(MARKER_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = body.slice(0, start);
    const after = body.slice(end + MARKER_END.length);
    // Drop a stray newline between the existing block and trailing
    // content so we don't bloat the file on every rewrite.
    const tail = after.replace(/^\r?\n/, '');
    return `${before}${block}\n${tail}`;
  }
  // Append — preserve existing content, separate with a blank line.
  const prefix = body.length === 0 ? '' : (body.endsWith('\n') ? body : body + '\n');
  const separator = body.length === 0 ? '' : '\n';
  return `${prefix}${separator}${block}\n`;
}

function removeBlock(body: string): string {
  const start = body.indexOf(MARKER_START);
  const end = body.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end <= start) return body;
  const before = body.slice(0, start).replace(/\n+$/, '');
  const after = body.slice(end + MARKER_END.length).replace(/^\r?\n+/, '');
  if (!before && !after) return '';
  if (!after) return before + '\n';
  if (!before) return after;
  return `${before}\n\n${after}`;
}

function buildBlock(): string {
  // Written *for Claude* — instructive, not descriptive. Kept tight
  // because CLAUDE.md is loaded on every session and we don't want to
  // tax the context budget for marginal hint detail.
  return `${MARKER_START}
## ast-graph (managed by AIDLC extension — do not edit by hand)

This project has a pre-built AST graph at \`.ast-graph/graph.db\`, exposed via the
\`ast-graph\` MCP server (auto-registered by the AIDLC VS Code extension). The
graph stores every function/class/method/import in the codebase plus their
caller→callee edges, so structural questions can be answered without grepping.

**Prefer ast-graph tools over grep/read when the question is structural.** A
single MCP call is typically 10–50 tokens; the equivalent grep+read sweep across
a 500-file repo is 5k–50k.

Reach for ast-graph first for:
- "where is X defined / who calls X / what does X call" → ast-graph \`symbol\`
- "if I change X, what breaks" → ast-graph \`blast-radius\`
- "what does this PR touch structurally" → ast-graph \`changed-symbols\`
- "find unreferenced code" → ast-graph \`dead-code\`
- "list HTTP endpoints" → ast-graph \`routes\`
- "where are the architectural hotspots" → ast-graph \`hotspots\`
- "fuzzy find a symbol by partial name" → ast-graph \`search\`

Keep using grep/read/edit for:
- reading function bodies, comments, docstrings (graph stores skeletons, not source)
- editing or refactoring code
- following intent, naming, or non-AST signals (config files, prose)

If the graph looks stale, ask the user to run \`AIDLC: Rescan AST Graph\`. The
extension also rescans automatically a few seconds after any source file save.
${MARKER_END}`;
}
