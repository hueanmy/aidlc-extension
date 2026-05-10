/**
 * Discover the MCP servers Claude is currently connected to by spawning
 * `claude mcp list` and parsing stdout. The CLI runs a health check, so
 * the call can take several seconds — callers should treat it as async
 * and show a loading state while waiting.
 *
 * Output format is line-oriented and unstable in detail; we parse what we
 * can and fall back to a raw `unknown` status for lines that don't match.
 *
 *   claude.ai Audible: https://mcp.audible.com/mcp - ✓ Connected
 *   claude.ai Spotify: https://… - ✗ Failed to connect
 *   atlassian: https://mcp.atlassian.com/v1/sse (HTTP) - ! Needs authentication
 */
import { execFile } from 'child_process';

export type McpStatus = 'connected' | 'needs_auth' | 'failed' | 'unknown';

export interface McpServerInfo {
  name: string;
  /** URL for HTTP/SSE servers, command line for stdio. May be empty if parsing failed. */
  endpoint: string;
  /** Transport hint when the CLI prints one (e.g. "HTTP"). Empty otherwise. */
  transport: string;
  status: McpStatus;
  /** Verbatim status text from the CLI ("Connected", "Needs authentication"…). */
  statusText: string;
}

export interface McpListResult {
  servers: McpServerInfo[];
  /** Non-null when the spawn itself failed (claude not on PATH, timeout, etc.). */
  error: string | null;
}

const LIST_TIMEOUT_MS = 20_000;

const LINE_RE = /^(.+?):\s+(\S+)(?:\s+\(([^)]+)\))?\s+-\s+(.+)$/;

export async function loadMcpServers(claudeBin = 'claude'): Promise<McpListResult> {
  return new Promise((resolve) => {
    execFile(
      claudeBin,
      ['mcp', 'list'],
      { timeout: LIST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            resolve({ servers: [], error: `\`${claudeBin}\` not found on PATH` });
            return;
          }
          if (code === 'ETIMEDOUT') {
            resolve({
              servers: parseMcpListOutput(stdout || ''),
              error: 'claude mcp list timed out (>20s)',
            });
            return;
          }
          resolve({
            servers: parseMcpListOutput(stdout || ''),
            error: stderr.trim() || err.message,
          });
          return;
        }
        resolve({ servers: parseMcpListOutput(stdout), error: null });
      },
    );
  });
}

export function parseMcpListOutput(stdout: string): McpServerInfo[] {
  const out: McpServerInfo[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { continue; }
    if (line.startsWith('Checking MCP server health')) { continue; }
    if (line.startsWith('No MCP servers')) { continue; }
    const m = LINE_RE.exec(line);
    if (!m) { continue; }
    const [, name, endpoint, transport, statusText] = m;
    out.push({
      name: name.trim(),
      endpoint: endpoint.trim(),
      transport: (transport ?? '').trim(),
      status: classifyStatus(statusText),
      statusText: statusText.trim(),
    });
  }
  return out;
}

function classifyStatus(text: string): McpStatus {
  const t = text.toLowerCase();
  if (t.includes('connected') && !t.includes('failed')) { return 'connected'; }
  if (t.includes('authentication') || t.includes('auth ')) { return 'needs_auth'; }
  if (t.includes('failed')) { return 'failed'; }
  return 'unknown';
}
