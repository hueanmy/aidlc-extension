/**
 * `aidlc.insertDemoEpic` — drops a fake EPIC-100 into the project so the
 * user can see what the Epics panel renders before any real run is wired.
 *
 * Picks the first pipeline (or first single agent) declared in
 * workspace.yaml, marks the first ~third of steps as done, the next as
 * in_progress, the rest as pending. Generates plausible inputs based on
 * declared agent capabilities so the inputs grid in the panel isn't empty.
 *
 * Idempotent: prompts to overwrite if EPIC-100 already exists.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { readYaml, type YamlDocument } from './yamlIO';

const DEMO_INPUTS_BY_CAPABILITY: Record<string, string> = {
  'jira': 'PROJ-100',
  'figma': 'https://www.figma.com/file/abcDEF12345/Profile-Page',
  'core-business': 'docs/core',
  'github': 'aidlc-io/aidlc',
  'slack': '#engineering',
  'files': 'src/**/*.ts',
  'web': 'https://docs.example.com',
};

export async function insertDemoEpicCommand(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('AIDLC: Open a project first.');
    return;
  }

  const doc = readYaml(root);
  if (!doc) {
    void vscode.window.showWarningMessage(
      'AIDLC: No workspace.yaml — load a template first (e.g. SDLC Pipeline).',
    );
    return;
  }

  const target = pickDemoTarget(doc);
  if (!target) {
    void vscode.window.showWarningMessage(
      'AIDLC: No pipelines or agents in workspace.yaml — nothing to demo.',
    );
    return;
  }

  const epicRoot = readEpicRoot(doc);
  const epicDir = path.resolve(root, epicRoot, 'EPIC-100');

  if (fs.existsSync(epicDir)) {
    const choice = await vscode.window.showWarningMessage(
      `EPIC-100 already exists at ${path.relative(root, epicDir)}. Overwrite with fresh demo data?`,
      'Overwrite', 'Cancel',
    );
    if (choice !== 'Overwrite') { return; }
  }

  fs.mkdirSync(path.join(epicDir, 'artifacts'), { recursive: true });

  // Mark progress: first 1/3 done, next 1/3 in_progress (just the boundary
  // step actually), the rest pending. Status of the whole epic = in_progress
  // when there's any in_progress step.
  const total = target.agents.length;
  const doneCount = Math.max(1, Math.floor(total / 3));
  const stepStates = target.agents.map((agent, i) => {
    let status: 'pending' | 'in_progress' | 'done';
    if (i < doneCount) { status = 'done'; }
    else if (i === doneCount) { status = 'in_progress'; }
    else { status = 'pending'; }
    const startedAt = i <= doneCount ? new Date(Date.now() - (total - i) * 3600_000).toISOString() : null;
    const finishedAt = i < doneCount ? new Date(Date.now() - (total - i - 1) * 3600_000).toISOString() : null;
    return { agent, status, startedAt, finishedAt };
  });

  const state = {
    id: 'EPIC-100',
    title: 'Add user profile page (DEMO)',
    description: 'Synthetic data — populated by AIDLC: Insert Demo Epic so you can see how progress renders.',
    pipeline: target.kind === 'pipeline' ? target.id : null,
    agent: target.kind === 'agent' ? target.id : null,
    agents: target.agents,
    currentStep: doneCount,
    status: 'in_progress',
    createdAt: new Date(Date.now() - total * 3600_000).toISOString(),
    stepStates,
  };

  fs.writeFileSync(path.join(epicDir, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(epicDir, 'inputs.json'), JSON.stringify(buildInputs(doc, target), null, 2) + '\n', 'utf8');

  // Stub artifact .md files for done steps so the EpicsPanel "Artifact"
  // link is clickable and opens to a real (placeholder) file.
  for (let i = 0; i < doneCount; i++) {
    const agentId = target.agents[i];
    const agent = doc.agents.find((a) => String(a.id) === agentId);
    if (!agent) { continue; }
    const artifact = typeof agent.artifact === 'string' ? agent.artifact : null;
    if (!artifact || /[<>{}]/.test(artifact)) { continue; }  // skip patterns like "feature/<EPIC>-<slug>"
    const artifactPath = path.join(epicDir, 'artifacts', artifact);
    if (fs.existsSync(artifactPath)) { continue; }
    fs.writeFileSync(artifactPath, stubArtifactContent(agentId, agent as Record<string, unknown>), 'utf8');
  }

  void vscode.window
    .showInformationMessage(
      `Inserted EPIC-100 with ${doneCount}/${total} steps done. Open the Epics panel to see it.`,
      'Open Epics Panel',
    )
    .then((c) => {
      if (c === 'Open Epics Panel') {
        void vscode.commands.executeCommand('aidlc.openEpicsList');
      }
    });
}

function stubArtifactContent(agentId: string, agent: Record<string, unknown>): string {
  const name = typeof agent.name === 'string' ? agent.name : agentId;
  const desc = typeof agent.description === 'string' ? agent.description : '';
  const outputs = typeof agent.outputs === 'string' ? agent.outputs : '';
  return `# ${name} artifact (DEMO)

> Placeholder produced by **AIDLC: Insert Demo Epic** so the Epics panel has
> something to open. Replace with the real output when an actual run lands here.

**Phase:** ${name} (${agentId})

${desc ? `**What this phase does:** ${desc}\n\n` : ''}${outputs ? `**Expected output:** ${outputs}\n\n` : ''}---

[Sample content — fill in with real artifact when the agent actually runs]
`;
}

interface DemoTarget {
  kind: 'pipeline' | 'agent';
  id: string;
  agents: string[];
}

function pickDemoTarget(doc: YamlDocument): DemoTarget | null {
  if (doc.pipelines.length > 0) {
    const p = doc.pipelines[0];
    return {
      kind: 'pipeline',
      id: String(p.id),
      agents: Array.isArray(p.steps) ? (p.steps as unknown[]).map(String) : [],
    };
  }
  if (doc.agents.length > 0) {
    const a = doc.agents[0];
    return { kind: 'agent', id: String(a.id), agents: [String(a.id)] };
  }
  return null;
}

function readEpicRoot(doc: YamlDocument): string {
  const state = doc.state as Record<string, unknown> | undefined;
  if (state && typeof state.root === 'string' && state.root.trim()) {
    return state.root;
  }
  return 'docs/epics';
}

function buildInputs(doc: YamlDocument, target: DemoTarget): Record<string, string> {
  const seen = new Set<string>();
  const inputs: Record<string, string> = {};
  for (const agentId of target.agents) {
    const agent = doc.agents.find((a) => String(a.id) === agentId);
    if (!agent) { continue; }
    const caps = Array.isArray(agent.capabilities) ? (agent.capabilities as unknown[]) : [];
    for (const c of caps) {
      const id = String(c);
      if (seen.has(id)) { continue; }
      seen.add(id);
      inputs[id] = DEMO_INPUTS_BY_CAPABILITY[id] ?? `<${id} value>`;
    }
  }
  return inputs;
}
