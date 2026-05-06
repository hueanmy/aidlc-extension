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
import * as os from 'os';
import * as path from 'path';

import { readYaml, writeYaml, existingIds, type YamlDocument } from './yamlIO';
import { SKILL_TEMPLATES, type SkillTemplate } from './skillTemplates';

import {
  WORKSPACE_FILENAME,
  discoverAssets,
  targetPath,
  type AssetScope,
  type AssetKind,
} from '@aidlc/core';

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

// ── Scope picker ────────────────────────────────────────────────────────

/**
 * Ask the user where to save a new skill / agent. The three scopes map to
 * different on-disk locations and have different sharing semantics:
 *
 *   - project → `<ws>/.claude/...`        committable, this project only
 *   - aidlc   → `<ws>/.aidlc/...`         committable, shared with team via the
 *                                         AIDLC framework (also entered into
 *                                         workspace.yaml)
 *   - global  → `~/.claude/...`           personal, every project on this machine
 *
 * Defaults to **project** because that matches what users want most often
 * — the "I want this to live with the code I'm working on" case.
 */
async function pickScope(kind: AssetKind): Promise<AssetScope | undefined> {
  const noun = kind === 'skill' ? 'skill' : 'agent';
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: '$(folder) Project',
        description: '.claude/' + noun + 's/',
        detail:
          `Project-local ${noun}. Commit to repo, applies to **this project only**. ` +
          `Use for domain-specific tooling (deploy scripts, project conventions, etc.).`,
        value: 'project' as AssetScope,
      },
      {
        label: '$(package) AIDLC',
        description: '.aidlc/' + noun + 's/',
        detail:
          `AIDLC framework ${noun}. Commit to repo, declared in workspace.yaml, ` +
          `share with team via the SDLC pipeline (epic, prd, tech-design, review, release...).`,
        value: 'aidlc' as AssetScope,
      },
      {
        label: '$(home) Global',
        description: '~/.claude/' + noun + 's/',
        detail:
          `Personal ${noun}. Stored in your home directory, available on **every project** ` +
          `on this machine. Not committed. Use for personal helpers and habits.`,
        value: 'global' as AssetScope,
      },
    ],
    {
      placeHolder: `Where do you want to save this ${noun}?`,
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  return choice?.value;
}

/**
 * Build the union of taken ids across all 3 scopes, plus (for skills) the
 * workspace.yaml `skills[]` declarations. Used by the wizard's id-prompt so
 * the same id can't collide with an existing file in any scope.
 */
function takenIdsForKind(
  workspaceRoot: string,
  doc: YamlDocument,
  kind: AssetKind,
): Set<string> {
  const taken = new Set<string>();
  const discovered = discoverAssets(workspaceRoot);
  const list = kind === 'skill' ? discovered.skills : discovered.agents;
  for (const a of list) { taken.add(a.id); }
  if (kind === 'skill') {
    for (const id of existingIds(doc.skills)) { taken.add(id); }
  } else {
    for (const id of existingIds(doc.agents)) { taken.add(id); }
  }
  return taken;
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

  const scope = await pickScope('skill');
  if (!scope) { return; }

  const skillId = await promptUniqueId({
    prompt: 'Skill id',
    placeholder: 'e.g. code-reviewer (lowercase, dashes ok)',
    existing: takenIdsForKind(root, doc, 'skill'),
  });
  if (!skillId) { return; }

  const source = await pickSkillSource();
  if (!source) { return; }

  const skillPath = targetPath(root, scope, 'skill', skillId);

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

  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  if (fs.existsSync(skillPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${displayPath(root, skillPath)} already exists. Overwrite?`,
      'Overwrite', 'Cancel',
    );
    if (overwrite !== 'Overwrite') { return; }
  }
  fs.writeFileSync(skillPath, content, 'utf8');

  // AIDLC scope is the only one that registers in workspace.yaml — the
  // pipeline runner reads agents/skills from there. Project + global skills
  // are file-only catalog entries (sit alongside Claude Code's own
  // .claude/ skills) and are surfaced through the discovery layer.
  if (scope === 'aidlc') {
    doc.skills.push({
      id: skillId,
      path: `./.aidlc/skills/${skillId}.md`,
    });
    writeYaml(root, doc);
  }

  // Open the file so the user can edit it. Always for `blank`, optional for
  // `template` (so they can copy/paste before tweaking).
  if (openInEditor || source.kind === 'template') {
    const docOpen = await vscode.workspace.openTextDocument(skillPath);
    await vscode.window.showTextDocument(docOpen, { preview: false });
  }

  const yamlNote = scope === 'aidlc' ? ' + workspace.yaml' : '';
  void vscode.window.showInformationMessage(
    `Skill \`${skillId}\` added (${scope}) — ${displayPath(root, skillPath)}${yamlNote}.`,
  );
}

/**
 * Workspace-relative path when the file is inside the workspace, otherwise
 * a `~`-prefixed home-relative path. Used in user-facing notifications so
 * paths stay readable regardless of scope.
 */
function displayPath(workspaceRoot: string, abs: string): string {
  if (abs.startsWith(workspaceRoot + path.sep)) {
    return path.relative(workspaceRoot, abs);
  }
  const home = os.homedir();
  if (abs.startsWith(home + path.sep)) {
    return '~/' + path.relative(home, abs);
  }
  return abs;
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

  const scope = await pickScope('agent');
  if (!scope) { return; }

  // Every agent — aidlc, project, or global — must reference at least one
  // skill at creation time. AIDLC agents resolve skills at runtime; project
  // and global agents inline the picked skills' content into the .md body
  // as a starting prompt the user can then edit.
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
    existing: takenIdsForKind(root, doc, 'agent'),
  });
  if (!agentId) { return; }

  const name = await vscode.window.showInputBox({
    prompt: 'Display name',
    placeHolder: 'e.g. "Documentation Writer"',
    value: agentId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    ignoreFocusOut: true,
  });
  if (!name || !name.trim()) { return; }

  if (scope === 'aidlc') {
    await addAidlcAgent(root, doc, agentId, name.trim());
  } else {
    await addClaudeAgent(root, doc, scope, agentId, name.trim());
  }
}

/**
 * Multi-select skill picker. Returns the picked skill ids, or undefined
 * if the user cancels (Esc or Enter with nothing selected — both treated
 * as "abort the wizard"). Shared by aidlc and Claude-native agent flows.
 */
async function pickSkills(doc: YamlDocument): Promise<string[] | undefined> {
  const skillPicks = await vscode.window.showQuickPick(
    doc.skills.map((s) => {
      const id = String(s.id);
      const src = s.builtin
        ? 'builtin'
        : (typeof s.path === 'string' ? s.path : '(no source)');
      return { label: id, description: src };
    }),
    {
      placeHolder: 'Pick one or more skills this agent uses (space to toggle, enter to confirm)',
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  if (!skillPicks || skillPicks.length === 0) {
    if (skillPicks && skillPicks.length === 0) {
      void vscode.window.showWarningMessage('Agent must reference at least one skill — wizard cancelled.');
    }
    return undefined;
  }
  return skillPicks.map((p) => p.label);
}

/**
 * Read a skill's markdown content from disk for inlining into a Claude
 * Code native agent file. Returns the raw content with any leading
 * frontmatter block stripped (so it doesn't collide with the agent's own
 * frontmatter). Builtin skills and missing files return a `reason` the
 * caller can surface as a placeholder comment.
 */
function loadSkillContentForInline(
  root: string,
  doc: YamlDocument,
  skillId: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  const decl = doc.skills.find((s) => String(s.id) === skillId);
  if (!decl) { return { ok: false, reason: 'no declaration in workspace.yaml' }; }
  if (decl.builtin) { return { ok: false, reason: 'builtin skill — content not available to inline' }; }
  const declPath = typeof decl.path === 'string' ? decl.path : '';
  if (!declPath) { return { ok: false, reason: 'skill has no path' }; }
  const resolved = path.isAbsolute(declPath) ? declPath : path.resolve(root, declPath);
  if (!fs.existsSync(resolved)) { return { ok: false, reason: `file not found at ${declPath}` }; }
  const raw = fs.readFileSync(resolved, 'utf8');
  // Strip a leading `---\n…\n---` frontmatter block so the inlined skill
  // doesn't introduce stray frontmatter inside the agent body.
  const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return { ok: true, content: stripped.trim() };
}

/**
 * AIDLC-scope agent: declared in workspace.yaml, referenced by pipelines.
 * Walks the user through skill / model / env / capabilities pickers (the
 * existing flow before scope was introduced) and appends the result to
 * `agents[]`.
 */
async function addAidlcAgent(
  root: string,
  doc: YamlDocument,
  agentId: string,
  name: string,
): Promise<void> {
  const skillIds = await pickSkills(doc);
  if (!skillIds) { return; }

  const modelPick = await vscode.window.showQuickPick(MODEL_CHOICES, {
    placeHolder: 'Pick a Claude model',
    ignoreFocusOut: true,
  });
  if (!modelPick) { return; }

  const env = await collectEnvVars();
  if (env === undefined) { return; }

  const capabilities = await collectCapabilities();
  if (capabilities === undefined) { return; }

  const agent: Record<string, unknown> = {
    id: agentId,
    name,
    skills: skillIds,
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

  const skillsLabel = skillIds.join(', ');
  void vscode.window.showInformationMessage(
    `Agent \`${agentId}\` added (aidlc · skills: ${skillsLabel}, model: ${modelPick.label})${extraNote}.`,
  );
}

/**
 * Project- or global-scope agent: a Claude Code native `.md` file. The
 * file's contents ARE the agent's prompt. Matches the convention of files
 * in `.claude/agents/` / `~/.claude/agents/` so users get a unified catalog.
 *
 * Skills picked here are inlined into the body as a starting prompt — the
 * file is a snapshot, not a live reference, so the user can edit freely
 * after creation without affecting the source skill.
 */
async function addClaudeAgent(
  root: string,
  doc: YamlDocument,
  scope: AssetScope,
  agentId: string,
  name: string,
): Promise<void> {
  const skillIds = await pickSkills(doc);
  if (!skillIds) { return; }

  const description = await vscode.window.showInputBox({
    prompt: 'One-line description (used by Claude Code to decide when to invoke this agent)',
    placeHolder: 'e.g. "Reviews TypeScript code for type-safety issues"',
    ignoreFocusOut: true,
  });
  if (description === undefined) { return; }

  const agentPath = targetPath(root, scope, 'agent', agentId);
  fs.mkdirSync(path.dirname(agentPath), { recursive: true });

  if (fs.existsSync(agentPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${displayPath(root, agentPath)} already exists. Overwrite?`,
      'Overwrite', 'Cancel',
    );
    if (overwrite !== 'Overwrite') { return; }
  }

  const sections: string[] = [];
  for (const id of skillIds) {
    sections.push(`<!-- ── Skill: ${id} ── -->`);
    const result = loadSkillContentForInline(root, doc, id);
    sections.push(result.ok
      ? result.content
      : `<!-- TODO: paste content for skill "${id}" — ${result.reason} -->`);
    sections.push('');
  }

  const desc = description.trim() || `${name} agent.`;
  const content =
`---
name: ${agentId}
description: ${desc}
---

# ${name}

${sections.join('\n').trimEnd()}
`;

  fs.writeFileSync(agentPath, content, 'utf8');

  const docOpen = await vscode.workspace.openTextDocument(agentPath);
  await vscode.window.showTextDocument(docOpen, { preview: false });

  const skillsLabel = skillIds.join(', ');
  void vscode.window.showInformationMessage(
    `Agent \`${agentId}\` added (${scope} · skills: ${skillsLabel}) — ${displayPath(root, agentPath)}.`,
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
