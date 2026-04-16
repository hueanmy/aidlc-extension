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

/**
 * Ensures .claude/settings.json has the SDLC MCP server configured.
 * Creates or updates the config without overwriting other settings.
 */
export function ensureMcpConfig(workspaceRoot: string, log: (msg: string) => void): void {
  const config = vscode.workspace.getConfiguration('cfPipeline');
  const autoConfig = config.get<boolean>('autoConfigureMcp', true);
  if (!autoConfig) {
    log('MCP auto-configure disabled');
    return;
  }

  const platform = config.get<string>('platform', 'mobile');
  const serverName = (config.get<string>('mcpServerName', 'sdlc') || 'sdlc').trim() || 'sdlc';
  const mcpCommand = (config.get<string>('mcpCommand', 'npx') || 'npx').trim() || 'npx';
  const mcpArgs = sanitizeArgs(config.get<unknown>('mcpArgs'));
  const extraEnv = sanitizeEnv(config.get<unknown>('mcpEnv'));
  const mcpPackage = config.get<string>('mcpPackage', 'aidlc-pipeline');
  const args = mcpArgs.length > 0 ? mcpArgs : ['-y', mcpPackage];

  const claudeDir = path.join(workspaceRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  // Read existing settings or start fresh
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

  // Check if sdlc server already configured
  const existing = settings.mcpServers[serverName];
  if (existing) {
    const nextEnv = { ...(existing.env || {}), ...extraEnv, SDLC_PLATFORM: platform };
    const shouldUpdateEnv = JSON.stringify(existing.env || {}) !== JSON.stringify(nextEnv);
    const shouldUpdateCommand = existing.command !== mcpCommand;
    const shouldUpdateArgs = JSON.stringify(existing.args || []) !== JSON.stringify(args);

    if (shouldUpdateEnv || shouldUpdateCommand || shouldUpdateArgs) {
      existing.command = mcpCommand;
      existing.args = args;
      existing.env = nextEnv;
      writeSettings(claudeDir, settingsPath, settings);
      log(`Updated MCP server "${serverName}"`);
    } else {
      log('MCP already configured');
    }
    return;
  }

  // Add MCP server
  settings.mcpServers[serverName] = {
    command: mcpCommand,
    args,
    env: {
      ...extraEnv,
      SDLC_PLATFORM: platform,
    },
  };

  writeSettings(claudeDir, settingsPath, settings);
  log(`MCP configured: ${serverName} -> ${mcpCommand} ${args.join(' ')} (platform: ${platform})`);
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
