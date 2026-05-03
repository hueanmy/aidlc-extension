/**
 * v2 demo commands — exercises @aidlc/core in the extension host so the user
 * can see Phase 1 actually working before Phase 2 rewires the whole sidebar.
 *
 * Two commands:
 *   aidlc.showWorkspaceConfig — load .aidlc/workspace.yaml + dump parsed config
 *                               to the Output channel.
 *   aidlc.initWorkspace       — scaffold a starter workspace.yaml + sample
 *                               skill so the user has something to load.
 *
 * Both are namespaced `aidlc.*` (not `cfPipeline.*`) to mark the v2 boundary.
 * The legacy SDLC pipeline keeps its existing namespace untouched.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import {
  WorkspaceLoader,
  WorkspaceNotFoundError,
  WorkspaceParseError,
  WorkspaceValidationError,
  WORKSPACE_DIR,
  WORKSPACE_FILENAME,
} from '@aidlc/core';

import {
  addSkillCommand,
  addAgentCommand,
  addPipelineCommand,
} from './wizards';
import { BuilderPanel } from './builderWebview';
import { PresetStore } from './presetStore';
import {
  savePresetCommand,
  applyPresetCommand,
  deletePresetCommand,
} from './presetWizards';
import { loadSdlcPreset } from './builtinPresets';
import { startEpicCommand } from './epicWizard';
import { EpicsPanel } from './epicsPanelWebview';
import { insertDemoEpicCommand } from './demoEpic';

/**
 * Build the starter workspace.yaml. `name:` is set to the user's folder
 * name so the Builder / sidebar header reads naturally instead of showing
 * a hardcoded "My AIDLC Workspace" label.
 */
function sampleWorkspaceYaml(workspaceName: string): string {
  // Quote the name to handle spaces, dashes, and unicode safely. js-yaml
  // would handle this on round-trip but we hand-write the template here.
  const escapedName = workspaceName.replace(/"/g, '\\"');
  return `version: "1.0"
name: "${escapedName}"

agents:
  - id: hello
    name: "Hello World Agent"
    skill: hello-skill
    model: claude-sonnet-4-5

skills:
  - id: hello-skill
    path: ./.aidlc/skills/hello-skill.md

environment: {}

slash_commands:
  - name: "/hello"
    agent: hello

sidebar:
  views:
    - type: agents-list
    - type: skills-list
`;
}

const SAMPLE_HELLO_SKILL = `# Hello World Skill

You are a friendly assistant. Greet the user warmly and ask what they would
like help with today. Keep your reply to two sentences.
`;

export function registerV2WorkspaceCommands(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): { disposables: vscode.Disposable[]; presetStore: PresetStore } {
  const showCmd = vscode.commands.registerCommand(
    'aidlc.showWorkspaceConfig',
    () => showWorkspaceConfig(output),
  );

  const initCmd = vscode.commands.registerCommand(
    'aidlc.initWorkspace',
    () => initWorkspace(output),
  );

  const addSkillCmd = vscode.commands.registerCommand(
    'aidlc.addSkill',
    () => addSkillCommand(),
  );

  const addAgentCmd = vscode.commands.registerCommand(
    'aidlc.addAgent',
    () => addAgentCommand(),
  );

  const addPipelineCmd = vscode.commands.registerCommand(
    'aidlc.addPipeline',
    () => addPipelineCommand(),
  );

  const openBuilderCmd = vscode.commands.registerCommand(
    'aidlc.openBuilder',
    () => BuilderPanel.show(context.extensionUri),
  );

  // Preset library — single store instance shared across all preset commands
  // and the Builder panel. User templates live in `<project>/.aidlc/templates/`
  // (project-scoped, committable). Built-ins are loaded from the extension.
  const presetStore = new PresetStore();
  presetStore.setBuiltinLoader(() => [loadSdlcPreset(context.extensionPath)]);

  const savePresetCmd = vscode.commands.registerCommand(
    'aidlc.savePreset',
    () => savePresetCommand(presetStore),
  );

  const applyPresetCmd = vscode.commands.registerCommand(
    'aidlc.applyPreset',
    (presetId?: unknown) =>
      applyPresetCommand(
        presetStore,
        typeof presetId === 'string' ? presetId : undefined,
      ),
  );

  const deletePresetCmd = vscode.commands.registerCommand(
    'aidlc.deletePreset',
    () => deletePresetCommand(presetStore),
  );

  const startEpicCmd = vscode.commands.registerCommand(
    'aidlc.startEpic',
    () => startEpicCommand(),
  );

  const openEpicsListCmd = vscode.commands.registerCommand(
    'aidlc.openEpicsList',
    () => EpicsPanel.show(context.extensionUri),
  );

  const insertDemoEpicCmd = vscode.commands.registerCommand(
    'aidlc.insertDemoEpic',
    () => insertDemoEpicCommand(),
  );

  // Reuses an existing terminal if one is open so the user doesn't end up
  // with a stack of Claude REPLs after multiple clicks.
  const openClaudeTerminalCmd = vscode.commands.registerCommand(
    'aidlc.openClaudeTerminal',
    () => {
      const TERMINAL_NAME = 'AIDLC · Claude';
      const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
      if (existing) { existing.show(false); return; }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const cwd = root && fs.existsSync(root) ? root : undefined;
      const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        cwd,
        shellPath: '/bin/zsh',
        iconPath: new vscode.ThemeIcon('rocket'),
        location: vscode.TerminalLocation.Panel,
      });
      terminal.show(false);
      terminal.sendText('claude', true);
    },
  );

  return {
    disposables: [
      showCmd,
      initCmd,
      addSkillCmd,
      addAgentCmd,
      addPipelineCmd,
      openBuilderCmd,
      openClaudeTerminalCmd,
      savePresetCmd,
      applyPresetCmd,
      deletePresetCmd,
      startEpicCmd,
      openEpicsListCmd,
      insertDemoEpicCmd,
    ],
    presetStore,
  };
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Require a workspace folder. If none is open, show a warning that points
 * the user back to the sidebar's Open Project flow. We don't surface a
 * folder picker here because Init / Apply / Save commands are explicitly
 * scoped to the *currently active* project — switching projects is its
 * own action (sidebar ⇄ button or "Switch Project" command).
 */
function requireWorkspaceRoot(): string | undefined {
  const root = getWorkspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage(
      'AIDLC: Open a project first — this command targets the currently active workspace folder.',
    );
    return undefined;
  }
  return root;
}

async function showWorkspaceConfig(output: vscode.OutputChannel): Promise<void> {
  const root = requireWorkspaceRoot();
  if (!root) { return; }

  try {
    const loaded = WorkspaceLoader.load(root);

    output.clear();
    output.appendLine(`✓ Loaded ${loaded.configPath}`);
    output.appendLine('');
    output.appendLine(`name:    ${loaded.config.name}`);
    output.appendLine(`version: ${loaded.config.version}`);
    output.appendLine('');

    output.appendLine(`agents (${loaded.config.agents.length}):`);
    for (const a of loaded.config.agents) {
      output.appendLine(`  - ${a.id}  [${a.runner}]  → skill: ${a.skill}`);
    }
    output.appendLine('');

    output.appendLine(`skills (${loaded.config.skills.length}):`);
    for (const s of loaded.config.skills) {
      const src = s.builtin ? 'builtin' : (s.path ?? '(no source)');
      const status = loaded.skills.has(s.id) ? '✓' : '✗';
      output.appendLine(`  ${status} ${s.id}  → ${src}`);
    }
    output.appendLine('');

    output.appendLine(`slash_commands (${loaded.config.slash_commands.length}):`);
    for (const c of loaded.config.slash_commands) {
      const target = 'agent' in c ? `agent ${c.agent}` : `pipeline ${c.pipeline}`;
      output.appendLine(`  ${c.name}  → ${target}`);
    }
    output.appendLine('');

    output.appendLine(`pipelines (${loaded.config.pipelines.length}):`);
    for (const p of loaded.config.pipelines) {
      output.appendLine(`  ${p.id}: ${p.steps.join(' → ')}  (on_failure: ${p.on_failure})`);
    }
    output.appendLine('');

    if (loaded.config.state) {
      output.appendLine(`state:`);
      output.appendLine(`  entity: ${loaded.config.state.entity}`);
      output.appendLine(`  root:   ${loaded.config.state.root}`);
    }

    if (loaded.config.sidebar?.views.length) {
      output.appendLine(`sidebar.views (${loaded.config.sidebar.views.length}):`);
      for (const v of loaded.config.sidebar.views) {
        output.appendLine(`  - ${v.type}${'label' in v && v.label ? ` (${v.label})` : ''}`);
      }
    }

    output.appendLine('');
    output.appendLine('— resolved environment —');
    const env = loaded.envResolver.resolveLayered(loaded.config.environment, undefined);
    for (const [k, v] of Object.entries(env)) {
      const masked = /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v ? '***' : v || '(empty)';
      output.appendLine(`  ${k} = ${masked}`);
    }

    output.show(true);
    void vscode.window.showInformationMessage(
      `AIDLC workspace loaded: ${loaded.config.agents.length} agent(s), ${loaded.config.skills.length} skill(s).`,
    );
  } catch (err) {
    handleLoadError(err, output);
  }
}

function handleLoadError(err: unknown, output: vscode.OutputChannel): void {
  if (err instanceof WorkspaceNotFoundError) {
    void vscode.window
      .showWarningMessage(
        `No \`.aidlc/${WORKSPACE_FILENAME}\` found. Initialize one?`,
        'Initialize',
      )
      .then((choice) => {
        if (choice === 'Initialize') {
          void vscode.commands.executeCommand('aidlc.initWorkspace');
        }
      });
    return;
  }
  if (err instanceof WorkspaceValidationError) {
    output.clear();
    output.appendLine(`✗ ${err.message}`);
    output.appendLine('');
    output.appendLine('Issues:');
    for (const i of err.issues) {
      output.appendLine(`  ${i.path.join('.') || '<root>'}: ${i.message}`);
    }
    output.show(true);
    void vscode.window.showErrorMessage(
      'AIDLC workspace.yaml has validation errors. See AIDLC output channel.',
    );
    return;
  }
  if (err instanceof WorkspaceParseError) {
    void vscode.window.showErrorMessage(`AIDLC: ${err.message}`);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  output.appendLine(`✗ Unexpected error: ${msg}`);
  output.show(true);
  void vscode.window.showErrorMessage(`AIDLC: failed to load workspace — ${msg}`);
}

async function initWorkspace(output: vscode.OutputChannel): Promise<void> {
  const root = requireWorkspaceRoot();
  if (!root) { return; }

  const aidlcDir = path.join(root, WORKSPACE_DIR);
  const workspaceFile = path.join(aidlcDir, WORKSPACE_FILENAME);
  const skillsDir = path.join(aidlcDir, 'skills');
  const skillFile = path.join(skillsDir, 'hello-skill.md');

  if (fs.existsSync(workspaceFile)) {
    const choice = await vscode.window.showWarningMessage(
      `${WORKSPACE_DIR}/${WORKSPACE_FILENAME} already exists. Overwrite?`,
      { modal: false },
      'Overwrite',
      'Cancel',
    );
    if (choice !== 'Overwrite') {
      return;
    }
  }

  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name
      ?? path.basename(root);
    fs.writeFileSync(workspaceFile, sampleWorkspaceYaml(workspaceName), 'utf8');
    if (!fs.existsSync(skillFile)) {
      fs.writeFileSync(skillFile, SAMPLE_HELLO_SKILL, 'utf8');
    }
    output.appendLine(`[init] wrote ${workspaceFile}`);
    output.appendLine(`[init] wrote ${skillFile}`);

    void vscode.window
      .showInformationMessage(
        'AIDLC workspace initialized at .aidlc/. Open Builder?',
        'Open Builder',
      )
      .then((choice) => {
        if (choice === 'Open Builder') {
          void vscode.commands.executeCommand('aidlc.openBuilder');
        }
      });
    // Open the new workspace.yaml so the user can edit it
    const doc = await vscode.workspace.openTextDocument(workspaceFile);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`AIDLC init failed: ${msg}`);
  }
}
