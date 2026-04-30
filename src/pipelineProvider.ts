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
    void vscode.commands.executeCommand('setContext', 'cfPipeline.empty', this.epics.length === 0);
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
      // Epic children: show phases. `isNext` marks the first phase the user
      // can currently act on — drives the "Run" button placement.
      return element.epic.phases.map((phase, idx) => new PhaseItem(phase, element.epic, idx === element.epic.currentPhase));
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

    const badge = epic.hasFailure ? ' ⛔' : epic.hasAwaitingReview ? ' 🔔' : '';
    this.description = `${epic.progress}% — ${currentPhase}${badge}`;
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
      lines.push(`${phaseGlyph(phase.status)} **${phase.name}** — ${phase.agent}`);
    }
    if (this.epic.hasAwaitingReview) {
      lines.push('', '🔔 Awaiting human review — click a phase to open the review panel.');
    }
    if (this.epic.hasFailure) {
      lines.push('', '⛔ Auto-reviewer gave up on at least one phase — manual intervention needed.');
    }
    return lines.join('\n');
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.epic.hasFailure) {
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }
    if (this.epic.hasAwaitingReview) {
      return new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.orange'));
    }
    if (this.epic.progress === 100) {
      return new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'));
    }
    if (this.epic.progress > 0) {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }
    return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  }
}

function phaseGlyph(status: PhaseStatus['status']): string {
  switch (status) {
    case 'done':
    case 'passed':
      return '$(check)';
    case 'in-progress':
    case 'in_progress':
      return '$(sync~spin)';
    case 'in_review':
      return '$(eye)';
    case 'awaiting_human_review':
      return '$(bell-dot)';
    case 'rejected':
      return '$(error)';
    case 'stale':
      return '$(warning)';
    case 'failed_needs_human':
      return '$(error)';
    case 'blocked':
      return '$(circle-slash)';
    default:
      return '$(circle-outline)';
  }
}

class PhaseItem extends vscode.TreeItem {
  constructor(
    public readonly phase: PhaseStatus,
    public readonly epic: EpicStatus,
    public readonly isNext: boolean,
  ) {
    super(`${phase.name}`, vscode.TreeItemCollapsibleState.Collapsed);

    const revLabel = phase.revision && phase.revision > 1 ? ` · rev ${phase.revision}` : '';
    this.description = `${phase.agentEmoji} ${phase.agent}${revLabel}`;
    this.tooltip = new vscode.MarkdownString(buildPhaseTooltip(phase));
    this.iconPath = this.getIcon();
    this.contextValue = computePhaseContextValue(phase, isNext);

    // Default click action: the most-useful action for this state.
    this.command = resolvePrimaryCommand(phase, epic, isNext);
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.phase.status) {
      case 'done':
      case 'passed':
        return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
      case 'in-progress':
      case 'in_progress':
        return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
      case 'in_review':
        return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.blue'));
      case 'awaiting_human_review':
        return new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.orange'));
      case 'rejected':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'stale':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'failed_needs_human':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconErrored'));
      case 'blocked':
        return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconFailed'));
      default:
        return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
    }
  }
}

/**
 * Classify a phase into one of the inline-action buckets used by package.json
 * view/item/context menus. Each value corresponds to a specific button.
 *
 *   phase-review   → 🔔 Review (awaiting_human_review only)
 *   phase-feedback → 💬 Update feedback + rerun (rejected / failed_needs_human)
 *   phase-rerun    → 🔄 Re-run (already done / in-progress phases)
 *   phase-run      → ▶ Run (current-next pending, or stale phase)
 *   phase          → no inline action (future pending, blocked)
 */
function computePhaseContextValue(phase: PhaseStatus, isNext: boolean): string {
  const s = phase.status;
  if (s === 'awaiting_human_review') { return 'phase-review'; }
  if (s === 'rejected' || s === 'failed_needs_human') { return 'phase-feedback'; }

  // Legacy epics have no status.json → phase.revision is undefined. Without
  // the orchestrator writing real states, every unfinished phase should
  // expose a ▶ Run button so the user can drive the pipeline manually.
  const isOrchestratorManaged = phase.revision !== undefined;
  if (!isOrchestratorManaged) {
    if (s === 'done' || s === 'passed') { return 'phase-rerun'; }
    return 'phase-run';
  }

  if (s === 'passed' || s === 'done' || s === 'in_progress' || s === 'in-progress' || s === 'in_review') {
    return 'phase-rerun';
  }
  if (s === 'stale' || (s === 'pending' && isNext)) {
    return 'phase-run';
  }
  return 'phase';
}

function resolvePrimaryCommand(phase: PhaseStatus, epic: EpicStatus, isNext: boolean): vscode.Command {
  const ctx = computePhaseContextValue(phase, isNext);
  switch (ctx) {
    case 'phase-review':
      return { command: 'cfPipeline.reviewGate', title: 'Review Gate', arguments: [phase, epic] };
    case 'phase-feedback':
      return { command: 'cfPipeline.feedbackAndRerun', title: 'Update Feedback + Re-run', arguments: [phase, epic] };
    case 'phase-rerun':
    case 'phase-run':
      return { command: 'cfPipeline.runStep', title: 'Run Step', arguments: [phase, epic] };
    default:
      return { command: 'cfPipeline.openPhaseSession', title: 'Open Phase Session', arguments: [phase, epic] };
  }
}

function buildPhaseTooltip(phase: PhaseStatus): string {
  const lines = [
    `**${phase.name}** — ${phase.agent}`,
    '',
    `**Status**: ${phase.status}${phase.revision ? ` (rev ${phase.revision})` : ''}`,
  ];
  if (phase.updatedAt) {
    lines.push(`**Updated**: ${phase.updatedAt}`);
  }
  if (phase.lastReview) {
    lines.push('', `**Last review**: ${phase.lastReview.decision} by ${phase.lastReview.reviewer}`);
    if (phase.lastReview.reject_to) {
      lines.push(`**Rejected to**: ${phase.lastReview.reject_to}`);
    }
    if (phase.lastReview.reason) {
      lines.push(`**Reason**: ${phase.lastReview.reason}`);
    }
  }
  lines.push('', `**Command**: \`${phase.command}\``);
  lines.push(`**Input**: ${phase.input}`);
  lines.push(`**Output**: ${phase.output}`);
  return lines.join('\n');
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
