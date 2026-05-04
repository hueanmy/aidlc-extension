import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  WorkspaceLoader,
  WorkspaceNotFoundError,
  WorkspaceParseError,
} from '../src/loader/WorkspaceLoader';
import { WorkspaceValidationError } from '../src/schema/WorkspaceSchema';

const FIXTURE = path.join(__dirname, 'fixtures', 'qa-workspace.yaml');

/**
 * Build a temporary workspace directory layout:
 *   <tmp>/.aidlc/workspace.yaml
 *   <tmp>/.aidlc/skills/my-doc-skill.md
 *   <tmp>/.aidlc/skills/my-skill.md
 *
 * Returns the workspace root + cleanup fn.
 */
function makeTempWorkspace(yamlContent: string): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-test-'));
  const aidlcDir = path.join(root, '.aidlc');
  const skillsDir = path.join(aidlcDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(path.join(aidlcDir, 'workspace.yaml'), yamlContent);
  fs.writeFileSync(
    path.join(skillsDir, 'my-doc-skill.md'),
    '# Doc skill\nWrite great docs.\n',
  );
  fs.writeFileSync(
    path.join(skillsDir, 'my-skill.md'),
    '# My skill\nDo special things.\n',
  );
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe('WorkspaceLoader', () => {
  let workspace: { root: string; cleanup: () => void };

  beforeAll(() => {
    const yamlContent = fs.readFileSync(FIXTURE, 'utf8');
    workspace = makeTempWorkspace(yamlContent);
  });

  afterAll(() => workspace.cleanup());

  it('loads + validates the QA workspace fixture from disk', () => {
    const loaded = WorkspaceLoader.load(workspace.root, {
      osEnv: { ANTHROPIC_API_KEY: 'sk-test', APP_URL: 'https://app.example.com' },
    });

    expect(loaded.config.name).toBe('QA Workspace');
    expect(loaded.config.agents).toHaveLength(3);
    expect(loaded.configPath).toBe(
      path.join(workspace.root, '.aidlc', 'workspace.yaml'),
    );
  });

  it('resolves layered env vars via the loaded EnvResolver', () => {
    const loaded = WorkspaceLoader.load(workspace.root, {
      osEnv: { ANTHROPIC_API_KEY: 'sk-test', APP_URL: 'https://app.example.com' },
    });

    const resolved = loaded.envResolver.resolveLayered(
      loaded.config.environment,
      loaded.config.agents[0].env,
    );

    expect(resolved.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(resolved.BASE_URL).toBe('https://app.example.com');
    expect(resolved.STATIC_VAR).toBe('literal-value');
    // agent env survives merge
    expect(resolved.SOURCE_DIR).toBe('./cypress/e2e');
  });

  it('loads custom skill markdown via SkillLoader', () => {
    const loaded = WorkspaceLoader.load(workspace.root, { osEnv: {} });

    const skill = loaded.skills.load('my-doc-skill');
    expect(skill).toContain('Write great docs');
  });

  it('SkillLoader.has reflects what is resolvable', () => {
    const loaded = WorkspaceLoader.load(workspace.root, { osEnv: {} });
    expect(loaded.skills.has('my-doc-skill')).toBe(true);
    // builtin without registered path → not resolvable
    expect(loaded.skills.has('convert-test')).toBe(false);
    // unknown id
    expect(loaded.skills.has('nope')).toBe(false);
  });

  it('throws WorkspaceNotFoundError when .aidlc/workspace.yaml is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-empty-'));
    try {
      expect(() => WorkspaceLoader.load(empty)).toThrow(WorkspaceNotFoundError);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('throws WorkspaceParseError on malformed YAML', () => {
    const broken = makeTempWorkspace('this: is: not: yaml: ::: ::');
    try {
      expect(() => WorkspaceLoader.load(broken.root)).toThrow(WorkspaceParseError);
    } finally {
      broken.cleanup();
    }
  });

  it('throws WorkspaceValidationError on schema violation', () => {
    const bad = makeTempWorkspace('version: "1.0"\n# missing name');
    try {
      expect(() => WorkspaceLoader.load(bad.root)).toThrow(WorkspaceValidationError);
    } finally {
      bad.cleanup();
    }
  });

  it('runners.resolve returns DefaultRunner for default agents', () => {
    const loaded = WorkspaceLoader.load(workspace.root, { osEnv: {} });
    const defaultAgent = loaded.config.agents.find((a) => a.runner !== 'custom')!;
    const runner = loaded.runners.resolve(defaultAgent);
    expect(typeof runner.run).toBe('function');
  });

  it('runners.resolve fails clearly when custom runner_path is missing', () => {
    const loaded = WorkspaceLoader.load(workspace.root, { osEnv: {} });
    const customAgent = loaded.config.agents.find((a) => a.runner === 'custom')!;
    // The fixture's runner_path points to a file that doesn't exist on disk
    expect(() => loaded.runners.resolve(customAgent)).toThrow();
  });
});
