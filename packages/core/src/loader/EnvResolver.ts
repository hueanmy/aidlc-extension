/**
 * Resolves `${env:VAR}` placeholders in workspace + agent environment maps.
 *
 * The pattern matches Vercel/Render/most-CI conventions: developers write
 *   ANTHROPIC_API_KEY: "${env:ANTHROPIC_API_KEY}"
 * in workspace.yaml so the value comes from the OS environment at run time
 * (never committed to git). Plain string values pass through unchanged.
 *
 * Layering: per-agent env overrides workspace-wide env. Both layers are
 * resolved against the same OS environment.
 */

const ENV_REF = /\$\{env:([A-Z_][A-Z0-9_]*)\}/g;

export interface EnvResolverOptions {
  /** OS environment to resolve against. Defaults to `process.env`. */
  osEnv?: NodeJS.ProcessEnv;
  /**
   * Behavior when `${env:VAR}` references an unset OS var.
   * - `'empty'` (default): substitute empty string. Mirrors shell behavior.
   * - `'throw'`: throw EnvVarMissingError. Use in strict CI / publish flows.
   */
  onMissing?: 'empty' | 'throw';
}

export class EnvVarMissingError extends Error {
  constructor(public readonly variable: string, public readonly inField: string) {
    super(`Environment variable \`${variable}\` referenced by \`${inField}\` is not set`);
    this.name = 'EnvVarMissingError';
  }
}

export class EnvResolver {
  private readonly osEnv: NodeJS.ProcessEnv;
  private readonly onMissing: 'empty' | 'throw';

  constructor(opts: EnvResolverOptions = {}) {
    this.osEnv = opts.osEnv ?? process.env;
    this.onMissing = opts.onMissing ?? 'empty';
  }

  /**
   * Resolve a single string value. Replaces `${env:VAR}` occurrences with
   * the OS env var value. Plain strings pass through unchanged.
   */
  resolveValue(value: string, fieldName: string): string {
    return value.replace(ENV_REF, (_match, varName: string) => {
      const v = this.osEnv[varName];
      if (v === undefined) {
        if (this.onMissing === 'throw') {
          throw new EnvVarMissingError(varName, fieldName);
        }
        return '';
      }
      return v;
    });
  }

  /**
   * Resolve every value in a Record<string, string>, returning a new object.
   * Keys pass through unchanged.
   */
  resolveMap(map: Record<string, string>, scope: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      out[k] = this.resolveValue(v, `${scope}.${k}`);
    }
    return out;
  }

  /**
   * Layer agent env over workspace env, then resolve. Returns the resolved
   * env map ready to inject into a child process / runner context.
   */
  resolveLayered(
    workspaceEnv: Record<string, string>,
    agentEnv: Record<string, string> | undefined,
  ): Record<string, string> {
    const merged = { ...workspaceEnv, ...(agentEnv ?? {}) };
    return this.resolveMap(merged, 'env');
  }
}
