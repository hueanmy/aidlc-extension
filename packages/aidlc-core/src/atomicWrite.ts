import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Write `content` to `filePath` atomically using a write-to-temp-then-rename
 * pattern. On POSIX, rename(2) is atomic within the same filesystem, so
 * readers never see a partially-written file.
 *
 * Note: on Windows, rename across files is not atomic. This is acceptable for
 * a local developer tool; add a lockfile if cross-platform atomicity matters.
 */
export function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.aidlc-tmp-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}
