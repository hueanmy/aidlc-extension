import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PipelineWebviewProvider } from './pipelineWebviewProvider';
import { DashboardPanel } from './dashboardPanel';
import { SettingsPanel } from './settingsPanel';
import { EpicStatus, PhaseStatus } from './epicScanner';
import { ensureMcpConfig } from './mcpConfigurator';
import { migrateEpics } from './epicMigrator';
import { getArtifactTemplate } from './epicBootstrapper';
import { ReviewPanel } from './reviewPanel';
import { loadExampleProject, clearExampleProject } from './exampleProject';

const PHASE_ORDER = [
  'plan', 'design', 'test-plan', 'implement', 'review', 'execute-test', 'release', 'monitor', 'doc-sync',
] as const;

// Tree-view inline menu actions (`view/item/context` with `group: "inline"`)
// invoke commands with a single argument — the TreeItem itself (PhaseItem) —
// not the `arguments` array from TreeItem.command. Without this unwrap, every
// handler with the `(phase, epic)` signature silently returns when clicked
// from an inline button because `epic` is undefined.
function unwrapPhaseArgs(
  first: unknown,
  second?: EpicStatus,
): { phase: PhaseStatus | undefined; epic: EpicStatus | undefined } {
  if (
    first && typeof first === 'object' &&
    'phase' in (first as object) && 'epic' in (first as object)
  ) {
    const item = first as { phase: PhaseStatus; epic: EpicStatus };
    return { phase: item.phase, epic: item.epic };
  }
  return { phase: first as PhaseStatus | undefined, epic: second };
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('SDLC Pipeline');
  context.subscriptions.push(outputChannel);

  const safeEnsureMcpConfig = (workspaceRoot: string) => {
    try {
      ensureMcpConfig(workspaceRoot, (msg) => outputChannel.appendLine(`[MCP] ${msg}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[MCP] Auto-configure skipped due to error: ${message}`);
    }
  };

  try {
    outputChannel.appendLine('Activating SDLC Pipeline extension');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      || path.join(context.globalStorageUri.fsPath, 'default-workspace');
    const hasWorkspaceFolder = !!vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!hasWorkspaceFolder) {
      outputChannel.appendLine('No workspace root found. Commands will stay available in limited mode.');
    } else {
      outputChannel.appendLine(`Workspace root: ${workspaceRoot}`);

      // Auto-configure Claude Code MCP server
      safeEnsureMcpConfig(workspaceRoot);
    }

    const config = vscode.workspace.getConfiguration('cfPipeline');
    let epicsRelativePath: string = config.get<string>('epicsPath') || 'docs/sdlc/epics';

    // Idempotent migration of legacy epic layouts (e.g. uat → execute-test).
    // Runs before bootstrap so scaffolded files never collide with migrated ones.
    try {
      const epicsDirAbs = path.resolve(workspaceRoot, epicsRelativePath);
      const migrated = migrateEpics(
        epicsDirAbs,
        (msg) => outputChannel.appendLine(`[Migrate] ${msg}`),
      );
      if (migrated.length > 0) {
        for (const m of migrated) outputChannel.appendLine(`[Migrate] ${m}`);
        void vscode.window.showInformationMessage(
          `Migrated ${migrated.length} epic file${migrated.length === 1 ? '' : 's'} to new phase naming (see SDLC Pipeline output for details).`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[Migrate] Skipped due to error: ${message}`);
    }

    outputChannel.appendLine(`Epics path: ${epicsRelativePath}`);

    let pipelineProvider: PipelineWebviewProvider | undefined;
    let providerRegistration: vscode.Disposable | undefined;

    if (workspaceRoot) {
      try {
        pipelineProvider = new PipelineWebviewProvider(
          context.extensionUri,
          workspaceRoot,
          epicsRelativePath,
        );
        providerRegistration = vscode.window.registerWebviewViewProvider(
          PipelineWebviewProvider.viewType,
          pipelineProvider,
          { webviewOptions: { retainContextWhenHidden: true } },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Provider initialization failed: ${message}`);
      }
    }

    const refreshCmd = vscode.commands.registerCommand('cfPipeline.refresh', () => {
      if (!pipelineProvider) {
        vscode.window.showWarningMessage('SDLC Pipeline is not ready. Open a workspace folder and reload window.');
        return;
      }
      pipelineProvider.refresh();
      vscode.window.showInformationMessage('Pipeline status refreshed');
    });

    const dashboardCmd = vscode.commands.registerCommand('cfPipeline.openDashboard', () => {
      if (!pipelineProvider) {
        vscode.window.showWarningMessage('SDLC Pipeline is not ready. Open a workspace folder and reload window.');
        return;
      }
      const epics = pipelineProvider.getEpics();
      DashboardPanel.show(context.extensionUri, epics);
    });

    const openArtifactCmd = vscode.commands.registerCommand('cfPipeline.openArtifact', (filePath: string) => {
      if (filePath) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
      }
    });

    // Lazy artifact creator. Tree-view artifact rows hit this instead of
    // vscode.open so a missing PRD.md / TECH-DESIGN.md / etc. gets seeded
    // from templates/generic/ at first click instead of erroring out.
    const openOrCreateArtifactCmd = vscode.commands.registerCommand(
      'cfPipeline.openOrCreateArtifact',
      async (filePath: string, epicKey: string) => {
        if (!filePath) { return; }
        if (!fs.existsSync(filePath)) {
          const templateRoot = path.join(context.extensionPath, 'templates', 'generic');
          const artifactName = path.basename(filePath);
          const content = getArtifactTemplate(artifactName, epicKey, templateRoot);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, 'utf8');
          outputChannel.appendLine(`[Artifact] seeded ${artifactName} from template for ${epicKey}`);
        }
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
      },
    );

    const runPhaseCmd = vscode.commands.registerCommand('cfPipeline.runPhase', (command: string) => {
      if (command) {
        const terminal = vscode.window.createTerminal('SDLC Pipeline');
        terminal.show();
        terminal.sendText(`# Run: ${command}`, false);
        terminal.sendText('', false);
      }
    });

    const selectEpicsFolderCmd = vscode.commands.registerCommand(
      'cfPipeline.selectEpicsFolder',
      async () => {
        if (!pipelineProvider) {
          vscode.window.showWarningMessage('SDLC Pipeline is not ready yet. Reload window and try again.');
          return;
        }

        const result = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: vscode.Uri.file(pipelineProvider.getEpicsDir()),
          openLabel: 'Select Epics Folder',
          title: 'Select SDLC Epics Folder',
        });

        if (!result || result.length === 0) {
          return;
        }

        const selectedPath = result[0].fsPath;

        // Use absolute path if outside workspace, relative if inside
        const newPath = selectedPath.startsWith(workspaceRoot)
          ? path.relative(workspaceRoot, selectedPath)
          : selectedPath;
        epicsRelativePath = newPath;

        // Save to workspace settings
        const wsConfig = vscode.workspace.getConfiguration('cfPipeline');
        await wsConfig.update(
          'epicsPath',
          newPath,
          hasWorkspaceFolder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
        );

        // Update provider and watcher
        pipelineProvider.setEpicsPath(newPath);
        recreateWatcher();

        outputChannel.appendLine(`Epics path changed to: ${newPath}`);
        vscode.window.showInformationMessage(`Epics folder set to: ${newPath}`);
      }
    );

    const openSettingsCmd = vscode.commands.registerCommand(
      'cfPipeline.openSettings',
      () => {
        if (!pipelineProvider) {
          vscode.window.showWarningMessage('SDLC Pipeline is not ready. Open a workspace folder and reload window.');
          return;
        }

        SettingsPanel.show(context.extensionUri, () => ({
          epics: pipelineProvider.getEpics(),
          epicsPath: epicsRelativePath,
        }), () => {
          pipelineProvider.refresh();
        });
      }
    );

    const loadExampleProjectCmd = vscode.commands.registerCommand(
      'cfPipeline.loadExampleProject',
      async () => {
        try {
          await loadExampleProject({
            extensionPath: context.extensionPath,
            log: (msg) => outputChannel.appendLine(`[Example] ${msg}`),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          outputChannel.appendLine(`[Example] load failed: ${message}`);
          void vscode.window.showErrorMessage(`Failed to load example project: ${message}`);
        }
      },
    );

    const clearExampleProjectCmd = vscode.commands.registerCommand(
      'cfPipeline.clearExampleProject',
      async () => {
        try {
          await clearExampleProject({
            extensionPath: context.extensionPath,
            log: (msg) => outputChannel.appendLine(`[Example] ${msg}`),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          outputChannel.appendLine(`[Example] clear failed: ${message}`);
          void vscode.window.showErrorMessage(`Failed to clear example project: ${message}`);
        }
      },
    );

    // Reuses an existing AIDLC · Claude terminal if one is open so the user
    // doesn't end up with a stack of Claude REPLs after multiple clicks.
    // cwd: only set when the workspace folder actually exists on disk —
    // when no workspace is open, `workspaceRoot` is a synthetic globalStorage
    // path that VSCode rejects ("Starting directory does not exist").
    const openClaudeTerminalCmd = vscode.commands.registerCommand(
      'cfPipeline.openClaudeTerminal',
      () => {
        const TERMINAL_NAME = 'AIDLC · Claude';
        const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
        if (existing) {
          existing.show(false);
          return;
        }
        const cwd = hasWorkspaceFolder && fs.existsSync(workspaceRoot)
          ? workspaceRoot
          : undefined;
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

    // Alias so the tree can show a different icon ($(refresh)) for already-done
    // phases. Delegates to runStep — same semantics.
    const rerunStepCmd = vscode.commands.registerCommand(
      'cfPipeline.rerunStep',
      (a: unknown, b?: EpicStatus) =>
        vscode.commands.executeCommand('cfPipeline.runStep', a, b),
    );

    const runStepCmd = vscode.commands.registerCommand(
      'cfPipeline.runStep',
      async (a: unknown, b?: EpicStatus) => {
        const { phase, epic } = unwrapPhaseArgs(a, b);
        if (!phase || !epic) { return; }

        const s = phase.status;
        const isRerun =
          s === 'passed' || s === 'done' || s === 'in_progress' ||
          s === 'in-progress' || s === 'in_review';

        if (isRerun) {
          const confirm = await vscode.window.showWarningMessage(
            `Re-run "${phase.name}" for ${epic.key}? Current artifacts will be archived and downstream phases marked stale.`,
            { modal: false },
            'Re-run',
            'Cancel',
          );
          if (confirm !== 'Re-run') { return; }
          markPhaseForRerun(phase, epic);
        }

        await vscode.commands.executeCommand('cfPipeline.advanceEpic', epic.key);
      }
    );

    const feedbackAndRerunCmd = vscode.commands.registerCommand(
      'cfPipeline.feedbackAndRerun',
      async (a: unknown, b?: EpicStatus) => {
        const { phase, epic } = unwrapPhaseArgs(a, b);
        if (!phase || !epic) { return; }

        const existingFeedback = phase.userFeedback ?? '';
        const rejectReason = phase.lastReview?.reason ?? '';

        const feedback = await vscode.window.showInputBox({
          title: `Update feedback for ${epic.key} / ${phase.name}`,
          prompt: rejectReason
            ? `Auto-reviewer said: "${rejectReason}". Add your note for the next worker run.`
            : 'Leave a note for the next worker run.',
          value: existingFeedback,
          placeHolder: 'e.g. Focus on the failing acceptance criterion AC02 and add the missing error state.',
          ignoreFocusOut: true,
        });

        if (feedback === undefined) { return; } // cancelled
        writeUserFeedback(phase, epic, feedback.trim());
        pipelineProvider?.refresh();

        await vscode.commands.executeCommand('cfPipeline.advanceEpic', epic.key);
      }
    );

    const advanceEpicCmd = vscode.commands.registerCommand(
      'cfPipeline.advanceEpic',
      async (epicOrKey: EpicStatus | string) => {
        const epicKey = typeof epicOrKey === 'string' ? epicOrKey : epicOrKey?.key;
        if (!epicKey) {
          void vscode.window.showWarningMessage('No epic key provided.');
          return;
        }
        const slash = `/advance-epic ${epicKey}`;
        await vscode.env.clipboard.writeText(slash);

        // Best-effort: focus Claude Code chat if installed. Extension ID /
        // view IDs vary, so try a short list and fall back silently.
        const chatCommands = [
          'claude-code.focusChatView',
          'claude.openChat',
          'workbench.action.chat.open',
          'workbench.view.extension.claude-code',
        ];
        for (const cmd of chatCommands) {
          try {
            await vscode.commands.executeCommand(cmd);
            break;
          } catch { /* try next */ }
        }

        void vscode.window.showInformationMessage(
          `Copied "${slash}" to clipboard. Paste into Claude Code chat (Cmd+V) + Enter to continue.`
        );
      }
    );

    const reviewGateCmd = vscode.commands.registerCommand(
      'cfPipeline.reviewGate',
      (a: unknown, b?: EpicStatus) => {
        const { phase, epic } = unwrapPhaseArgs(a, b);
        if (!phase || !epic) { return; }
        if (phase.status !== 'awaiting_human_review') {
          void vscode.window.showInformationMessage(
            `Phase "${phase.name}" is "${phase.status}", not awaiting human review — nothing to approve or reject here.`
          );
          return;
        }
        const reviewer = resolveReviewerId();
        ReviewPanel.show(
          context.extensionUri,
          workspaceRoot,
          phase,
          epic,
          reviewer,
          () => pipelineProvider?.refresh(),
        );
      }
    );

    // Manual entry point: open the ReviewPanel (approve / reject / comment)
    // on ANY phase, regardless of status. Useful for driving the flow without
    // the orchestrator — user can reject from a passed phase, add a comment
    // from a pending one, etc. reviewGate stays strict for the automatic
    // awaiting_human_review trigger.
    const openReviewCmd = vscode.commands.registerCommand(
      'cfPipeline.openReview',
      (a: unknown, b?: EpicStatus) => {
        const { phase, epic } = unwrapPhaseArgs(a, b);
        if (!phase || !epic) { return; }
        const reviewer = resolveReviewerId();
        ReviewPanel.show(
          context.extensionUri,
          workspaceRoot,
          phase,
          epic,
          reviewer,
          () => pipelineProvider?.refresh(),
        );
      }
    );

    // Manual entry point: write user feedback to phases/<id>/status.json
    // without triggering /advance-epic. Works on any phase — creates the
    // status.json if missing so orchestrator picks it up later.
    const addFeedbackCmd = vscode.commands.registerCommand(
      'cfPipeline.addFeedback',
      async (a: unknown, b?: EpicStatus) => {
        const { phase, epic } = unwrapPhaseArgs(a, b);
        if (!phase || !epic) { return; }
        const feedback = await vscode.window.showInputBox({
          title: `Feedback for ${epic.key} / ${phase.name}`,
          prompt: 'Leave a note for the next worker run. Saved to status.json.',
          value: phase.userFeedback ?? '',
          placeHolder: 'e.g. Re-check AC02 and add the missing error state.',
          ignoreFocusOut: true,
        });
        if (feedback === undefined) { return; }
        writeUserFeedback(phase, epic, feedback.trim());
        pipelineProvider?.refresh();
        void vscode.window.showInformationMessage(
          `Feedback saved for ${epic.key} / ${phase.name}.`
        );
      }
    );

    const openPhaseSessionCmd = vscode.commands.registerCommand(
      'cfPipeline.openPhaseSession',
      async (a: unknown, b?: EpicStatus) => {
        const { phase, epic } = unwrapPhaseArgs(a, b);
        if (!phase || !epic) {
          return;
        }

        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: buildPhaseSessionBrief(phase, epic),
        });

        await vscode.window.showTextDocument(document, {
          preview: false,
          preserveFocus: false,
        });

        try {
          await vscode.commands.executeCommand('vscode.editorChat.start');
        } catch {
          void vscode.window.showInformationMessage(
            'Phase brief opened in a new editor. Start Copilot Chat there to keep this phase isolated from other phases.'
          );
        }
      }
    );

    // Dynamic file watchers that update when epics path changes.
    // We watch BOTH *.md (PRD, TECH-DESIGN, etc. — legacy phase detection)
    // and status.json (orchestrator-written phase state — the authoritative
    // source once orchestrator is used).
    let mdWatcher: vscode.FileSystemWatcher | undefined;
    let statusWatcher: vscode.FileSystemWatcher | undefined;
    let pipelineWatcher: vscode.FileSystemWatcher | undefined;
    function recreateWatcher() {
      if (!pipelineProvider) {
        return;
      }
      try {
        mdWatcher?.dispose();
        statusWatcher?.dispose();
        pipelineWatcher?.dispose();
        const isAbsolute = path.isAbsolute(epicsRelativePath);
        const mdPattern = isAbsolute
          ? new vscode.RelativePattern(vscode.Uri.file(epicsRelativePath), '**/*.md')
          : `**/${epicsRelativePath}/**/*.md`;
        const statusPattern = isAbsolute
          ? new vscode.RelativePattern(vscode.Uri.file(epicsRelativePath), '**/status.json')
          : `**/${epicsRelativePath}/**/status.json`;
        const pipelinePattern = isAbsolute
          ? new vscode.RelativePattern(vscode.Uri.file(epicsRelativePath), '**/pipeline.json')
          : `**/${epicsRelativePath}/**/pipeline.json`;
        mdWatcher = vscode.workspace.createFileSystemWatcher(mdPattern);
        statusWatcher = vscode.workspace.createFileSystemWatcher(statusPattern);
        pipelineWatcher = vscode.workspace.createFileSystemWatcher(pipelinePattern);
        for (const w of [mdWatcher, statusWatcher, pipelineWatcher]) {
          w.onDidChange(() => pipelineProvider.refresh());
          w.onDidCreate(() => pipelineProvider.refresh());
          w.onDidDelete(() => pipelineProvider.refresh());
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Watcher setup failed for epics path "${epicsRelativePath}": ${message}`);
      }
    }
    recreateWatcher();

    // Listen for config changes
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (
        hasWorkspaceFolder && (
          e.affectsConfiguration('cfPipeline.platform') ||
          e.affectsConfiguration('cfPipeline.mcpPackage') ||
          e.affectsConfiguration('cfPipeline.mcpServerName') ||
          e.affectsConfiguration('cfPipeline.mcpCommand') ||
          e.affectsConfiguration('cfPipeline.mcpArgs') ||
          e.affectsConfiguration('cfPipeline.mcpEnv') ||
          e.affectsConfiguration('cfPipeline.autoConfigureMcp')
        )
      ) {
        safeEnsureMcpConfig(workspaceRoot);
      }
      if (e.affectsConfiguration('cfPipeline.epicsPath')) {
        const newPath = vscode.workspace.getConfiguration('cfPipeline').get<string>('epicsPath') || 'docs/sdlc/epics';
        if (pipelineProvider && newPath !== epicsRelativePath) {
          epicsRelativePath = newPath;
          pipelineProvider.setEpicsPath(newPath);
          recreateWatcher();
          outputChannel.appendLine(`Epics path updated from settings: ${newPath}`);
        }
      }
    });

    const watcherDisposable = {
      dispose: () => {
        mdWatcher?.dispose();
        statusWatcher?.dispose();
        pipelineWatcher?.dispose();
      },
    };

    const disposables: vscode.Disposable[] = [
      refreshCmd,
      dashboardCmd,
      selectEpicsFolderCmd,
      openSettingsCmd,
      openArtifactCmd,
      openOrCreateArtifactCmd,
      runPhaseCmd,
      openPhaseSessionCmd,
      reviewGateCmd,
      openReviewCmd,
      addFeedbackCmd,
      advanceEpicCmd,
      runStepCmd,
      rerunStepCmd,
      feedbackAndRerunCmd,
      loadExampleProjectCmd,
      clearExampleProjectCmd,
      openClaudeTerminalCmd,
      watcherDisposable,
      configListener,
    ];
    if (providerRegistration) {
      disposables.push(providerRegistration);
    }
    context.subscriptions.push(...disposables);

    if (pipelineProvider) {
      const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
      statusBar.command = 'cfPipeline.openDashboard';
      const epics = pipelineProvider.getEpics();
      const active = epics.filter(e => e.progress > 0 && e.progress < 100).length;
      statusBar.text = `$(rocket) ${active} active epic${active !== 1 ? 's' : ''}`;
      statusBar.tooltip = 'Open SDLC Pipeline Dashboard';
      statusBar.show();
      context.subscriptions.push(statusBar);

      outputChannel.appendLine(`Activation complete: loaded ${epics.length} epic(s)`);
    } else {
      outputChannel.appendLine('Activation complete in limited mode (no pipeline provider).');
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    outputChannel.appendLine(`Activation failed: ${message}`);
    outputChannel.show(true);
    void vscode.window.showErrorMessage(`SDLC Pipeline activation failed. See output for details.`);
  }
}

export function deactivate() {}

/**
 * Mark a phase for re-run (user triggered). Flips status to `stale` without
 * bumping revision — the orchestrator's `start_phase` will archive and bump
 * when the loop reaches this phase. Also marks any passed/done downstream
 * phases as stale so they're re-run in sequence.
 *
 * Writes status.json directly; no MCP call.
 */
function markPhaseForRerun(phase: PhaseStatus, epic: EpicStatus): void {
  const fromIdx = PHASE_ORDER.indexOf(phase.id as typeof PHASE_ORDER[number]);
  if (fromIdx < 0) { return; }

  const thisPath = phaseStatusPath(epic.folderPath, phase.id);
  const thisCurrent = readPhaseStatusFile(thisPath) ?? { phase: phase.id, revision: 1 };
  fs.mkdirSync(path.dirname(thisPath), { recursive: true });
  fs.writeFileSync(
    thisPath,
    JSON.stringify({ ...thisCurrent, status: 'stale', updated_at: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );

  for (let i = fromIdx + 1; i < PHASE_ORDER.length; i++) {
    const downstream = PHASE_ORDER[i];
    const dPath = phaseStatusPath(epic.folderPath, downstream);
    const dCurrent = readPhaseStatusFile(dPath);
    if (!dCurrent) { continue; }
    if (dCurrent.status === 'passed' || dCurrent.status === 'done') {
      fs.writeFileSync(
        dPath,
        JSON.stringify({ ...dCurrent, status: 'stale', updated_at: new Date().toISOString() }, null, 2) + '\n',
        'utf8'
      );
    }
  }
}

/**
 * Write the user's feedback string onto a phase's status.json. Preserves all
 * other fields. Worker will see this at next run via phase_context.userFeedback.
 */
function writeUserFeedback(phase: PhaseStatus, epic: EpicStatus, feedback: string): void {
  const p = phaseStatusPath(epic.folderPath, phase.id);
  const current = readPhaseStatusFile(p) ?? { phase: phase.id, status: phase.status, revision: phase.revision ?? 1 };
  const next = {
    ...current,
    user_feedback: feedback.length > 0 ? feedback : undefined,
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

function phaseStatusPath(epicFolderPath: string, phaseId: string): string {
  return path.join(epicFolderPath, 'phases', phaseId, 'status.json');
}

function readPhaseStatusFile(p: string): Record<string, unknown> | null {
  if (!fs.existsSync(p)) { return null; }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Best-effort reviewer identifier recorded in status.json's last_review.reviewer.
 * Falls back to the OS user if no git identity is configured.
 */
function resolveReviewerId(): string {
  try {
    const { execSync } = require('child_process');
    const email = execSync('git config user.email', { encoding: 'utf8', timeout: 2000 }).trim();
    if (email) { return `human:${email}`; }
  } catch {
    /* ignore */
  }
  const user = process.env.USER || process.env.USERNAME || 'unknown';
  return `human:${user}`;
}

function buildPhaseSessionBrief(phase: PhaseStatus, epic: EpicStatus): string {
  const lines = [
    `# ${epic.key} — ${phase.name}`,
    '',
    '> This editor is a dedicated phase session. Keep work for this phase here only.',
    '',
    '## Session Contract',
    '- Treat this phase as isolated from other phase sessions.',
    '- Do not assume prior chat history from other phases.',
    '- Use only the artifacts and inputs listed below as context.',
    '',
    '## Phase Metadata',
    `- Epic: ${epic.key} — ${epic.title}`,
    `- Agent: ${phase.agent} ${phase.agentEmoji}`,
    `- Status: ${phase.status}`,
    `- Command: ${phase.command}`,
    `- Input: ${phase.input}`,
    `- Output: ${phase.output}`,
    `- Artifact: ${phase.artifactPath ?? phase.artifact ?? 'None yet'}`,
    '',
    '## Prompt',
    `Work only on the \"${phase.name}\" phase for ${epic.key}.`,
    'Use this editor session as a fresh context boundary.',
    'If you need information from another phase, read that artifact explicitly instead of relying on shared chat history.',
    '',
  ];

  return lines.join('\n');
}
