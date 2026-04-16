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
  const mcpPackage = config.get<string>('mcpPackage', 'aidlc-pipeline');

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
  const existing = settings.mcpServers['sdlc'];
  if (existing) {
    // Update platform if changed
    if (existing.env?.SDLC_PLATFORM !== platform) {
      existing.env = { ...existing.env, SDLC_PLATFORM: platform };
      writeSettings(claudeDir, settingsPath, settings);
      log(`Updated MCP platform to: ${platform}`);
    } else {
      log('MCP already configured');
    }
    return;
  }

  // Add sdlc MCP server
  settings.mcpServers['sdlc'] = {
    command: 'npx',
    args: ['-y', mcpPackage],
    env: {
      SDLC_PLATFORM: platform,
    },
  };

  writeSettings(claudeDir, settingsPath, settings);
  log(`MCP configured: ${mcpPackage} (platform: ${platform})`);
}

function writeSettings(claudeDir: string, settingsPath: string, settings: ClaudeSettings): void {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
