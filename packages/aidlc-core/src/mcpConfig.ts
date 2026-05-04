import * as fs from 'fs';
import * as path from 'path';

export interface McpConfigInput {
  workspaceRoot: string;
  platform: string;
  serverName: string;
  mcpCommand: string;
  /** Explicit args list. When empty, falls back to ['-y', mcpPackage]. */
  mcpArgs: string[];
  mcpPackage: string;
  mcpEnv: Record<string, string>;
  autoConfigureMcp: boolean;
}

export type McpConfigResult =
  | { status: 'skipped'; reason: string }
  | { status: 'already-exists'; serverName: string }
  | { status: 'written'; serverName: string; command: string; args: string[] };

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/**
 * Pure-Node version of ensureMcpConfig — no VSCode dependency.
 * Appends an MCP server entry to .claude/settings.json (append-only, never
 * overwrites an existing entry with the same server name).
 */
export function ensureMcpConfig(
  input: McpConfigInput,
  log: (msg: string) => void,
): McpConfigResult {
  if (!input.autoConfigureMcp) {
    log('MCP auto-configure disabled');
    return { status: 'skipped', reason: 'auto-configure disabled' };
  }

  const { workspaceRoot, platform, serverName, mcpCommand, mcpEnv, mcpPackage } = input;
  const mcpArgs = input.mcpArgs.filter(Boolean);

  if (mcpArgs.length === 0 && mcpPackage.trim().length === 0) {
    const reason = 'No MCP package or args configured';
    log(`${reason} — skipping.`);
    return { status: 'skipped', reason };
  }

  const args = mcpArgs.length > 0 ? mcpArgs : ['-y', mcpPackage.trim()];

  const claudeDir   = path.join(workspaceRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  let settings: ClaudeSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    } catch {
      log('Failed to parse existing .claude/settings.json — creating fresh');
    }
  }

  if (!settings.mcpServers) { settings.mcpServers = {}; }

  if (settings.mcpServers[serverName]) {
    log(`MCP server "${serverName}" already in .claude/settings.json — leaving untouched.`);
    return { status: 'already-exists', serverName };
  }

  settings.mcpServers[serverName] = {
    command: mcpCommand,
    args,
    env: { ...mcpEnv, SDLC_PLATFORM: platform },
  };

  if (!fs.existsSync(claudeDir)) { fs.mkdirSync(claudeDir, { recursive: true }); }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  log(`MCP appended: ${serverName} → ${mcpCommand} ${args.join(' ')} (platform: ${platform})`);
  return { status: 'written', serverName, command: mcpCommand, args };
}

/** Scaffold a new epic folder from templates. */
export function createEpicFolder(
  workspaceRoot: string,
  epicsPath: string,
  epicKey: string,
  title: string,
  templateRoot: string,
  log: (msg: string) => void,
): void {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(epicKey)) {
    throw new Error(`Invalid epic key: ${epicKey}`);
  }
  const epicsDir = path.resolve(workspaceRoot, epicsPath);
  const epicDir  = path.join(epicsDir, epicKey);
  if (fs.existsSync(epicDir)) {
    throw new Error(`Epic folder already exists: ${epicDir}`);
  }
  fs.mkdirSync(epicDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const epicDoc = `# ${epicKey} — ${title}\n\nCreated: ${today}\n`;
  fs.writeFileSync(path.join(epicDir, `${epicKey}.md`), epicDoc, 'utf8');

  const DEFAULT_PHASES = [
    'plan', 'design', 'test-plan', 'implement', 'review',
    'execute-test', 'release', 'monitor', 'doc-sync',
  ];
  fs.writeFileSync(
    path.join(epicDir, 'pipeline.json'),
    JSON.stringify({ enabledPhases: DEFAULT_PHASES }, null, 2) + '\n',
    'utf8',
  );

  const templateMap: Array<{ source: string; target: string }> = [
    { source: 'PRD-TEMPLATE.md',              target: 'PRD.md' },
    { source: 'TECH-DESIGN-TEMPLATE.md',      target: 'TECH-DESIGN.md' },
    { source: 'TEST-PLAN-TEMPLATE.md',        target: 'TEST-PLAN.md' },
    { source: 'APPROVAL-CHECKLIST-TEMPLATE.md', target: 'APPROVAL.md' },
  ];
  for (const { source, target } of templateMap) {
    const src = path.join(templateRoot, source);
    if (fs.existsSync(src)) {
      const rendered = fs.readFileSync(src, 'utf8')
        .replaceAll('EPIC-XXXX', epicKey)
        .replaceAll('[Epic Title]', title)
        .replaceAll('[Feature Title]', title)
        .replaceAll('YYYY-MM-DD', today);
      fs.writeFileSync(path.join(epicDir, target), rendered, 'utf8');
    }
  }

  log(`Created epic: ${epicKey} (${epicDir})`);
}
