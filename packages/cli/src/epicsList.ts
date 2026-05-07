/**
 * Read epic state files from disk — mirrors packages/extension/src/v2/epicsList.ts
 * so the CLI surfaces the same epics the VS Code Builder shows.
 *
 * Cheap: scans <state.root> directly, reads each state.json. Anything that
 * writes a `state.json` matching the shape gets picked up here.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { YamlDocument } from './yamlIO';

export type EpicStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface EpicStepDetail {
  agent: string;
  status: EpicStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EpicSummary {
  id: string;
  title: string;
  description: string;
  status: EpicStatus;
  createdAt: string;
  pipeline: string | null;
  agents: string[];
  currentStep: number;
  stepDetails: EpicStepDetail[];
  inputs: Record<string, string>;
  statePath: string;
  epicDir: string;
}

const STATUS_VALUES: ReadonlyArray<EpicStatus> = ['pending', 'in_progress', 'done', 'failed'];

function asStatus(v: unknown): EpicStatus {
  return STATUS_VALUES.includes(v as EpicStatus) ? (v as EpicStatus) : 'pending';
}

/** Resolve epic root directory. Honours workspace.yaml `state.root`, falls back to `docs/epics`. */
export function epicsRoot(workspaceRoot: string, doc: YamlDocument | null): string {
  const stateRoot = doc?.state && typeof (doc.state as Record<string, unknown>).root === 'string'
    ? String((doc.state as Record<string, unknown>).root)
    : 'docs/epics';
  return path.resolve(workspaceRoot, stateRoot);
}

export function listEpics(workspaceRoot: string, doc: YamlDocument | null): EpicSummary[] {
  const dir = epicsRoot(workspaceRoot, doc);
  if (!fs.existsSync(dir)) { return []; }

  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const epics: EpicSummary[] = [];
  for (const folder of folders) {
    const epicDir   = path.join(dir, folder);
    const stateFile = path.join(epicDir, 'state.json');
    if (!fs.existsSync(stateFile)) { continue; }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch { continue; }
    if (!parsed || typeof parsed !== 'object') { continue; }

    const stepStatesRaw = Array.isArray(parsed.stepStates)
      ? (parsed.stepStates as Array<Record<string, unknown>>)
      : [];
    const stepDetails: EpicStepDetail[] = stepStatesRaw.map(s => ({
      agent: typeof s.agent === 'string' ? s.agent : '',
      status: asStatus(s.status),
      startedAt:  typeof s.startedAt  === 'string' ? s.startedAt  : null,
      finishedAt: typeof s.finishedAt === 'string' ? s.finishedAt : null,
    }));

    epics.push({
      id:           typeof parsed.id === 'string' ? parsed.id : folder,
      title:        typeof parsed.title === 'string' ? parsed.title : '',
      description:  typeof parsed.description === 'string' ? parsed.description : '',
      status:       asStatus(parsed.status),
      createdAt:    typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      pipeline:     typeof parsed.pipeline === 'string' ? parsed.pipeline : null,
      agents:       Array.isArray(parsed.agents) ? (parsed.agents as unknown[]).map(String) : [],
      currentStep:  typeof parsed.currentStep === 'number' ? parsed.currentStep : 0,
      stepDetails,
      inputs:       readInputs(epicDir),
      statePath:    stateFile,
      epicDir,
    });
  }

  // Newest first by createdAt; ties → id.
  epics.sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
  });
  return epics;
}

export function loadEpic(workspaceRoot: string, doc: YamlDocument | null, id: string): EpicSummary | null {
  return listEpics(workspaceRoot, doc).find(e => e.id === id) ?? null;
}

function readInputs(epicDir: string): Record<string, string> {
  const inputsFile = path.join(epicDir, 'inputs.json');
  if (!fs.existsSync(inputsFile)) { return {}; }
  try {
    const parsed = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') { return {}; }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
  } catch { return {}; }
}
