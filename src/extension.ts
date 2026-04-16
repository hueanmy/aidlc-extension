import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineProvider } from './pipelineProvider';
import { DashboardPanel } from './dashboardPanel';
import { SettingsPanel } from './settingsPanel';
import { EpicStatus, PhaseStatus } from './epicScanner';
import { ensureMcpConfig } from './mcpConfigurator';
import { ensureEpicsBootstrap } from './epicBootstrapper';

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
    const configuredTemplatePath = (config.get<string>('templateSourcePath') || '').trim();
    const templateSourcePath = configuredTemplatePath.length > 0
      ? configuredTemplatePath
      : path.join(context.extensionPath, 'templates', 'generic');

    const bootstrapResult = ensureEpicsBootstrap(
      workspaceRoot,
      epicsRelativePath,
      templateSourcePath,
      (msg) => outputChannel.appendLine(`[Bootstrap] ${msg}`),
    );
    if (bootstrapResult.created) {
      void vscode.window.showInformationMessage(
        `Created default epic ${bootstrapResult.epicKey} in ${bootstrapResult.epicsDir}`,
      );
    }

    outputChannel.appendLine(`Epics path: ${epicsRelativePath}`);

    let pipelineProvider: PipelineProvider | undefined;
    let providerRegistration: vscode.Disposable | undefined;
    let treeView: vscode.TreeView<unknown> | undefined;

    if (workspaceRoot) {
      try {
        pipelineProvider = new PipelineProvider(workspaceRoot, epicsRelativePath);
        providerRegistration = vscode.window.registerTreeDataProvider('cfPipelineView', pipelineProvider);
        treeView = vscode.window.createTreeView('cfPipelineView', {
          treeDataProvider: pipelineProvider,
          showCollapseAll: false,
        });
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

        ensureEpicsBootstrap(
          workspaceRoot,
          newPath,
          templateSourcePath,
          (msg) => outputChannel.appendLine(`[Bootstrap] ${msg}`),
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

    const openPhaseSessionCmd = vscode.commands.registerCommand(
      'cfPipeline.openPhaseSession',
      async (phase: PhaseStatus, epic: EpicStatus) => {
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

    // Dynamic file watcher that updates when epics path changes
    let watcher: vscode.FileSystemWatcher | undefined;
    function recreateWatcher() {
      if (!pipelineProvider) {
        return;
      }
      try {
        watcher?.dispose();
        const isAbsolute = path.isAbsolute(epicsRelativePath);
        const watchPattern = isAbsolute
          ? new vscode.RelativePattern(vscode.Uri.file(epicsRelativePath), '**/*.md')
          : `**/${epicsRelativePath}/**/*.md`;
        watcher = vscode.workspace.createFileSystemWatcher(watchPattern);
        watcher.onDidChange(() => pipelineProvider.refresh());
        watcher.onDidCreate(() => pipelineProvider.refresh());
        watcher.onDidDelete(() => pipelineProvider.refresh());
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
          ensureEpicsBootstrap(
            workspaceRoot,
            newPath,
            templateSourcePath,
            (msg) => outputChannel.appendLine(`[Bootstrap] ${msg}`),
          );
          epicsRelativePath = newPath;
          pipelineProvider.setEpicsPath(newPath);
          recreateWatcher();
          outputChannel.appendLine(`Epics path updated from settings: ${newPath}`);
        }
      }
    });

    const watcherDisposable = { dispose: () => watcher?.dispose() };

    const disposables: vscode.Disposable[] = [
      refreshCmd,
      dashboardCmd,
      selectEpicsFolderCmd,
      openSettingsCmd,
      openArtifactCmd,
      runPhaseCmd,
      openPhaseSessionCmd,
      watcherDisposable,
      configListener,
    ];
    if (providerRegistration) {
      disposables.push(providerRegistration);
    }
    if (treeView) {
      disposables.push(treeView);
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
