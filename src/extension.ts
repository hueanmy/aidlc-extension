import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineProvider } from './pipelineProvider';
import { DashboardPanel } from './dashboardPanel';
import { SettingsPanel } from './settingsPanel';
import { EpicStatus, PhaseStatus } from './epicScanner';
import { ensureMcpConfig } from './mcpConfigurator';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('SDLC Pipeline');
  context.subscriptions.push(outputChannel);

  try {
    outputChannel.appendLine('Activating SDLC Pipeline extension');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      outputChannel.appendLine('Activation skipped: no workspace root found');
      return;
    }

    outputChannel.appendLine(`Workspace root: ${workspaceRoot}`);

    // Auto-configure Claude Code MCP server
    ensureMcpConfig(workspaceRoot, (msg) => outputChannel.appendLine(`[MCP] ${msg}`));

    const config = vscode.workspace.getConfiguration('cfPipeline');
    let epicsRelativePath: string = config.get<string>('epicsPath') || 'docs/sdlc/epics';
    outputChannel.appendLine(`Epics path: ${epicsRelativePath}`);

    const pipelineProvider = new PipelineProvider(workspaceRoot, epicsRelativePath);

    const providerRegistration = vscode.window.registerTreeDataProvider('cfPipelineView', pipelineProvider);
    const treeView = vscode.window.createTreeView('cfPipelineView', {
      treeDataProvider: pipelineProvider,
      showCollapseAll: false,
    });

    const refreshCmd = vscode.commands.registerCommand('cfPipeline.refresh', () => {
      pipelineProvider.refresh();
      vscode.window.showInformationMessage('Pipeline status refreshed');
    });

    const dashboardCmd = vscode.commands.registerCommand('cfPipeline.openDashboard', () => {
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

        // Compute relative path from workspace root
        if (!selectedPath.startsWith(workspaceRoot)) {
          vscode.window.showWarningMessage('Selected folder must be inside the workspace.');
          return;
        }

        const newRelativePath = path.relative(workspaceRoot, selectedPath);
        epicsRelativePath = newRelativePath;

        // Save to workspace settings
        const wsConfig = vscode.workspace.getConfiguration('cfPipeline');
        await wsConfig.update('epicsPath', newRelativePath, vscode.ConfigurationTarget.Workspace);

        // Update provider and watcher
        pipelineProvider.setEpicsPath(newRelativePath);
        recreateWatcher();

        outputChannel.appendLine(`Epics path changed to: ${newRelativePath}`);
        vscode.window.showInformationMessage(`Epics folder set to: ${newRelativePath}`);
      }
    );

    const openSettingsCmd = vscode.commands.registerCommand(
      'cfPipeline.openSettings',
      () => {
        const epics = pipelineProvider.getEpics();
        SettingsPanel.show(context.extensionUri, epics, () => {
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
      watcher?.dispose();
      const watchPattern = `**/${epicsRelativePath}/**/*.md`;
      watcher = vscode.workspace.createFileSystemWatcher(watchPattern);
      watcher.onDidChange(() => pipelineProvider.refresh());
      watcher.onDidCreate(() => pipelineProvider.refresh());
      watcher.onDidDelete(() => pipelineProvider.refresh());
    }
    recreateWatcher();

    // Listen for config changes
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cfPipeline.platform') || e.affectsConfiguration('cfPipeline.mcpPackage')) {
        ensureMcpConfig(workspaceRoot, (msg) => outputChannel.appendLine(`[MCP] ${msg}`));
      }
      if (e.affectsConfiguration('cfPipeline.epicsPath')) {
        const newPath = vscode.workspace.getConfiguration('cfPipeline').get<string>('epicsPath') || 'docs/sdlc/epics';
        if (newPath !== epicsRelativePath) {
          epicsRelativePath = newPath;
          pipelineProvider.setEpicsPath(newPath);
          recreateWatcher();
          outputChannel.appendLine(`Epics path updated from settings: ${newPath}`);
        }
      }
    });

    const watcherDisposable = { dispose: () => watcher?.dispose() };

    context.subscriptions.push(
      providerRegistration,
      treeView,
      refreshCmd,
      dashboardCmd,
      selectEpicsFolderCmd,
      openSettingsCmd,
      openArtifactCmd,
      runPhaseCmd,
      openPhaseSessionCmd,
      watcherDisposable,
      configListener,
    );

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBar.command = 'cfPipeline.openDashboard';
    const epics = pipelineProvider.getEpics();
    const active = epics.filter(e => e.progress > 0 && e.progress < 100).length;
    statusBar.text = `$(rocket) ${active} active epic${active !== 1 ? 's' : ''}`;
    statusBar.tooltip = 'Open SDLC Pipeline Dashboard';
    statusBar.show();
    context.subscriptions.push(statusBar);

    outputChannel.appendLine(`Activation complete: loaded ${epics.length} epic(s)`);
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
