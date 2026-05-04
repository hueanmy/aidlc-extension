import * as fs from 'fs';
import * as path from 'path';
import { McpConfigInput } from '@aidlc/core';

export interface CliConfig extends Omit<McpConfigInput, 'workspaceRoot'> {
  epicsPath: string;
  templateSourcePath: string;
}

const DEFAULTS: CliConfig = {
  epicsPath: 'docs/sdlc/epics',
  templateSourcePath: '',
  platform: 'generic',
  serverName: 'sdlc',
  mcpCommand: 'npx',
  mcpArgs: [],
  mcpPackage: '',
  mcpEnv: {},
  autoConfigureMcp: false,
};

const ALLOWED_KEYS = new Set(Object.keys(DEFAULTS));

export function configPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.aidlc', 'config.json');
}

export function readConfig(workspaceRoot: string): CliConfig {
  const p = configPath(workspaceRoot);
  if (!fs.existsSync(p)) { return { ...DEFAULTS }; }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return { ...DEFAULTS }; }
    return sanitizeConfig(raw);
  } catch {
    return { ...DEFAULTS };
  }
}

function sanitizeConfig(raw: Record<string, unknown>): CliConfig {
  const def = DEFAULTS as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const incoming = raw[key];
    const expected = def[key];
    if (incoming === undefined) { continue; }
    // Accept only values whose JS type matches the default
    if (Array.isArray(expected)) {
      if (Array.isArray(incoming) && incoming.every(v => typeof v === 'string')) {
        out[key] = incoming;
      }
    } else if (typeof incoming === typeof expected) {
      out[key] = incoming;
    }
    // Mismatched type → silently keep the default
  }
  return out as unknown as CliConfig;
}

export function writeConfig(workspaceRoot: string, config: CliConfig): void {
  const p = configPath(workspaceRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function setConfigValue(workspaceRoot: string, key: string, value: string): void {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`Unknown config key: ${key}. Allowed: ${[...ALLOWED_KEYS].join(', ')}`);
  }
  const config = readConfig(workspaceRoot);
  const raw = config as unknown as Record<string, unknown>;
  const current = raw[key];

  let parsed: unknown = value;
  if (typeof current === 'boolean') { parsed = value === 'true'; }
  else if (Array.isArray(current))  { parsed = value.split(',').map(s => s.trim()).filter(Boolean); }

  raw[key] = parsed;
  writeConfig(workspaceRoot, config);
}
