/**
 * Top-level workspace loader. Find → parse → validate → resolve → cache.
 *
 * Usage from the extension layer:
 *   const ws = await WorkspaceLoader.load(workspaceRoot);
 *   const env = ws.envResolver.resolveLayered(ws.config.environment, agent.env);
 *   const skill = ws.skills.load(agent.skill);
 *   const runner = ws.runners.resolve(agent);
 *   await runner.run({ skill, env, args, workspaceRoot, onOutput, onError, claude: null });
 *
 * Throws on any structural problem (missing file, bad YAML, schema fail) so
 * the caller can surface a single error to the user instead of stitching
 * together half-loaded state.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  validateWorkspace,
  WorkspaceConfig,
  WorkspaceValidationError,
} from '../schema/WorkspaceSchema';
import { EnvResolver } from './EnvResolver';
import { SkillLoader } from './SkillLoader';
import { RunnerRegistry } from '../runner/RunnerRegistry';

export const WORKSPACE_FILENAME = 'workspace.yaml';
export const WORKSPACE_DIR = '.aidlc';

export class WorkspaceNotFoundError extends Error {
  constructor(public readonly workspaceRoot: string) {
    super(`No \`.aidlc/${WORKSPACE_FILENAME}\` found under ${workspaceRoot}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class WorkspaceParseError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`[workspace ${path}] ${message}`);
    this.name = 'WorkspaceParseError';
  }
}

export interface LoadedWorkspace {
  /** Validated config object. */
  config: WorkspaceConfig;
  /** Absolute path to the workspace.yaml file. */
  configPath: string;
  /** Workspace root (the directory that contains .aidlc/). */
  root: string;
  /** Env resolver pre-wired to the OS environment. */
  envResolver: EnvResolver;
  /** Skill loader pre-wired to this workspace's skill list. */
  skills: SkillLoader;
  /** Runner registry pre-wired to this workspace root. */
  runners: RunnerRegistry;
}

export interface WorkspaceLoaderOptions {
  /** Override the OS env passed to EnvResolver. Defaults to process.env. */
  osEnv?: NodeJS.ProcessEnv;
  /** Override builtin skill paths. See SkillLoader. */
  builtins?: Record<string, string>;
  /**
   * What to do when `${env:VAR}` references an unset OS var.
   * Defaults to 'empty' (matches shell). Use 'throw' for strict CI.
   */
  onMissingEnv?: 'empty' | 'throw';
}

export class WorkspaceLoader {
  /**
   * Resolve the workspace.yaml path for a given root.
   * Returns null if the file doesn't exist (caller decides whether to error).
   */
  static findConfigPath(workspaceRoot: string): string | null {
    const p = path.join(workspaceRoot, WORKSPACE_DIR, WORKSPACE_FILENAME);
    return fs.existsSync(p) ? p : null;
  }

  /**
   * Load + validate the workspace at `workspaceRoot`. Returns a fully wired
   * `LoadedWorkspace` ready to use.
   *
   * Errors:
   *   - WorkspaceNotFoundError — no .aidlc/workspace.yaml at root
   *   - WorkspaceParseError    — YAML parse failure
   *   - WorkspaceValidationError — schema mismatch (Zod issues)
   */
  static load(
    workspaceRoot: string,
    opts: WorkspaceLoaderOptions = {},
  ): LoadedWorkspace {
    const configPath = WorkspaceLoader.findConfigPath(workspaceRoot);
    if (!configPath) {
      throw new WorkspaceNotFoundError(workspaceRoot);
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new WorkspaceParseError(`YAML parse error: ${msg}`, configPath);
    }

    if (parsed === null || parsed === undefined) {
      throw new WorkspaceParseError('workspace.yaml is empty', configPath);
    }

    const config = validateWorkspace(parsed, configPath);

    return {
      config,
      configPath,
      root: workspaceRoot,
      envResolver: new EnvResolver({
        osEnv: opts.osEnv,
        onMissing: opts.onMissingEnv,
      }),
      skills: new SkillLoader(workspaceRoot, config.skills, {
        builtins: opts.builtins,
      }),
      runners: new RunnerRegistry(workspaceRoot),
    };
  }

  /**
   * Re-export for callers that want the raw error type without a separate
   * import.
   */
  static get ValidationError() { return WorkspaceValidationError; }
  static get NotFoundError() { return WorkspaceNotFoundError; }
  static get ParseError() { return WorkspaceParseError; }
}
