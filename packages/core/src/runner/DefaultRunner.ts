/**
 * Default runner — shells out to the `claude` CLI with the skill as system
 * prompt and slash command args as the user message. Streams stdout/stderr
 * back through the runner context callbacks.
 *
 * Phase 1: this is a working stub. Real terminal/extension integration lands
 * in Phase 4 when we wire AidlcTerminal up to call this. Tests in Phase 1
 * exercise the spawn logic via a fake child_process; production use kicks in
 * once an extension calls `runner.run({...})`.
 */

import { spawn } from 'child_process';
import type { AidlcRunner, RunnerContext, RunnerResult } from './types';

export interface DefaultRunnerOptions {
  /**
   * Override the claude binary path. Useful for tests + when claude is not
   * on PATH (rare). Default looks up `claude` on PATH.
   */
  claudeBin?: string;
  /**
   * Extra args inserted before the user message. Most users won't need this;
   * custom runners are the right place for advanced flag tuning.
   */
  extraArgs?: string[];
}

export class DefaultRunner implements AidlcRunner {
  constructor(private readonly opts: DefaultRunnerOptions = {}) {}

  async run(ctx: RunnerContext): Promise<RunnerResult> {
    const bin = this.opts.claudeBin ?? 'claude';
    const userMessage = ctx.args.join(' ');

    // --print: non-interactive, dump response and exit (no REPL)
    // --append-system-prompt: stack our skill on top of claude's defaults
    const args = [
      '--print',
      '--append-system-prompt', ctx.skill,
      ...(this.opts.extraArgs ?? []),
      userMessage,
    ];

    const proc = spawn(bin, args, {
      cwd: ctx.workspaceRoot,
      env: { ...process.env, ...ctx.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let collected = '';
    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString('utf8');
      collected += chunk;
      ctx.onOutput(chunk);
    });
    proc.stderr.on('data', (d: Buffer) => {
      ctx.onError(d.toString('utf8'));
    });

    return new Promise<RunnerResult>((resolve) => {
      proc.on('error', (err) => {
        ctx.onError(`Failed to spawn ${bin}: ${err.message}\n`);
        resolve({ success: false, output: collected });
      });
      proc.on('close', (code) => {
        resolve({ success: code === 0, output: collected });
      });
    });
  }
}
