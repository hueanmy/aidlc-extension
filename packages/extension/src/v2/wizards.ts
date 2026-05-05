/**
 * QuickPick / InputBox wizards that mutate workspace.yaml.
 *
 * Three commands, all gated on a workspace folder being open. They share
 * yamlIO for reads/writes and `getWorkspaceRoot` for the root resolution.
 *
 *   aidlc.addSkill   — wizard: id → source picker → write .md + append to skills[]
 *   aidlc.addAgent   — wizard: id+name → skill picker → model picker → append to agents[]
 *   aidlc.addPipeline — wizard: id → multi-pick agents (ordered) → on_failure → append to pipelines[]
 *
 * Out of scope here: the visual drag-drop pipeline builder (M3 / Phase B).
 * The wizards write a workspace.yaml that the M3 webview will then read +
 * render as draggable nodes; everything is forward-compatible.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { readYaml, writeYaml, existingIds, type YamlDocument } from './yamlIO';
import { SKILL_TEMPLATES, type SkillTemplate } from './skillTemplates';

import { WORKSPACE_FILENAME } from '@aidlc/core';

// ── Shared helpers ──────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Load workspace.yaml or guide user to init one. Used by every wizard so
 * the entry path is consistent.
 */
async function loadOrInit(): Promise<{ root: string; doc: YamlDocument } | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage(
      'AIDLC: Open a folder first.',
    );
    return undefined;
  }

  const doc = readYaml(root);
  if (!doc) {
    const choice = await vscode.window.showWarningMessage(
      `AIDLC: No .aidlc/${WORKSPACE_FILENAME} found. Initialize one first?`,
      'Init Sample Workspace',
    );
    if (choice === 'Init Sample Workspace') {
      void vscode.commands.executeCommand('aidlc.initWorkspace');
    }
    return undefined;
  }

  return { root, doc };
}

/** Common id input, validates uniqueness against the supplied existing set. */
async function promptUniqueId(opts: {
  prompt: string;
  placeholder: string;
  existing: Set<string>;
}): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: opts.prompt,
    placeHolder: opts.placeholder,
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) { return 'Required'; }
      if (!/^[a-z][a-z0-9-]*$/.test(t)) {
        return 'Lowercase letters / digits / dashes only — must start with a letter';
      }
      if (opts.existing.has(t)) { return `\`${t}\` already exists`; }
      return null;
    },
  }).then((v) => v?.trim());
}

// ── addSkill ────────────────────────────────────────────────────────────

type SkillSource =
  | { kind: 'paste'; content: string }
  | { kind: 'upload'; content: string }
  | { kind: 'blank' }
  | { kind: 'template'; template: SkillTemplate };

export async function addSkillCommand(): Promise<void> {
  const ctx = await loadOrInit();
  if (!ctx) { return; }
  const { root, doc } = ctx;

  const skillId = await promptUniqueId({
    prompt: 'Skill id',
    placeholder: 'e.g. code-reviewer (lowercase, dashes ok)',
    existing: existingIds(doc.skills),
  });
  if (!skillId) { return; }

  const source = await pickSkillSource();
  if (!source) { return; }

  const skillDir = path.join(root, '.aidlc', 'skills');
  const skillPath = path.join(skillDir, `${skillId}.md`);

  let content: string;
  let openInEditor = false;

  switch (source.kind) {
    case 'paste':
    case 'upload':
      content = source.content;
      break;
    case 'template':
      content = source.template.content;
      break;
    case 'blank':
      content = `# ${skillId}\n\n<!-- Write the system prompt for this skill here. -->\n`;
      openInEditor = true;
      break;
  }

  fs.mkdirSync(skillDir, { recursive: true });
  if (fs.existsSync(skillPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${path.relative(root, skillPath)} already exists. Overwrite?`,
      'Overwrite', 'Cancel',
    );
    if (overwrite !== 'Overwrite') { return; }
  }
  fs.writeFileSync(skillPath, content, 'utf8');

  // Append to YAML skills[]
  doc.skills.push({
    id: skillId,
    path: `./.aidlc/skills/${skillId}.md`,
  });
  writeYaml(root, doc);

  // Open the file so the user can edit it. Always for `blank`, optional for
  // `template` (so they can copy/paste before tweaking).
  if (openInEditor || source.kind === 'template') {
    const docOpen = await vscode.workspace.openTextDocument(skillPath);
    await vscode.window.showTextDocument(docOpen, { preview: false });
  }

  void vscode.window.showInformationMessage(
    `Skill \`${skillId}\` added — ${path.relative(root, skillPath)} + workspace.yaml.`,
  );
}

async function pickSkillSource(): Promise<SkillSource | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(file-code) Load template', detail: 'Pick a starter skill (hello-world, code-reviewer, etc.) to copy into your workspace', value: 'template' as const },
      { label: '$(edit) Open blank file', detail: 'Create an empty skill .md and open it in the editor for you to write', value: 'blank' as const },
      { label: '$(clippy) Paste markdown', detail: 'Paste skill content from clipboard via input box', value: 'paste' as const },
      { label: '$(file) Upload .md file', detail: 'Pick an existing .md file from disk and copy its content', value: 'upload' as const },
    ],
    { placeHolder: 'How do you want to source the skill content?', ignoreFocusOut: true },
  );
  if (!choice) { return undefined; }

  switch (choice.value) {
    case 'template': {
      const picked = await vscode.window.showQuickPick(
        SKILL_TEMPLATES.map((t) => ({
          label: t.id,
          description: t.description,
          template: t,
        })),
        { placeHolder: 'Pick a template', ignoreFocusOut: true },
      );
      if (!picked) { return undefined; }
      return { kind: 'template', template: picked.template };
    }
    case 'blank':
      return { kind: 'blank' };
    case 'paste': {
      const content = await vscode.window.showInputBox({
        prompt: 'Paste the skill markdown content here',
        placeHolder: '# My Skill\n\nYou are a ...',
        ignoreFocusOut: true,
      });
      if (content === undefined || content.trim().length === 0) { return undefined; }
      return { kind: 'paste', content };
    }
    case 'upload': {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Use this .md',
        filters: { Markdown: ['md', 'markdown'] },
      });
      if (!result || result.length === 0) { return undefined; }
      const content = fs.readFileSync(result[0].fsPath, 'utf8');
      return { kind: 'upload', content };
    }
  }
}

// ── addAgent ────────────────────────────────────────────────────────────

const MODEL_CHOICES = [
  { label: 'claude-sonnet-4-6', description: 'Balanced (recommended default)', value: 'claude-sonnet-4-6' },
  { label: 'claude-opus-4-7',   description: 'Most capable, slower', value: 'claude-opus-4-7' },
  { label: 'claude-haiku-4-5',  description: 'Fastest, cheapest', value: 'claude-haiku-4-5-20251001' },
];

export async function addAgentCommand(): Promise<void> {
  const ctx = await loadOrInit();
  if (!ctx) { return; }
  const { root, doc } = ctx;

  if (doc.skills.length === 0) {
    const choice = await vscode.window.showWarningMessage(
      'No skills available — add a skill first, then assign it to an agent.',
      'Add Skill',
    );
    if (choice === 'Add Skill') {
      void vscode.commands.executeCommand('aidlc.addSkill');
    }
    return;
  }

  const agentId = await promptUniqueId({
    prompt: 'Agent id',
    placeholder: 'e.g. doc-writer (lowercase, dashes ok)',
    existing: existingIds(doc.agents),
  });
  if (!agentId) { return; }

  const name = await vscode.window.showInputBox({
    prompt: 'Display name',
    placeHolder: 'e.g. "Documentation Writer"',
    value: agentId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    ignoreFocusOut: true,
  });
  if (!name || !name.trim()) { return; }

  const skillPick = await vscode.window.showQuickPick(
    doc.skills.map((s) => {
      const id = String(s.id);
      const src = s.builtin
        ? 'builtin'
        : (typeof s.path === 'string' ? s.path : '(no source)');
      return { label: id, description: src };
    }),
    { placeHolder: 'Pick the skill this agent uses', ignoreFocusOut: true },
  );
  if (!skillPick) { return; }

  const modelPick = await vscode.window.showQuickPick(MODEL_CHOICES, {
    placeHolder: 'Pick a Claude model',
    ignoreFocusOut: true,
  });
  if (!modelPick) { return; }

  const env = await collectEnvVars();
  if (env === undefined) { return; }  // user cancelled

  const capabilities = await collectCapabilities();
  if (capabilities === undefined) { return; }

  const agent: Record<string, unknown> = {
    id: agentId,
    name: name.trim(),
    skill: skillPick.label,
    model: modelPick.value,
  };
  if (Object.keys(env).length > 0) { agent.env = env; }
  if (capabilities.length > 0) { agent.capabilities = capabilities; }

  doc.agents.push(agent);
  writeYaml(root, doc);

  const extras: string[] = [];
  if (Object.keys(env).length > 0) { extras.push(`${Object.keys(env).length} env var(s)`); }
  if (capabilities.length > 0) { extras.push(`${capabilities.length} capability${capabilities.length === 1 ? '' : 'ies'}`); }
  const extraNote = extras.length > 0 ? ` · ${extras.join(', ')}` : '';

  void vscode.window.showInformationMessage(
    `Agent \`${agentId}\` added (skill: ${skillPick.label}, model: ${modelPick.label})${extraNote}.`,
  );
}

// ── Sub-wizards used by addAgent ────────────────────────────────────────

/**
 * Loop letting the user add KEY=value env overrides for this agent.
 * Returns `undefined` if the user explicitly cancels (Esc on a top-level
 * QuickPick), `{}` if they skip. The empty case is preserved as `{}` so
 * the caller can decide whether to attach `env:` to the YAML at all.
 */
async function collectEnvVars(): Promise<Record<string, string> | undefined> {
  const wantsEnv = await vscode.window.showQuickPick(
    [
      { label: '$(check) No env vars', detail: 'Use workspace-level environment as-is', value: 'no' as const },
      { label: '$(plus) Add env vars', detail: 'Set per-agent overrides (e.g. JIRA_TICKET_KEY, BASE_URL)', value: 'yes' as const },
    ],
    { placeHolder: 'Per-agent environment overrides?', ignoreFocusOut: true },
  );
  if (!wantsEnv) { return undefined; }
  if (wantsEnv.value === 'no') { return {}; }

  const env: Record<string, string> = {};
  while (true) {
    const key = await vscode.window.showInputBox({
      prompt: `Env var name (or empty to finish — ${Object.keys(env).length} added)`,
      placeHolder: 'e.g. JIRA_TICKET_KEY',
      ignoreFocusOut: true,
      validateInput: (v) => {
        const t = v.trim();
        if (!t) { return null; }  // empty = finish
        if (!/^[A-Z_][A-Z0-9_]*$/.test(t)) {
          return 'Convention: uppercase letters, digits, underscores. Must start with letter or underscore.';
        }
        return null;
      },
    });
    if (key === undefined) { return undefined; }
    if (!key.trim()) { break; }

    const value = await vscode.window.showInputBox({
      prompt: `Value for ${key.trim()}`,
      placeHolder: 'literal value, or `${env:OTHER_VAR}` to read from OS env',
      ignoreFocusOut: true,
    });
    if (value === undefined) { return undefined; }
    env[key.trim()] = value;
  }
  return env;
}

/**
 * Capabilities = read-permissions the agent gets at run time. Multi-pick
 * from a curated list of well-known sources, plus the option to type a
 * custom one. Concrete values (specific Jira key / Figma file URL / etc.)
 * are NOT collected here — they belong to the per-run / per-epic flow.
 */
const KNOWN_CAPABILITIES: Array<{ id: string; label: string; detail: string }> = [
  { id: 'jira',          label: '$(symbol-misc) Jira',          detail: 'Read Jira issues + projects (specific ticket supplied per-run)' },
  { id: 'figma',         label: '$(symbol-color) Figma',        detail: 'Read Figma files + designs (specific file supplied per-run)' },
  { id: 'core-business', label: '$(book) Core business docs',   detail: "Read this project's core business docs (path inferred or set later)" },
  { id: 'github',        label: '$(github) GitHub',             detail: 'Read repos / PRs / issues' },
  { id: 'slack',         label: '$(comment-discussion) Slack',  detail: 'Read Slack channels / threads' },
  { id: 'files',         label: '$(file-directory) Files',      detail: 'Read arbitrary project files (glob supplied per-run)' },
  { id: 'web',           label: '$(globe) Web',                 detail: 'Web search / fetch URLs' },
];

async function collectCapabilities(): Promise<string[] | undefined> {
  const picks = await vscode.window.showQuickPick(
    KNOWN_CAPABILITIES.map((c) => ({ label: c.label, description: c.id, detail: c.detail, id: c.id })),
    {
      placeHolder: 'What can this agent access? (multi-select, or skip with Enter on empty)',
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  // QuickPick returns undefined on Esc, [] on empty confirm. Treat both gracefully.
  if (picks === undefined) { return undefined; }

  const capabilities = picks.map((p) => p.id);

  // Optional: let user add ad-hoc custom capabilities not in the canned list.
  while (true) {
    const more = await vscode.window.showQuickPick(
      [
        { label: '$(check) Done', detail: `Save with ${capabilities.length} capabilit${capabilities.length === 1 ? 'y' : 'ies'}`, value: 'done' as const },
        { label: '$(plus) Add custom capability…', detail: 'Type a free-form id (e.g. "stripe-api", "linear", "notion")', value: 'custom' as const },
      ],
      { placeHolder: 'Add another capability?', ignoreFocusOut: true },
    );
    if (!more || more.value === 'done') { break; }

    const custom = await vscode.window.showInputBox({
      prompt: 'Custom capability id',
      placeHolder: 'e.g. stripe-api (lowercase, dashes ok)',
      ignoreFocusOut: true,
      validateInput: (v) => {
        const t = v.trim();
        if (!t) { return null; }
        if (!/^[a-z][a-z0-9-]*$/.test(t)) {
          return 'Lowercase letters / digits / dashes only — must start with a letter';
        }
        if (capabilities.includes(t)) { return `\`${t}\` already added`; }
        return null;
      },
    });
    if (custom === undefined) { return undefined; }
    if (custom.trim()) { capabilities.push(custom.trim()); }
  }

  return capabilities;
}

// ── per-step config prompts ─────────────────────────────────────────────

export interface PipelineStepConfigDraft {
  agent: string;
  enabled: boolean;
  requires: string[];
  produces: string[];
  human_review: boolean;
  auto_review: boolean;
  auto_review_runner?: string;
}

/**
 * Walk the user through configuring one pipeline step's gates and artifacts.
 * Used both by `addPipelineCommand` (Advanced mode) and `editStepConfig`
 * triggered from the Builder webview.
 *
 * `defaults` pre-fills each prompt — pass the existing step's normalized
 * config when editing, omit when creating. Returns undefined if the user
 * cancels at any prompt; callers should abort the whole flow on undefined
 * rather than write a half-configured step.
 */
export async function promptStepConfig(
  agentId: string,
  defaults?: Partial<PipelineStepConfigDraft>,
): Promise<PipelineStepConfigDraft | undefined> {
  const enabled = await vscode.window.showQuickPick(
    [
      { label: 'Yes', description: 'Step runs as part of the pipeline', value: true },
      { label: 'No',  description: 'Step stays in pipeline.yaml but the runner skips it', value: false },
    ],
    { placeHolder: `[${agentId}] enabled?`, ignoreFocusOut: true },
  );
  if (!enabled) { return undefined; }

  const requires = await vscode.window.showInputBox({
    prompt: `[${agentId}] requires — comma-separated upstream artifact paths (use {epic} for run context)`,
    placeHolder: 'e.g. docs/sdlc/epics/{epic}/PRD.md',
    ignoreFocusOut: true,
    value: defaults?.requires ? defaults.requires.join(', ') : '',
  });
  if (requires === undefined) { return undefined; }

  const produces = await vscode.window.showInputBox({
    prompt: `[${agentId}] produces — comma-separated output artifact paths`,
    placeHolder: 'e.g. docs/sdlc/epics/{epic}/TECH-DESIGN.md',
    ignoreFocusOut: true,
    value: defaults?.produces ? defaults.produces.join(', ') : '',
  });
  if (produces === undefined) { return undefined; }

  const humanReview = await vscode.window.showQuickPick(
    [
      { label: 'Yes', description: 'Pause for manual approval after the step is marked done', value: true },
      { label: 'No',  description: 'Auto-advance after produces validate (and after auto-review, if enabled)', value: false },
    ],
    {
      placeHolder: `[${agentId}] human review?` + (defaults?.human_review !== undefined ? ` (currently: ${defaults.human_review ? 'Yes' : 'No'})` : ''),
      ignoreFocusOut: true,
    },
  );
  if (!humanReview) { return undefined; }

  const autoReview = await vscode.window.showQuickPick(
    [
      { label: 'No',  description: 'No automated validator', value: false },
      { label: 'Yes', description: 'Run a JS/TS validator script after produces validate, before any human gate', value: true },
    ],
    {
      placeHolder: `[${agentId}] auto review?` + (defaults?.auto_review !== undefined ? ` (currently: ${defaults.auto_review ? 'Yes' : 'No'})` : ''),
      ignoreFocusOut: true,
    },
  );
  if (!autoReview) { return undefined; }

  let autoReviewRunner: string | undefined;
  if (autoReview.value) {
    autoReviewRunner = await vscode.window.showInputBox({
      prompt: `[${agentId}] auto_review_runner — path to validator script (relative to workspace root)`,
      placeHolder: '.aidlc/scripts/validate-' + agentId + '.mjs',
      value: defaults?.auto_review_runner ?? '',
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length === 0 ? 'Required when auto_review is enabled' : null),
    });
    if (autoReviewRunner === undefined) { return undefined; }
  }

  const splitCsv = (s: string): string[] =>
    s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);

  return {
    agent: agentId,
    enabled: enabled.value,
    requires: splitCsv(requires),
    produces: splitCsv(produces),
    human_review: humanReview.value,
    auto_review: autoReview.value,
    auto_review_runner: autoReviewRunner?.trim() || undefined,
  };
}

// ── addPipeline ─────────────────────────────────────────────────────────

export async function addPipelineCommand(): Promise<void> {
  const ctx = await loadOrInit();
  if (!ctx) { return; }
  const { root, doc } = ctx;

  if (doc.agents.length < 2) {
    const choice = await vscode.window.showWarningMessage(
      'Need at least 2 agents to make a pipeline. Add more agents first.',
      'Add Agent',
    );
    if (choice === 'Add Agent') {
      void vscode.commands.executeCommand('aidlc.addAgent');
    }
    return;
  }

  const pipelineId = await promptUniqueId({
    prompt: 'Pipeline id',
    placeholder: 'e.g. full-migration',
    existing: existingIds(doc.pipelines),
  });
  if (!pipelineId) { return; }

  // VS Code QuickPick with canPickMany + ordering: pickers preserve toggle
  // order, but to be explicit we ask the user to confirm the order in a
  // follow-up step. Most users will accept the toggle order.
  const allAgents = doc.agents.map((a) => ({
    label: String(a.id),
    description: typeof a.name === 'string' ? a.name : '',
  }));

  const picked = await vscode.window.showQuickPick(allAgents, {
    placeHolder: 'Pick agents for this pipeline (in execution order)',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picked || picked.length === 0) { return; }

  const onFailure = await vscode.window.showQuickPick(
    [
      { label: 'stop', description: 'Halt the pipeline on first agent failure (default)', value: 'stop' as const },
      { label: 'continue', description: 'Run remaining agents even if one fails', value: 'continue' as const },
    ],
    { placeHolder: 'On failure behavior', ignoreFocusOut: true },
  );
  if (!onFailure) { return; }

  // Per-step config: ask once whether to configure gates per step, or use
  // bare-string steps (default — quick path). Configured steps let the user
  // toggle human_review / auto_review / requires / produces.
  const wantConfig = await vscode.window.showQuickPick(
    [
      { label: 'Quick — bare steps', description: 'Steps run sequentially with no gates. You can edit YAML later to add review gates.', value: false },
      { label: 'Advanced — configure each step', description: 'Toggle human review, auto review, requires/produces paths per step.', value: true },
    ],
    { placeHolder: 'Pipeline configuration mode', ignoreFocusOut: true },
  );
  if (wantConfig === undefined) { return; }

  let steps: unknown[];
  if (!wantConfig.value) {
    steps = picked.map((p) => p.label);
  } else {
    steps = [];
    for (const p of picked) {
      const stepCfg = await promptStepConfig(p.label);
      if (!stepCfg) { return; } // user cancelled mid-flow — abort whole wizard
      steps.push(stepCfg);
    }
  }

  doc.pipelines.push({
    id: pipelineId,
    steps,
    on_failure: onFailure.value,
  });
  writeYaml(root, doc);

  void vscode.window.showInformationMessage(
    `Pipeline \`${pipelineId}\` added: ${picked.map((p) => p.label).join(' → ')}`,
  );
}
