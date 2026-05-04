/**
 * Loads skill markdown content, resolving the `id → string` mapping declared
 * in workspace.yaml. Two sources:
 *
 *   1. **Builtin skills** — bundled with @aidlc/core. Phase 1 ships with no
 *      builtin skills (registry empty); Phase 2+ will populate from a
 *      `skills/builtin/<id>.md` directory inside this package.
 *   2. **Custom skills** — user's local `.md` file referenced by `path`,
 *      resolved relative to the workspace root.
 *
 * Loaded skills are cached per loader instance; call `clear()` to invalidate
 * (e.g. when watching a skill file for changes).
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SkillConfig } from '../schema/WorkspaceSchema';

export class SkillNotFoundError extends Error {
  constructor(public readonly skillId: string, public readonly tried: string[]) {
    super(
      `Skill \`${skillId}\` not found.${tried.length ? ` Tried: ${tried.join(', ')}` : ''}`,
    );
    this.name = 'SkillNotFoundError';
  }
}

export interface SkillLoaderOptions {
  /**
   * Map of builtin skill id → file path (absolute or relative to this package).
   * Phase 1: empty by default. Phase 2+ wires the `@aidlc/core/skills/builtin/*`
   * directory in here at construction time.
   */
  builtins?: Record<string, string>;
}

export class SkillLoader {
  private readonly builtins: Record<string, string>;
  private cache = new Map<string, string>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly skills: SkillConfig[],
    opts: SkillLoaderOptions = {},
  ) {
    this.builtins = opts.builtins ?? {};
  }

  /**
   * Resolve + read a skill by its declared id. Returns the raw markdown
   * string. Cached after first load.
   */
  load(skillId: string): string {
    const cached = this.cache.get(skillId);
    if (cached !== undefined) {
      return cached;
    }

    const decl = this.skills.find((s) => s.id === skillId);
    if (!decl) {
      throw new SkillNotFoundError(skillId, [
        '(no skill declaration with this id in workspace.yaml)',
      ]);
    }

    const tried: string[] = [];
    let content: string | null = null;

    if (decl.builtin) {
      const builtinPath = this.builtins[skillId];
      if (builtinPath) {
        tried.push(builtinPath);
        if (fs.existsSync(builtinPath)) {
          content = fs.readFileSync(builtinPath, 'utf8');
        }
      } else {
        tried.push(`(builtin "${skillId}" — no path registered)`);
      }
    } else if (decl.path) {
      const resolved = path.isAbsolute(decl.path)
        ? decl.path
        : path.resolve(this.workspaceRoot, decl.path);
      tried.push(resolved);
      if (fs.existsSync(resolved)) {
        content = fs.readFileSync(resolved, 'utf8');
      }
    }

    if (content === null) {
      throw new SkillNotFoundError(skillId, tried);
    }

    this.cache.set(skillId, content);
    return content;
  }

  /** Drop cached skill content. Call after a `.md` file changes on disk. */
  clear(skillId?: string): void {
    if (skillId) {
      this.cache.delete(skillId);
    } else {
      this.cache.clear();
    }
  }

  /** True if the loader knows how to resolve this skill (declaration + source). */
  has(skillId: string): boolean {
    const decl = this.skills.find((s) => s.id === skillId);
    if (!decl) { return false; }
    if (decl.builtin) { return !!this.builtins[skillId]; }
    return !!decl.path;
  }
}
