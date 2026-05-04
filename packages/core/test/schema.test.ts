import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  validateWorkspace,
  WorkspaceValidationError,
} from '../src/schema/WorkspaceSchema';

const FIXTURE = path.join(__dirname, 'fixtures', 'qa-workspace.yaml');

describe('WorkspaceSchema', () => {
  it('accepts the QA workspace fixture', () => {
    const raw = yaml.load(fs.readFileSync(FIXTURE, 'utf8'));
    const config = validateWorkspace(raw, FIXTURE);

    expect(config.version).toBe('1.0');
    expect(config.name).toBe('QA Workspace');
    expect(config.agents).toHaveLength(3);
    expect(config.skills).toHaveLength(3);
    expect(config.pipelines[0].on_failure).toBe('stop');
    expect(config.sidebar?.views).toHaveLength(3);
    expect(config.state?.entity).toBe('epic');
  });

  it('applies sensible defaults for optional fields', () => {
    const config = validateWorkspace(
      { version: '1.0', name: 'Minimal' },
      'memory:test',
    );
    expect(config.agents).toEqual([]);
    expect(config.skills).toEqual([]);
    expect(config.environment).toEqual({});
    expect(config.slash_commands).toEqual([]);
    expect(config.pipelines).toEqual([]);
    expect(config.state).toBeUndefined();
    expect(config.sidebar).toBeUndefined();
  });

  it('rejects an agent with runner: custom but no runner_path', () => {
    expect(() =>
      validateWorkspace(
        {
          version: '1.0',
          name: 'Bad',
          agents: [
            { id: 'a', name: 'A', skill: 's', runner: 'custom' /* missing runner_path */ },
          ],
        },
        'memory:test',
      ),
    ).toThrow(WorkspaceValidationError);
  });

  it('rejects a skill missing both `builtin` and `path`', () => {
    expect(() =>
      validateWorkspace(
        {
          version: '1.0',
          name: 'Bad',
          skills: [{ id: 'orphan' }],
        },
        'memory:test',
      ),
    ).toThrow(WorkspaceValidationError);
  });

  it('rejects slash command name without leading `/`', () => {
    expect(() =>
      validateWorkspace(
        {
          version: '1.0',
          name: 'Bad',
          slash_commands: [{ name: 'no-slash', agent: 'a' }],
        },
        'memory:test',
      ),
    ).toThrow(WorkspaceValidationError);
  });

  it('discriminates sidebar.views by `type`', () => {
    const config = validateWorkspace(
      {
        version: '1.0',
        name: 'V',
        sidebar: {
          views: [
            { type: 'file-tree', glob: 'docs/**/*.md', label: 'Docs' },
            { type: 'agents-list' },
          ],
        },
      },
      'memory:test',
    );
    expect(config.sidebar!.views).toHaveLength(2);
    const ft = config.sidebar!.views[0];
    if (ft.type !== 'file-tree') { throw new Error('expected file-tree'); }
    expect(ft.glob).toBe('docs/**/*.md');
    expect(ft.group_by).toBe('flat'); // default
  });

  it('rejects unknown sidebar view type', () => {
    expect(() =>
      validateWorkspace(
        {
          version: '1.0',
          name: 'V',
          sidebar: { views: [{ type: 'graph-view' }] },
        },
        'memory:test',
      ),
    ).toThrow(WorkspaceValidationError);
  });
});
