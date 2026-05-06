/**
 * Asset discovery — scans 3 scopes for skills + agents and returns a
 * unified catalog the UI can display.
 *
 *   - aidlc    → `<workspace>/.aidlc/skills/`, `<workspace>/.aidlc/agents/`
 *                Workspace-local AIDLC framework assets. Skills are also
 *                declared in workspace.yaml; agents may or may not be.
 *
 *   - project  → `<workspace>/.claude/skills/`, `<workspace>/.claude/agents/`
 *                Project-local Claude Code native assets. Single `.md` files
 *                or `<id>/SKILL.md` folders. Not declared in workspace.yaml.
 *
 *   - global   → `~/.claude/skills/`, `~/.claude/agents/`
 *                User-level assets shared across all projects on this
 *                machine. Same file conventions as `project`.
 *
 * When an `id` exists in more than one scope, precedence is:
 *
 *     project > aidlc > global
 *
 * The lower-priority entry is still returned in the catalog with
 * `overriddenBy` populated so the UI can render an "overridden" badge.
 *
 * Discovery is cheap (a few directory reads) and synchronous — callers
 * should re-run it on file system changes rather than caching across
 * watcher events.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type AssetScope = 'project' | 'aidlc' | 'global';
export type AssetKind = 'skill' | 'agent';

export interface DiscoveredAsset {
  id: string;
  kind: AssetKind;
  scope: AssetScope;
  /** Absolute path to the .md file (or SKILL.md inside a folder). */
  filePath: string;
  /** True when another higher-priority scope has the same id. */
  overridden: boolean;
  /** When `overridden`, the scope that wins. */
  overriddenBy?: AssetScope;
}

export interface DiscoveryResult {
  skills: DiscoveredAsset[];
  agents: DiscoveredAsset[];
}

/**
 * Order matters — first match in this list wins. Keep aligned with the
 * docstring at the top of the file (project > aidlc > global).
 */
const SCOPE_PRECEDENCE: AssetScope[] = ['project', 'aidlc', 'global'];

interface ScopePaths {
  skills: string;
  agents: string;
}

/**
 * Resolve scope → absolute directory paths. `homeDir` is injectable so
 * tests can pin it; production callers leave it omitted (defaults to
 * `os.homedir()`).
 */
export function scopePaths(
  workspaceRoot: string,
  scope: AssetScope,
  homeDir: string = os.homedir(),
): ScopePaths {
  switch (scope) {
    case 'aidlc':
      return {
        skills: path.join(workspaceRoot, '.aidlc', 'skills'),
        agents: path.join(workspaceRoot, '.aidlc', 'agents'),
      };
    case 'project':
      return {
        skills: path.join(workspaceRoot, '.claude', 'skills'),
        agents: path.join(workspaceRoot, '.claude', 'agents'),
      };
    case 'global':
      return {
        skills: path.join(homeDir, '.claude', 'skills'),
        agents: path.join(homeDir, '.claude', 'agents'),
      };
  }
}

/**
 * Run a full discovery sweep across all 3 scopes.
 *
 * Returns a flat list per kind, with override markers already applied.
 * The list is sorted by id within each scope group; downstream UI is
 * expected to group by scope itself.
 */
export function discoverAssets(
  workspaceRoot: string,
  homeDir: string = os.homedir(),
): DiscoveryResult {
  const skillsByScope = new Map<AssetScope, DiscoveredAsset[]>();
  const agentsByScope = new Map<AssetScope, DiscoveredAsset[]>();

  for (const scope of SCOPE_PRECEDENCE) {
    const paths = scopePaths(workspaceRoot, scope, homeDir);
    skillsByScope.set(scope, scanSkillDir(paths.skills, scope));
    agentsByScope.set(scope, scanAgentDir(paths.agents, scope));
  }

  return {
    skills: applyOverrides(skillsByScope),
    agents: applyOverrides(agentsByScope),
  };
}

/**
 * Walk SCOPE_PRECEDENCE and mark lower-priority entries as overridden by
 * the first higher-priority scope holding the same id. Returns one flat
 * array preserving the SCOPE_PRECEDENCE order — callers can `groupBy`
 * scope without an extra sort.
 */
function applyOverrides(byScope: Map<AssetScope, DiscoveredAsset[]>): DiscoveredAsset[] {
  const winnerByid = new Map<string, AssetScope>();
  for (const scope of SCOPE_PRECEDENCE) {
    for (const asset of byScope.get(scope) ?? []) {
      if (!winnerByid.has(asset.id)) {
        winnerByid.set(asset.id, scope);
      }
    }
  }

  const out: DiscoveredAsset[] = [];
  for (const scope of SCOPE_PRECEDENCE) {
    for (const asset of byScope.get(scope) ?? []) {
      const winner = winnerByid.get(asset.id);
      if (winner && winner !== scope) {
        out.push({ ...asset, overridden: true, overriddenBy: winner });
      } else {
        out.push(asset);
      }
    }
  }
  return out;
}

/**
 * Skills directory layout supports two forms (Claude Code conventions):
 *
 *   1. `<dir>/<id>.md`               — single-file skill
 *   2. `<dir>/<id>/SKILL.md`         — folder skill (preferred for skills
 *      with auxiliary files like scripts/, references/, etc.)
 *
 * Hidden files (`.foo`) and underscore-prefixed (`_shared.md`) are skipped
 * — the latter is a Claude Code convention for reference-only files that
 * skills include, not standalone skills.
 */
function scanSkillDir(dir: string, scope: AssetScope): DiscoveredAsset[] {
  if (!fs.existsSync(dir)) { return []; }
  const out: DiscoveredAsset[] = [];

  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) { continue; }

    const full = path.join(dir, name);
    // statSync (vs lstatSync / Dirent.isDirectory) follows symlinks. The
    // user's `~/.claude/skills/` typically holds *symlinks* into a managed
    // pipeline cache — broken links return undefined here and are skipped,
    // valid links resolve to their target's stats.
    const st = safeStat(full);
    if (!st) { continue; }

    if (st.isDirectory()) {
      const skillFile = path.join(full, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        out.push({
          id: name,
          kind: 'skill',
          scope,
          filePath: skillFile,
          overridden: false,
        });
      }
      continue;
    }

    if (st.isFile() && name.endsWith('.md')) {
      const id = name.slice(0, -'.md'.length);
      out.push({
        id,
        kind: 'skill',
        scope,
        filePath: full,
        overridden: false,
      });
    }
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Agents are always single `.md` files — id derived from filename. */
function scanAgentDir(dir: string, scope: AssetScope): DiscoveredAsset[] {
  if (!fs.existsSync(dir)) { return []; }
  const out: DiscoveredAsset[] = [];

  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) { continue; }
    if (!name.endsWith('.md')) { continue; }

    const full = path.join(dir, name);
    const st = safeStat(full);
    if (!st || !st.isFile()) { continue; }

    out.push({
      id: name.slice(0, -'.md'.length),
      kind: 'agent',
      scope,
      filePath: full,
      overridden: false,
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** statSync that swallows ENOENT / EACCES instead of throwing. Used so
 *  broken symlinks and unreadable entries silently drop out of discovery. */
function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/**
 * Compute the on-disk write target for a brand-new asset. The wizard
 * uses this to decide where to write the user's new file after they've
 * picked a scope.
 *
 * For skill, this returns the single-file form (`<id>.md`). Folder-form
 * skills are not generated by the wizard — users who need them can
 * manually convert later by moving the .md into a folder named after the
 * id and renaming to SKILL.md.
 */
export function targetPath(
  workspaceRoot: string,
  scope: AssetScope,
  kind: AssetKind,
  id: string,
  homeDir: string = os.homedir(),
): string {
  const paths = scopePaths(workspaceRoot, scope, homeDir);
  const dir = kind === 'skill' ? paths.skills : paths.agents;
  return path.join(dir, `${id}.md`);
}
