import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export type McpConfigResult =
  | { status: 'skipped'; reason: string }
  | { status: 'already-exists'; serverName: string }
  | { status: 'written'; serverName: string; command: string; args: string[] };

/**
 * Appends an MCP server entry to .claude/settings.json without replacing
 * an existing entry for the same server name. Other mcpServers and top-level
 * settings are always preserved.
 */
export function ensureMcpConfig(workspaceRoot: string, log: (msg: string) => void): McpConfigResult {
  const config = vscode.workspace.getConfiguration('cfPipeline');
  const autoConfig = config.get<boolean>('autoConfigureMcp', false);
  if (!autoConfig) {
    log('MCP auto-configure disabled');
    return { status: 'skipped', reason: 'auto-configure disabled' };
  }

  const platform = config.get<string>('platform', 'generic');
  const serverName = (config.get<string>('mcpServerName', 'sdlc') || 'sdlc').trim() || 'sdlc';
  const mcpCommand = (config.get<string>('mcpCommand', 'npx') || 'npx').trim() || 'npx';
  const mcpArgs = sanitizeArgs(config.get<unknown>('mcpArgs'));
  const extraEnv = sanitizeEnv(config.get<unknown>('mcpEnv'));
  const mcpPackage = (config.get<string>('mcpPackage', '') || '').trim();

  if (mcpArgs.length === 0 && mcpPackage.length === 0) {
    const reason = 'No MCP package or args configured';
    log(`${reason} — skipping. Set cfPipeline.mcpPackage (or cfPipeline.mcpArgs) to install your own MCP server.`);
    return { status: 'skipped', reason };
  }

  const args = mcpArgs.length > 0 ? mcpArgs : ['-y', mcpPackage];

  const claudeDir = path.join(workspaceRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  let settings: ClaudeSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      log('Failed to parse existing .claude/settings.json, creating new');
    }
  }

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  if (settings.mcpServers[serverName]) {
    log(`MCP server "${serverName}" already configured in .claude/settings.json — leaving untouched (append-only, never replace).`);
    return { status: 'already-exists', serverName };
  }

  settings.mcpServers[serverName] = {
    command: mcpCommand,
    args,
    env: {
      ...extraEnv,
      SDLC_PLATFORM: platform,
    },
  };

  writeSettings(claudeDir, settingsPath, settings);
  log(`MCP appended: ${serverName} -> ${mcpCommand} ${args.join(' ')} (platform: ${platform})`);
  return { status: 'written', serverName, command: mcpCommand, args };
}

function sanitizeArgs(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
}

function sanitizeEnv(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && key.trim().length > 0) {
      output[key.trim()] = value;
    }
  }
  return output;
}

function writeSettings(claudeDir: string, settingsPath: string, settings: ClaudeSettings): void {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
