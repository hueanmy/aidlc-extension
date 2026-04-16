import * as vscode from 'vscode';
import * as path from 'path';
import { EpicScanner, EpicStatus, PhaseStatus } from './epicScanner';

type TreeItem = EpicItem | PhaseItem | InfoItem;

export class PipelineProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private scanner: EpicScanner;
  private epics: EpicStatus[] = [];

  constructor(private workspaceRoot: string, epicsRelativePath?: string) {
    this.scanner = new EpicScanner(workspaceRoot, epicsRelativePath);
    this.refresh();
  }

  setEpicsPath(relativePath: string): void {
    this.scanner.setEpicsDir(this.workspaceRoot, relativePath);
    this.refresh();
  }

  getEpicsDir(): string {
    return this.scanner.getEpicsDir();
  }

  refresh(): void {
    this.epics = this.scanner.scanAll();
    this._onDidChangeTreeData.fire(undefined);
  }

  getEpics(): EpicStatus[] {
    return this.epics;
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      // Root: show all epics
      return this.epics.map(epic => new EpicItem(epic));
    }

    if (element instanceof EpicItem) {
      // Epic children: show phases
      return element.epic.phases.map(phase => new PhaseItem(phase, element.epic));
    }

    if (element instanceof PhaseItem) {
      // Phase children: show input/output
      const items: InfoItem[] = [];
      items.push(new InfoItem('Input', element.phase.input, 'arrow-right'));
      items.push(new InfoItem('Output', element.phase.output, 'package'));
      if (element.phase.artifactPath) {
        items.push(new InfoItem('Artifact', element.phase.artifact || '', 'file', element.phase.artifactPath));
      }
      items.push(new InfoItem('Command', element.phase.command, 'terminal'));
      return items;
    }

    return [];
  }
}

class EpicItem extends vscode.TreeItem {
  constructor(public readonly epic: EpicStatus) {
    super(epic.key, vscode.TreeItemCollapsibleState.Collapsed);

    const currentPhase = epic.currentPhase < epic.phases.length
      ? epic.phases[epic.currentPhase].name
      : 'Complete';

    this.description = `${epic.progress}% — ${currentPhase}`;
    this.tooltip = new vscode.MarkdownString(this.buildTooltip());
    this.iconPath = this.getIcon();
    this.contextValue = 'epic';

    // Click to open epic doc
    const epicDoc = path.join(epic.folderPath, `${epic.key}.md`);
    this.command = {
      command: 'vscode.open',
      title: 'Open Epic',
      arguments: [vscode.Uri.file(epicDoc)],
    };
  }

  private buildTooltip(): string {
    const lines = [`## ${this.epic.key} — ${this.epic.title}`, '', `**Progress**: ${this.epic.progress}%`, ''];
    for (const phase of this.epic.phases) {
      const icon = phase.status === 'done' ? '$(check)' : phase.status === 'in-progress' ? '$(sync~spin)' : '$(circle-outline)';
      lines.push(`${icon} **${phase.name}** — ${phase.agent}`);
    }
    return lines.join('\n');
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.epic.progress === 100) {
      return new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'));
    }
    if (this.epic.progress > 0) {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }
    return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  }
}

class PhaseItem extends vscode.TreeItem {
  constructor(
    public readonly phase: PhaseStatus,
    public readonly epic: EpicStatus,
  ) {
    super(`${phase.name}`, vscode.TreeItemCollapsibleState.Collapsed);

    this.description = `${phase.agentEmoji} ${phase.agent}`;
    this.tooltip = new vscode.MarkdownString(
      `**${phase.name}** — ${phase.agent}\n\n` +
      `**Status**: ${phase.status}\n\n` +
      `**Command**: \`${phase.command}\`\n\n` +
      `**Input**: ${phase.input}\n\n` +
      `**Output**: ${phase.output}`
    );
    this.iconPath = this.getIcon();
    this.contextValue = 'phase';

    // Click to open a new isolated phase chat session.
    this.command = {
      command: 'cfPipeline.openPhaseSession',
      title: 'Open Phase Session',
      arguments: [phase, epic],
    };
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.phase.status) {
      case 'done':
        return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
      case 'in-progress':
        return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
      case 'blocked':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      default:
        return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
    }
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(
    label: string,
    value: string,
    icon: string,
    filePath?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);

    if (filePath) {
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [vscode.Uri.file(filePath)],
      };
    }
  }
}
