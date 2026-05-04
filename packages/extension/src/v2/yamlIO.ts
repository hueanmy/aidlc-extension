/**
 * Read / mutate / write `.aidlc/workspace.yaml`.
 *
 * The wizards (addSkill / addAgent / addPipeline) all need to append items
 * to specific top-level arrays. js-yaml's round-trip is lossy with comments
 * — we accept that here because the file is primarily UI-managed in v2.
 * If the user wants to keep hand-written comments, they should use the file
 * editor + Show Workspace Config to validate, not the wizards.
 *
 * Atomic write: dump to <file>.tmp + rename. Avoids half-written YAML if
 * the process crashes mid-write.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  WORKSPACE_DIR,
  WORKSPACE_FILENAME,
} from '@aidlc/core';

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

export function workspaceYamlPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIR, WORKSPACE_FILENAME);
}

/**
 * Read + parse workspace.yaml as a mutable JS object. Returns null if the
 * file doesn't exist (caller decides whether to scaffold or error).
 */
export function readYaml(workspaceRoot: string): YamlDocument | null {
  const p = workspaceYamlPath(workspaceRoot);
  if (!fs.existsSync(p)) { return null; }
  const text = fs.readFileSync(p, 'utf8');
  const parsed = yaml.load(text) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`workspace.yaml at ${p} did not parse to an object`);
  }
  return normalize(parsed as Record<string, unknown>);
}

/**
 * Ensure top-level arrays exist (empty arrays instead of undefined). Wizards
 * push into these arrays directly; they shouldn't have to null-check first.
 */
function normalize(doc: Record<string, unknown>): YamlDocument {
  return {
    version: typeof doc.version === 'string' ? doc.version : '1.0',
    name: typeof doc.name === 'string' ? doc.name : 'AIDLC Workspace',
    agents: Array.isArray(doc.agents) ? (doc.agents as Array<Record<string, unknown>>) : [],
    skills: Array.isArray(doc.skills) ? (doc.skills as Array<Record<string, unknown>>) : [],
    environment: (doc.environment && typeof doc.environment === 'object'
      ? (doc.environment as Record<string, string>)
      : {}),
    slash_commands: Array.isArray(doc.slash_commands)
      ? (doc.slash_commands as Array<Record<string, unknown>>)
      : [],
    pipelines: Array.isArray(doc.pipelines)
      ? (doc.pipelines as Array<Record<string, unknown>>)
      : [],
    state: (doc.state as Record<string, unknown> | undefined),
    sidebar: (doc.sidebar as Record<string, unknown> | undefined),
    ...doc,
  };
}

/**
 * Atomic write: dump to .tmp + rename. Drops any keys with `undefined` values
 * (js-yaml otherwise emits `null`) to keep the output diff-friendly.
 */
export function writeYaml(workspaceRoot: string, doc: YamlDocument): void {
  const p = workspaceYamlPath(workspaceRoot);
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

/** Read existing IDs in a top-level array, used by wizards for uniqueness check. */
export function existingIds(items: Array<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item.id;
    if (typeof id === 'string') { ids.add(id); }
  }
  return ids;
}
