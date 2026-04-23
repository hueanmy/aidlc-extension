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
 *
 * @param force If true, overwrites an existing mcpServers.<name> entry even
 *   when one is already present. Used when the user explicitly changes MCP
 *   settings via the Settings Panel UI.
 */
export function ensureMcpConfig(workspaceRoot: string, log: (msg: string) => void, force = false): void {
  const config = vscode.workspace.getConfiguration('cfPipeline');
  const autoConfig = config.get<boolean>('autoConfigureMcp', true);
  if (!autoConfig && !force) {
    log('MCP auto-configure disabled');
    return;
  }

  const platform = config.get<string>('platform', 'generic');
  const serverName = (config.get<string>('mcpServerName', 'sdlc') || 'sdlc').trim() || 'sdlc';
  const mcpCommand = (config.get<string>('mcpCommand', 'npx') || 'npx').trim() || 'npx';
  const mcpArgs = sanitizeArgs(config.get<unknown>('mcpArgs'));
  const extraEnv = sanitizeEnv(config.get<unknown>('mcpEnv'));
  const mcpPackage = (config.get<string>('mcpPackage', '') || '').trim();

  if (mcpArgs.length === 0 && mcpPackage.length === 0) {
    log('No MCP package or args configured — skipping auto-configure. Set cfPipeline.mcpPackage (or cfPipeline.mcpArgs) to install your own MCP server.');
    return;
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

  if (settings.mcpServers[serverName] && !force) {
    log(`MCP server "${serverName}" already configured, leaving as-is (pass force=true to overwrite)`);
    return;
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
  log(`MCP configured: ${serverName} -> ${mcpCommand} ${args.join(' ')} (platform: ${platform})${force ? ' [forced]' : ''}`);
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
