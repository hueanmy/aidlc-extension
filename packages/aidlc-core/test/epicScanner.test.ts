import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EpicScanner } from '../src/epicScanner';

describe('EpicScanner', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-scanner-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('returns [] when the epics dir does not exist', () => {
    const scanner = new EpicScanner(workspace);
    expect(scanner.scanAll()).toEqual([]);
  });

  it('discovers an epic and reports orchestrator status', () => {
    const epicsDir = path.join(workspace, 'docs', 'sdlc', 'epics');
    const epicDir = path.join(epicsDir, 'ABC-123');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(
      path.join(epicDir, 'ABC-123.md'),
      '# ABC-123 — Live Collaboration\n\nA real epic, not a template.\n',
    );

    const planStatusDir = path.join(epicDir, 'phases', 'plan');
    fs.mkdirSync(planStatusDir, { recursive: true });
    fs.writeFileSync(
      path.join(planStatusDir, 'status.json'),
      JSON.stringify({ status: 'passed', revision: 2, updated_at: '2026-05-04T00:00:00Z' }),
    );

    const scanner = new EpicScanner(workspace);
    const epics = scanner.scanAll();

    expect(epics).toHaveLength(1);
    const [epic] = epics;
    expect(epic.key).toBe('ABC-123');
    expect(epic.title).toBe('Live Collaboration');

    const plan = epic.phases.find((p) => p.id === 'plan')!;
    expect(plan.status).toBe('passed');
    expect(plan.revision).toBe(2);
  });

  it('scanEpic throws on an invalid key', () => {
    const scanner = new EpicScanner(workspace);
    expect(() => scanner.scanEpic('abc-123')).toThrow('Invalid epic key');
    expect(() => scanner.scanEpic('../etc/passwd')).toThrow('Invalid epic key');
    expect(() => scanner.scanEpic('ABC-123; rm -rf /')).toThrow('Invalid epic key');
  });
});
