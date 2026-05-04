/**
 * `aidlc.savePreset` and `aidlc.applyPreset` wizards.
 *
 *   savePreset  — capture the current project's workspace.yaml + skill .md
 *                 into a globalStorage preset. Prompts for name/description.
 *
 *   applyPreset — pick from saved presets and scaffold the current project's
 *                 .aidlc/ from it. Confirms before overwriting any file
 *                 that already exists.
 *
 * Both commands target the *active* workspace folder. They warn (not pick a
 * folder) when nothing is open, matching the simplification we did for
 * Init / Show.
 */

import * as vscode from 'vscode';
import * as path from 'path';

import { readYaml, writeYaml } from './yamlIO';
import { PresetStore, type WorkspacePreset } from './presetStore';
import { isBuiltinPreset } from './builtinPresets';

function getRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function requireRoot(action: string): string | undefined {
  const root = getRoot();
  if (!root) {
    void vscode.window.showWarningMessage(
      `AIDLC: Open a project first — ${action} targets the active workspace folder.`,
    );
    return undefined;
  }
  return root;
}

// ── savePreset ───────────────────────────────────────────────────────────

export async function savePresetCommand(store: PresetStore): Promise<void> {
  const root = requireRoot('Save Preset');
  if (!root) { return; }

  const doc = readYaml(root);
  if (!doc) {
    void vscode.window.showWarningMessage(
      'AIDLC: No .aidlc/workspace.yaml in this project — initialize one before saving as a preset.',
    );
    return;
  }
  if (doc.agents.length === 0 && doc.skills.length === 0 && doc.pipelines.length === 0) {
    const cont = await vscode.window.showWarningMessage(
      'Workspace is empty (0 agents, 0 skills, 0 pipelines). Save anyway?',
      { modal: false },
      'Save', 'Cancel',
    );
    if (cont !== 'Save') { return; }
  }

  const existing = store.list(root);
  const existingIds = new Set(existing.map((p) => p.id));

  const id = await vscode.window.showInputBox({
    prompt: 'Preset id',
    placeHolder: 'e.g. qa-automation (lowercase, dashes ok)',
    value: typeof doc.name === 'string'
      ? doc.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
      : '',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) { return 'Required'; }
      if (!/^[a-z][a-z0-9-]*$/.test(t)) {
        return 'Lowercase letters / digits / dashes only — must start with a letter';
      }
      if (isBuiltinPreset(t)) {
        return `\`${t}\` is reserved for a built-in preset — pick a different id`;
      }
      return null;
    },
  });
  if (!id) { return; }

  if (existingIds.has(id)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Preset \`${id}\` already exists. Overwrite?`,
      { modal: false },
      'Overwrite', 'Cancel',
    );
    if (overwrite !== 'Overwrite') { return; }
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Display name',
    placeHolder: 'e.g. "QA Automation Pipeline"',
    value: typeof doc.name === 'string' ? doc.name : id,
    ignoreFocusOut: true,
  });
  if (!name || !name.trim()) { return; }

  const description = await vscode.window.showInputBox({
    prompt: 'One-line description (optional)',
    placeHolder: 'e.g. "Cypress → Playwright converter + doc writer"',
    ignoreFocusOut: true,
  });
  if (description === undefined) { return; }

  const preset = PresetStore.buildFromWorkspace(root, doc, {
    id: id.trim(),
    name: name.trim(),
    description: description.trim(),
  });
  store.save(root, preset);

  const skillCount = Object.keys(preset.skillContents).length;
  void vscode.window.showInformationMessage(
    `Saved preset \`${id}\` (${doc.agents.length} agents, ${skillCount} skills, ${doc.pipelines.length} pipelines).`,
  );
}

// ── applyPreset ──────────────────────────────────────────────────────────

/**
 * Apply a preset. When `presetId` is given (sidebar click), skip the quick-
 * pick and apply that one directly. Without it, the command shows the
 * picker (command-palette / Builder button entry points).
 */
export async function applyPresetCommand(
  store: PresetStore,
  presetId?: string,
): Promise<void> {
  const root = requireRoot('Apply Preset');
  if (!root) { return; }

  const presets = store.list(root);
  if (presets.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No templates saved yet. Build a workspace first, then use "Save Template" to capture it.',
      'Init Sample Workspace',
    );
    if (choice === 'Init Sample Workspace') {
      void vscode.commands.executeCommand('aidlc.initWorkspace');
    }
    return;
  }

  let preset: WorkspacePreset | undefined;
  if (presetId) {
    preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      void vscode.window.showWarningMessage(
        `AIDLC: template \`${presetId}\` not found. It may have been deleted.`,
      );
      return;
    }
  } else {
    const picked = await vscode.window.showQuickPick(
      presets.map((p) => ({
        label: p.builtin ? `$(verified) ${p.name}` : p.name,
        description: p.builtin ? `${p.id} · built-in` : `${p.id} · project`,
        detail: presetDetailLine(p),
        preset: p,
      })),
      { placeHolder: 'Pick a template to apply', ignoreFocusOut: true, matchOnDetail: true },
    );
    if (!picked) { return; }
    preset = picked.preset;
  }

  const existing = readYaml(root);
  let overwrite = false;
  if (existing) {
    const choice = await vscode.window.showWarningMessage(
      `This project already has .aidlc/workspace.yaml. Overwrite with preset \`${preset.id}\`?`,
      { modal: false },
      'Overwrite', 'Cancel',
    );
    if (choice !== 'Overwrite') { return; }
    overwrite = true;
  }

  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? path.basename(root);
  const result = PresetStore.applyTo(root, preset, workspaceName, { overwrite });

  if (result.written.length === 0 && result.skipped.length > 0) {
    void vscode.window.showWarningMessage(
      `Nothing applied — ${result.skipped.length} file(s) already existed and overwrite was off.`,
    );
    return;
  }

  void vscode.window
    .showInformationMessage(
      `Applied preset \`${preset.id}\` (${result.written.length} files written).`,
      'Open Builder',
    )
    .then((choice) => {
      if (choice === 'Open Builder') {
        void vscode.commands.executeCommand('aidlc.openBuilder');
      }
    });
}

// ── deletePreset ─────────────────────────────────────────────────────────

export async function deletePresetCommand(store: PresetStore): Promise<void> {
  const root = requireRoot('Delete Template');
  if (!root) { return; }

  // Only user (project) templates are deletable. Built-ins ship with the
  // extension and stay read-only — re-installing brings them back.
  const userPresets = store.list(root).filter((p) => !p.builtin);
  if (userPresets.length === 0) {
    void vscode.window.showInformationMessage(
      'No project templates to delete (built-in templates are read-only).',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    userPresets.map((p) => ({
      label: p.name,
      description: p.id + ' · project',
      detail: presetDetailLine(p),
      preset: p,
    })),
    { placeHolder: 'Pick a project template to delete', ignoreFocusOut: true },
  );
  if (!picked) { return; }

  const confirm = await vscode.window.showWarningMessage(
    `Delete template \`${picked.preset.id}\` from this project? This cannot be undone.`,
    { modal: false },
    'Delete', 'Cancel',
  );
  if (confirm !== 'Delete') { return; }

  store.delete(root, picked.preset.id);
  void vscode.window.showInformationMessage(`Deleted template \`${picked.preset.id}\`.`);
}

function presetDetailLine(p: WorkspacePreset): string {
  const agents = (p.workspace.agents as unknown[]) ?? [];
  const pipelines = (p.workspace.pipelines as unknown[]) ?? [];
  const counts = [
    `${agents.length} agents`,
    `${Object.keys(p.skillContents).length} skills`,
    `${pipelines.length} pipelines`,
  ].join(' · ');
  const desc = p.description ? ` — ${p.description}` : '';
  return `${counts}${desc}`;
}
