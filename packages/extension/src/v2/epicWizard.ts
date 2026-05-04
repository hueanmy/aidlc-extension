/**
 * Start Epic wizard — `aidlc.startEpic`.
 *
 * An "epic" is a *run instance* of a pipeline (or single agent) bound to
 * concrete project-specific values:
 *
 *   workspace.yaml (static)         epic state (per-run)
 *   ─────────────────────────       ───────────────────────────────
 *   agents declare capabilities  →  inputs supply concrete values
 *   pipelines declare step order →  state tracks current step / status
 *
 * Phase A (this file) only writes the state files — no auto-execution.
 * After the wizard, the user invokes the first slash command in their
 * Claude CLI to actually run the agent. Phase B will auto-trigger; Phase
 * C will wire status updates back into state.json.
 *
 * Layout written to disk (rooted at `state.root` from workspace.yaml,
 * default `docs/epics/`):
 *
 *   <root>/<EPIC-ID>/state.json    — pipeline + step status
 *   <root>/<EPIC-ID>/inputs.json   — capability → user-supplied value
 *   <root>/<EPIC-ID>/artifacts/    — empty; agents write outputs here later
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { stepAgentId } from '@aidlc/core';

import { readYaml, type YamlDocument } from './yamlIO';

// ── Types ───────────────────────────────────────────────────────────────

interface RunTarget {
  kind: 'pipeline' | 'agent';
  id: string;
  /** Ordered list of agent ids that will execute. */
  agents: string[];
}

interface EpicState {
  id: string;
  title: string;
  description: string;
  pipeline: string | null;
  agent: string | null;
  agents: string[];
  currentStep: number;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  createdAt: string;
  stepStates: Array<{
    agent: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
    startedAt: string | null;
    finishedAt: string | null;
  }>;
}

// ── Capability prompts ──────────────────────────────────────────────────

interface CapabilityPrompt {
  prompt: string;
  placeholder: string;
  defaultValue?: string;
}

const CAPABILITY_PROMPTS: Record<string, CapabilityPrompt> = {
  'jira':          { prompt: 'Jira ticket key or URL',                    placeholder: 'PROJ-123 or https://acme.atlassian.net/browse/PROJ-123' },
  'figma':         { prompt: 'Figma file URL or file key',                placeholder: 'https://www.figma.com/file/abc123/...' },
  'core-business': { prompt: 'Path to core business docs (relative)',     placeholder: 'docs/core', defaultValue: 'docs/core' },
  'github':        { prompt: 'GitHub repo or PR URL',                     placeholder: 'owner/repo or https://github.com/owner/repo/pull/42' },
  'slack':         { prompt: 'Slack channel or thread URL',               placeholder: '#engineering or https://slack.com/...' },
  'files':         { prompt: 'Files glob (relative to project root)',     placeholder: 'src/**/*.ts' },
  'web':           { prompt: 'URLs to fetch (comma-separated, optional)', placeholder: 'https://example.com/...' },
};

// ── Main wizard ─────────────────────────────────────────────────────────

export async function startEpicCommand(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('AIDLC: Open a project first.');
    return;
  }

  const doc = readYaml(root);
  if (!doc) {
    const choice = await vscode.window.showWarningMessage(
      'AIDLC: No workspace.yaml in this project. Load a template first?',
      'Load Template', 'Init Sample',
    );
    if (choice === 'Load Template') {
      await vscode.commands.executeCommand('aidlc.applyPreset');
    } else if (choice === 'Init Sample') {
      await vscode.commands.executeCommand('aidlc.initWorkspace');
    }
    return;
  }

  if (doc.agents.length === 0) {
    void vscode.window.showWarningMessage(
      'AIDLC: No agents in workspace.yaml. Add an agent before starting an epic.',
    );
    return;
  }

  const target = await pickTarget(doc);
  if (!target) { return; }

  const epicRoot = readEpicRoot(doc);
  const epicId = await pickEpicId(root, epicRoot);
  if (!epicId) { return; }

  const title = await vscode.window.showInputBox({
    prompt: 'Epic title (optional)',
    placeHolder: 'e.g. "Add user profile page"',
    ignoreFocusOut: true,
  });
  if (title === undefined) { return; }

  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: 'One-line summary of what this epic delivers',
    ignoreFocusOut: true,
  });
  if (description === undefined) { return; }

  const capabilities = collectCapabilities(doc, target);
  const inputs: Record<string, string> = {};
  for (const cap of capabilities) {
    const value = await promptCapability(cap);
    if (value === undefined) { return; }
    if (value !== '') { inputs[cap] = value; }
  }

  const epicDir = path.resolve(root, epicRoot, epicId);
  if (fs.existsSync(epicDir)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${path.relative(root, epicDir)} already exists. Overwrite the state files?`,
      'Overwrite', 'Cancel',
    );
    if (overwrite !== 'Overwrite') { return; }
  }

  fs.mkdirSync(epicDir, { recursive: true });
  fs.mkdirSync(path.join(epicDir, 'artifacts'), { recursive: true });

  const state: EpicState = {
    id: epicId,
    title: title.trim(),
    description: description.trim(),
    pipeline: target.kind === 'pipeline' ? target.id : null,
    agent: target.kind === 'agent' ? target.id : null,
    agents: target.agents,
    currentStep: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
    stepStates: target.agents.map((a) => ({
      agent: a, status: 'pending', startedAt: null, finishedAt: null,
    })),
  };

  fs.writeFileSync(path.join(epicDir, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(epicDir, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n', 'utf8');

  const firstAgent = target.agents[0];
  const slash = findSlashCommand(doc, firstAgent, target);
  const cmdHint = slash ? `\`${slash} ${epicId}\`` : `\`/${firstAgent} ${epicId}\` (or invoke agent manually)`;

  const choice = await vscode.window.showInformationMessage(
    `Started ${epicId}. Run ${cmdHint} in the Claude CLI to begin.`,
    'Open Claude CLI', 'Open state.json',
  );
  if (choice === 'Open Claude CLI') {
    await vscode.commands.executeCommand('aidlc.openClaudeTerminal');
  } else if (choice === 'Open state.json') {
    const docOpen = await vscode.workspace.openTextDocument(path.join(epicDir, 'state.json'));
    await vscode.window.showTextDocument(docOpen, { preview: false });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function pickTarget(doc: YamlDocument): Promise<RunTarget | undefined> {
  const items: Array<vscode.QuickPickItem & { target: RunTarget }> = [];

  for (const p of doc.pipelines) {
    const id = String(p.id);
    const steps = Array.isArray(p.steps) ? (p.steps as unknown[]).map(stepAgentId) : [];
    items.push({
      label: `$(list-ordered) ${id}`,
      description: `${steps.length} agents`,
      detail: steps.join(' → '),
      target: { kind: 'pipeline', id, agents: steps },
    });
  }

  for (const a of doc.agents) {
    const id = String(a.id);
    const name = typeof a.name === 'string' ? a.name : id;
    items.push({
      label: `$(person) ${id}`,
      description: 'single agent',
      detail: name,
      target: { kind: 'agent', id, agents: [id] },
    });
  }

  if (items.length === 0) { return undefined; }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Pick a pipeline or single agent to run',
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return picked?.target;
}

function readEpicRoot(doc: YamlDocument): string {
  const state = doc.state as Record<string, unknown> | undefined;
  if (state && typeof state.root === 'string' && state.root.trim()) {
    return state.root;
  }
  return 'docs/epics';
}

/**
 * Suggest the next sequential epic id by scanning existing folders under
 * the epic root. Falls back to EPIC-001 when none exist.
 */
async function pickEpicId(workspaceRoot: string, epicRoot: string): Promise<string | undefined> {
  const dir = path.resolve(workspaceRoot, epicRoot);
  let next = 1;
  if (fs.existsSync(dir)) {
    const existing = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const numbered = existing
      .map((n) => n.match(/^EPIC-(\d+)$/i))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => parseInt(m[1], 10));
    if (numbered.length > 0) { next = Math.max(...numbered) + 1; }
  }

  const suggested = `EPIC-${String(next).padStart(3, '0')}`;
  const id = await vscode.window.showInputBox({
    prompt: 'Epic id',
    placeHolder: 'e.g. EPIC-001 (uppercase + dashes + digits)',
    value: suggested,
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) { return 'Required'; }
      if (!/^[A-Z][A-Z0-9-]*$/.test(t)) {
        return 'Uppercase letters / digits / dashes only — must start with a letter';
      }
      return null;
    },
  });
  return id?.trim();
}

/**
 * Collect the de-duplicated set of capabilities across all agents we're
 * about to run, preserving first-seen order so the user is asked in a
 * predictable sequence.
 */
function collectCapabilities(doc: YamlDocument, target: RunTarget): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const agentId of target.agents) {
    const agent = doc.agents.find((a) => String(a.id) === agentId);
    if (!agent) { continue; }
    const caps = Array.isArray(agent.capabilities) ? (agent.capabilities as unknown[]) : [];
    for (const c of caps) {
      const id = String(c);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

async function promptCapability(cap: string): Promise<string | undefined> {
  const meta = CAPABILITY_PROMPTS[cap];
  const prompt = meta?.prompt ?? `Value for capability \`${cap}\``;
  const placeholder = meta?.placeholder ?? 'Enter the value to bind, or leave blank to skip';
  const value = await vscode.window.showInputBox({
    title: `Capability: ${cap}`,
    prompt,
    placeHolder: placeholder,
    value: meta?.defaultValue ?? '',
    ignoreFocusOut: true,
  });
  return value?.trim();
}

/**
 * Find the slash command (if any) that invokes the given agent OR the
 * pipeline target — used to suggest the right command at the end of the
 * wizard so the user doesn't have to remember the syntax.
 */
function findSlashCommand(doc: YamlDocument, firstAgentId: string, target: RunTarget): string | null {
  for (const c of doc.slash_commands) {
    if (target.kind === 'pipeline' && (c as { pipeline?: unknown }).pipeline === target.id) {
      return String(c.name);
    }
    if (target.kind === 'agent' && (c as { agent?: unknown }).agent === target.id) {
      return String(c.name);
    }
  }
  // Fallback: a slash command that points at the first agent of the pipeline.
  for (const c of doc.slash_commands) {
    if ((c as { agent?: unknown }).agent === firstAgentId) { return String(c.name); }
  }
  return null;
}
