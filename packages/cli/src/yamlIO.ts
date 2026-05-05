/**
 * CLI-side YAML I/O for `.aidlc/workspace.yaml`.
 * Ported from packages/extension/src/v2/yamlIO.ts — zero vscode dependency.
 * Atomic write: dump to <file>.tmp + rename.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { WORKSPACE_DIR, WORKSPACE_FILENAME } from '@aidlc/core';

export interface YamlDocument {
  version: string;
  name: string;
  agents: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  environment: Record<string, string>;
  slash_commands: Array<Record<string, unknown>>;
  pipelines: Array<Record<string, unknown>>;
  state?: Record<string, unknown>;
  sidebar?: Record<string, unknown>;
  [key: string]: unknown;
}

export function workspaceYamlPath(root: string): string {
  return path.join(root, WORKSPACE_DIR, WORKSPACE_FILENAME);
}

export function readYaml(root: string): YamlDocument | null {
  const p = workspaceYamlPath(root);
  if (!fs.existsSync(p)) { return null; }
  const text = fs.readFileSync(p, 'utf8');
  const parsed = yaml.load(text) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`workspace.yaml at ${p} did not parse to an object`);
  }
  return normalize(parsed);
}

function normalize(doc: Record<string, unknown>): YamlDocument {
  // Spread raw doc first so extra unknown keys are preserved, then
  // override with type-checked + defaulted versions of known fields.
  return {
    ...doc,
    version:       typeof doc.version === 'string' ? doc.version : '1.0',
    name:          typeof doc.name    === 'string' ? doc.name    : 'AIDLC Workspace',
    agents:        Array.isArray(doc.agents)        ? (doc.agents        as Array<Record<string, unknown>>) : [],
    skills:        Array.isArray(doc.skills)        ? (doc.skills        as Array<Record<string, unknown>>) : [],
    environment:   (doc.environment && typeof doc.environment === 'object'
      ? (doc.environment as Record<string, string>) : {}),
    slash_commands: Array.isArray(doc.slash_commands)
      ? (doc.slash_commands as Array<Record<string, unknown>>) : [],
    pipelines:     Array.isArray(doc.pipelines)     ? (doc.pipelines     as Array<Record<string, unknown>>) : [],
    state:         doc.state   as Record<string, unknown> | undefined,
    sidebar:       doc.sidebar as Record<string, unknown> | undefined,
  };
}

export function writeYaml(root: string, doc: YamlDocument): void {
  const p = workspaceYamlPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v !== undefined) { cleaned[k] = v; }
  }

  const text = yaml.dump(cleaned, {
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
  });

  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, p);
}

export function existingIds(items: Array<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (typeof item.id === 'string') { ids.add(item.id); }
  }
  return ids;
}

/** Load workspace or exit with a clear error. */
export function requireYaml(root: string): YamlDocument {
  const doc = readYaml(root);
  if (!doc) {
    console.error(`No .aidlc/workspace.yaml found at ${root}. Run: aidlc init`);
    process.exit(1);
  }
  return doc;
}
