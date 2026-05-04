/**
 * Read epic state files from disk so the Builder + sidebar can render a
 * "recent epics" view. Stays decoupled from the wizard — anything that
 * writes a `state.json` matching the shape gets picked up here.
 *
 * Cheap: scans <state.root> directly, reads each state.json. Counted in
 * milliseconds for a normal-size project (a few dozen epics). If/when we
 * cross the thousand-epic mark we'll add an indexed cache; not before.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { YamlDocument } from './yamlIO';

export type EpicStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface EpicSummary {
  id: string;
  title: string;
  description: string;
  status: EpicStatus;
  createdAt: string;
  pipeline: string | null;
  agent: string | null;
  agents: string[];
  currentStep: number;
  stepStatuses: EpicStatus[];
  /** Per-step detail (timing, future fields). Same length as agents. */
  stepDetails: Array<{
    agent: string;
    status: EpicStatus;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  /** Resolved inputs (capability id → user-supplied value). Keys may be empty. */
  inputs: Record<string, string>;
  inputsCount: number;
  /** Absolute path to state.json — used by the webview to open the file. */
  statePath: string;
  /** Absolute path to the epic dir (for opening artifacts/). */
  epicDir: string;
}

const STATUS_VALUES: ReadonlyArray<EpicStatus> = ['pending', 'in_progress', 'done', 'failed'];

function asStatus(v: unknown): EpicStatus {
  return STATUS_VALUES.includes(v as EpicStatus) ? (v as EpicStatus) : 'pending';
}

/**
 * Resolve the directory holding epic folders. Honours
 * workspace.yaml's `state.root` field; falls back to `docs/epics`.
 */
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
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const epics: EpicSummary[] = [];
  for (const folder of folders) {
    const epicDir = path.join(dir, folder);
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

    const stepDetails = stepStatesRaw.map((s) => ({
      agent: typeof s.agent === 'string' ? s.agent : '',
      status: asStatus(s.status),
      startedAt: typeof s.startedAt === 'string' ? s.startedAt : null,
      finishedAt: typeof s.finishedAt === 'string' ? s.finishedAt : null,
    }));

    const inputs = readInputs(epicDir);

    epics.push({
      id: typeof parsed.id === 'string' ? parsed.id : folder,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      status: asStatus(parsed.status),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      pipeline: typeof parsed.pipeline === 'string' ? parsed.pipeline : null,
      agent: typeof parsed.agent === 'string' ? parsed.agent : null,
      agents: Array.isArray(parsed.agents) ? (parsed.agents as unknown[]).map(String) : [],
      currentStep: typeof parsed.currentStep === 'number' ? parsed.currentStep : 0,
      stepStatuses: stepDetails.map((s) => s.status),
      stepDetails,
      inputs,
      inputsCount: Object.keys(inputs).length,
      statePath: stateFile,
      epicDir,
    });
  }

  // Newest first by createdAt; ties fall back to id.
  epics.sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    if (cmp !== 0) { return cmp; }
    return b.id.localeCompare(a.id);
  });
  return epics;
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
