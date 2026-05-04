import * as fs from 'fs';
import * as path from 'path';

/**
 * Idempotent one-shot migrations for epic data whose schema has changed
 * between pipeline versions. Each migration is guarded by an existence
 * check so re-running is a no-op once applied.
 *
 * Current migrations (mirrors cf-sdlc-pipeline/server/src/mcp.ts migrateEpics):
 *   - `phases/uat/` → `phases/execute-test/` (phase rename)
 *   - `UAT-SCRIPT.md` → `TEST-SCRIPT.md` (artifact rename, incl. in archive/)
 *   - `status.json` phase field "uat" → "execute-test"
 *   - `pipeline.json` enabledPhases: "uat" → "execute-test"
 *
 * Failures on one epic do not abort the batch.
 */
export function migrateEpics(
  epicsDir: string,
  log: (msg: string) => void,
): string[] {
  const results: string[] = [];
  if (!fs.existsSync(epicsDir)) { return results; }

  let epicDirs: string[] = [];
  try {
    epicDirs = fs.readdirSync(epicsDir).filter((name) => {
      const p = path.join(epicsDir, name);
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });
  } catch {
    return results;
  }

  for (const epic of epicDirs) {
    try {
      const epicDir = path.join(epicsDir, epic);
      const phasesDir = path.join(epicDir, 'phases');

      // 1. Rename phases/uat → phases/execute-test
      const oldPhaseDir = path.join(phasesDir, 'uat');
      const newPhaseDir = path.join(phasesDir, 'execute-test');
      if (fs.existsSync(oldPhaseDir) && !fs.existsSync(newPhaseDir)) {
        fs.renameSync(oldPhaseDir, newPhaseDir);
        results.push(`${epic}/phases/uat → execute-test`);
      }

      // 2. Fix phase field in status.json
      const statusJson = path.join(newPhaseDir, 'status.json');
      if (fs.existsSync(statusJson)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(statusJson, 'utf8'));
          if (parsed.phase === 'uat') {
            parsed.phase = 'execute-test';
            fs.writeFileSync(statusJson, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
            results.push(`${epic}/phases/execute-test/status.json phase field`);
          }
        } catch (err) {
          log(`status.json failed for ${epic}: ${err}`);
        }
      }

      // 3. Rename UAT-SCRIPT.md → TEST-SCRIPT.md (epic root + phase dir + archives)
      renameUatScript(epicDir, epic, results);
      if (fs.existsSync(newPhaseDir)) {
        renameUatScript(newPhaseDir, `${epic}/phases/execute-test`, results);
      }
      const archiveRoot = path.join(newPhaseDir, 'archive');
      if (fs.existsSync(archiveRoot)) {
        try {
          for (const rev of fs.readdirSync(archiveRoot)) {
            renameUatScript(
              path.join(archiveRoot, rev),
              `${epic}/phases/execute-test/archive/${rev}`,
              results,
            );
          }
        } catch (err) {
          log(`archive failed for ${epic}: ${err}`);
        }
      }

      // 4. Replace "uat" in pipeline.json enabledPhases
      const pipelineJson = path.join(epicDir, 'pipeline.json');
      if (fs.existsSync(pipelineJson)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pipelineJson, 'utf8'));
          if (Array.isArray(parsed.enabledPhases) && parsed.enabledPhases.includes('uat')) {
            parsed.enabledPhases = parsed.enabledPhases.map(
              (p: string) => p === 'uat' ? 'execute-test' : p,
            );
            fs.writeFileSync(pipelineJson, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
            results.push(`${epic}/pipeline.json enabledPhases`);
          }
        } catch (err) {
          log(`pipeline.json failed for ${epic}: ${err}`);
        }
      }
    } catch (err) {
      log(`epic ${epic} failed: ${err}`);
    }
  }

  return results;
}

function renameUatScript(dir: string, label: string, results: string[]): void {
  const oldFile = path.join(dir, 'UAT-SCRIPT.md');
  const newFile = path.join(dir, 'TEST-SCRIPT.md');
  if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
    try {
      fs.renameSync(oldFile, newFile);
      results.push(`${label}/UAT-SCRIPT.md → TEST-SCRIPT.md`);
    } catch {
      /* silently skip — best effort */
    }
  }
}
