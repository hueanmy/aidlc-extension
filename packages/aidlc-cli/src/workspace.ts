import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the workspace root using:
 *   1. --workspace CLI flag
 *   2. AIDLC_WORKSPACE env var
 *   3. Walk up from cwd looking for docs/sdlc/
 *   4. cwd fallback
 */
export function resolveWorkspace(flag?: string): string {
  if (flag) {
    const abs = path.resolve(flag);
    if (!fs.existsSync(abs)) { throw new Error(`Workspace not found: ${abs}`); }
    return abs;
  }

  if (process.env.AIDLC_WORKSPACE) {
    const abs = path.resolve(process.env.AIDLC_WORKSPACE);
    if (!fs.existsSync(abs)) { throw new Error(`AIDLC_WORKSPACE not found: ${abs}`); }
    return abs;
  }

  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'sdlc'))) { return dir; }
    const parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }

  return process.cwd();
}
