import * as vscode from 'vscode';
import { ensureMcpConfig, type McpConfigResult } from '@aidlc/core';

export type { McpConfigResult };

/** Reads VS Code settings and delegates to the pure-Node ensureMcpConfig in @aidlc/core. */
export function ensureMcpConfigFromVscode(
  workspaceRoot: string,
  log: (msg: string) => void,
): McpConfigResult {
  const config = vscode.workspace.getConfiguration('cfPipeline');

  const mcpArgs = (() => {
    const raw = config.get<unknown>('mcpArgs');
    if (!Array.isArray(raw)) { return []; }
    return raw.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
  })();

  const mcpEnv = (() => {
    const raw = config.get<unknown>('mcpEnv');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return {}; }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && k.trim()) { out[k.trim()] = v; }
    }
    return out;
  })();

  return ensureMcpConfig({
    workspaceRoot,
    autoConfigureMcp: config.get<boolean>('autoConfigureMcp', false),
    platform:    (config.get<string>('platform', 'generic') || 'generic').trim() || 'generic',
    serverName:  (config.get<string>('mcpServerName', 'sdlc') || 'sdlc').trim() || 'sdlc',
    mcpCommand:  (config.get<string>('mcpCommand', 'npx') || 'npx').trim() || 'npx',
    mcpPackage:  (config.get<string>('mcpPackage', '') || '').trim(),
    mcpArgs,
    mcpEnv,
  }, log);
}
