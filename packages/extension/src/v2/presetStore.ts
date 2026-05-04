/**
 * Workspace preset library.
 *
 * Captures a snapshot of `.aidlc/workspace.yaml` + every referenced skill
 * `.md` file into a single JSON document, so the user can save what they
 * built in project A and re-apply it to project B without re-doing the
 * wizard flow. The skill markdown is inlined (not just the file path) so
 * presets stay self-contained — moving across machines / project layouts
 * doesn't break references.
 *
 * Storage layout (since 0.8.x):
 *   - User-saved templates live **inside the project** at
 *     `<workspaceRoot>/.aidlc/templates/<id>.json` so they travel with
 *     the repo and the team can share via git.
 *   - Built-in templates ship with the extension (e.g. SDLC Pipeline) and
 *     are loaded via the `builtinLoader` callback at list time.
 *
 * Earlier versions wrote user presets into VS Code globalStorage. Anyone
 * upgrading will simply not see those legacy machine-scoped presets in
 * the picker — they can re-save from a project once. We don't auto-
 * migrate to keep the flow predictable.
 *
 * Format is intentionally NOT versioned beyond a `formatVersion: 1`
 * marker. v0.8 only writes/reads format 1. Future schema changes will
 * either be additive (forward-compat) or shipped under format 2 with a
 * one-shot migration in this file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import type { YamlDocument } from './yamlIO';

export interface WorkspacePreset {
  formatVersion: 1;
  id: string;
  name: string;
  description: string;
  savedAt: string;
  /** workspace.yaml content (without `name` — caller picks one when applying). */
  workspace: Omit<YamlDocument, 'name'>;
  /** Skill markdown content keyed by skill id. Skills with `builtin: true` are excluded. */
  skillContents: Record<string, string>;
  /** True for presets shipped with the extension. User can apply but not delete. */
  builtin?: boolean;
}

export class PresetStore {
  private builtinLoader: (() => WorkspacePreset[]) | null = null;

  /**
   * Wire built-in preset loading. Called once at activation by the host so
   * the store can lazily compose built-ins on each `list()`. Built-ins are
   * read fresh every list call — they're cheap (templates/ files on disk)
   * and this avoids stale caches if the extension hot-reloads.
   */
  setBuiltinLoader(loader: () => WorkspacePreset[]): void {
    this.builtinLoader = loader;
  }

  /** Resolve the project's user-template directory. */
  private projectDir(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.aidlc', 'templates');
  }

  /**
   * List all available templates (built-in + project-scoped user
   * templates). Built-ins come first; user templates sorted by savedAt desc.
   */
  list(workspaceRoot: string | null): WorkspacePreset[] {
    const builtins: WorkspacePreset[] = (() => {
      if (!this.builtinLoader) { return []; }
      try { return this.builtinLoader(); } catch { return []; }
    })();

    const userPresets: WorkspacePreset[] = [];
    if (workspaceRoot) {
      const dir = this.projectDir(workspaceRoot);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.formatVersion === 1 && typeof parsed.id === 'string') {
              userPresets.push(parsed as WorkspacePreset);
            }
          } catch { /* skip corrupt presets — surface as warning when user clicks */ }
        }
      }
    }

    userPresets.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return [...builtins, ...userPresets];
  }

  get(workspaceRoot: string, id: string): WorkspacePreset | null {
    const p = path.join(this.projectDir(workspaceRoot), `${this.sanitize(id)}.json`);
    if (!fs.existsSync(p)) { return null; }
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as WorkspacePreset;
    } catch { return null; }
  }

  save(workspaceRoot: string, preset: WorkspacePreset): void {
    const dir = this.projectDir(workspaceRoot);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${this.sanitize(preset.id)}.json`);
    fs.writeFileSync(p, JSON.stringify(preset, null, 2), 'utf8');
  }

  delete(workspaceRoot: string, id: string): void {
    const p = path.join(this.projectDir(workspaceRoot), `${this.sanitize(id)}.json`);
    if (fs.existsSync(p)) { fs.unlinkSync(p); }
  }

  /**
   * Build a preset from a project's current workspace.yaml + on-disk skill
   * files. Inlines skill .md content; skills declared as `builtin: true`
   * keep that flag (no content captured).
   */
  static buildFromWorkspace(
    workspaceRoot: string,
    doc: YamlDocument,
    meta: { id: string; name: string; description: string },
  ): WorkspacePreset {
    const skillContents: Record<string, string> = {};
    for (const skill of doc.skills) {
      const id = String(skill.id);
      if (skill.builtin) { continue; }
      const skillPath = typeof skill.path === 'string' ? skill.path : null;
      if (!skillPath) { continue; }
      const abs = path.isAbsolute(skillPath)
        ? skillPath
        : path.resolve(workspaceRoot, skillPath);
      if (fs.existsSync(abs)) {
        skillContents[id] = fs.readFileSync(abs, 'utf8');
      }
    }

    // Strip `name` so applyTo can use the target project's name. Keep
    // everything else verbatim.
    const { name: _name, ...rest } = doc;
    return {
      formatVersion: 1,
      id: meta.id,
      name: meta.name,
      description: meta.description,
      savedAt: new Date().toISOString(),
      workspace: rest,
      skillContents,
    };
  }

  /**
   * Apply a preset to a workspace root. Writes:
   *   <root>/.aidlc/workspace.yaml          (preset.workspace + caller's name)
   *   <root>/.aidlc/skills/<id>.md          (one per inlined skill)
   *
   * Existing files are NOT overwritten unless `overwrite: true`. The caller
   * is expected to confirm with the user before passing that flag.
   */
  static applyTo(
    workspaceRoot: string,
    preset: WorkspacePreset,
    workspaceName: string,
    options: { overwrite?: boolean } = {},
  ): { written: string[]; skipped: string[] } {
    const aidlcDir = path.join(workspaceRoot, '.aidlc');
    const skillsDir = path.join(aidlcDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const written: string[] = [];
    const skipped: string[] = [];

    // 1. Write workspace.yaml
    const workspaceFile = path.join(aidlcDir, 'workspace.yaml');
    if (fs.existsSync(workspaceFile) && !options.overwrite) {
      skipped.push(workspaceFile);
    } else {
      const doc = { name: workspaceName, ...preset.workspace };
      const text = yaml.dump(doc, {
        lineWidth: 120,
        quotingType: '"',
        forceQuotes: false,
        noRefs: true,
      });
      fs.writeFileSync(workspaceFile, text, 'utf8');
      written.push(workspaceFile);
    }

    // 2. Write each skill .md (rewriting paths to a canonical location).
    const skills = (preset.workspace.skills as Array<Record<string, unknown>>) ?? [];
    for (const skill of skills) {
      const id = String(skill.id);
      const content = preset.skillContents[id];
      if (!content) { continue; }
      const skillFile = path.join(skillsDir, `${id}.md`);
      if (fs.existsSync(skillFile) && !options.overwrite) {
        skipped.push(skillFile);
      } else {
        fs.writeFileSync(skillFile, content, 'utf8');
        written.push(skillFile);
      }
    }

    return { written, skipped };
  }

  /** Filesystem-safe id. Lowercase + replace any non-[a-z0-9-] with `-`. */
  private sanitize(id: string): string {
    return id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  }
}
