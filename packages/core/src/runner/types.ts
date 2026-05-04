/**
 * Runner plugin contract — every agent invocation goes through one of these.
 *
 * The default implementation shells out to the `claude` CLI; users on Pro
 * tier can ship a custom JS module via `runner_path` in their workspace.yaml
 * to take full control of execution (custom system prompts, tool injection,
 * external API calls, etc.).
 */

export interface RunnerContext {
  /** Skill markdown content (system prompt). */
  skill: string;
  /** Resolved environment variables (workspace + agent layered, secrets expanded). */
  env: Record<string, string>;
  /** Slash command args, already split. */
  args: string[];
  /** Absolute path to the user's project root (where .aidlc/ lives). */
  workspaceRoot: string;
  /** Stream chunk to terminal/output channel. Always full UTF-8 strings. */
  onOutput: (chunk: string) => void;
  /** Stream stderr / error chunk. */
  onError: (chunk: string) => void;
  /**
   * Optional shorthand wrapper around the claude CLI. Custom runners MAY use
   * this for convenience but are free to bypass it. Phase 1 leaves this `null`
   * — the wrapper is fleshed out in Phase 2 once the extension wires terminals.
   */
  claude: ClaudeCliWrapper | null;
}

/**
 * Minimal interface the bundled `claude` helper will satisfy. Defined here so
 * custom runner authors can type-check against it without depending on the
 * concrete implementation (which lives in the extension layer).
 */
export interface ClaudeCliWrapper {
  /**
   * Spawn `claude` with the given system prompt + user message + env. Streams
   * output through the runner's onOutput / onError. Resolves with the final
   * collected output and exit code.
   */
  run(opts: {
    systemPrompt: string;
    userMessage: string;
    env?: Record<string, string>;
  }): Promise<{ content: string; exitCode: number }>;
}

export interface RunnerResult {
  success: boolean;
  /** Final assembled output. May be empty if the runner streamed only. */
  output: string;
  /** Optional structured payload (parsed JSON, file paths produced, etc.). */
  data?: unknown;
}

export interface AidlcRunner {
  run(ctx: RunnerContext): Promise<RunnerResult>;
}

/** Thrown by CustomRunnerLoader when a user's runner_path file is malformed. */
export class RunnerValidationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`[runner ${path}] ${message}`);
    this.name = 'RunnerValidationError';
  }
}
