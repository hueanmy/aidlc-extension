import * as fs from 'fs';
import * as path from 'path';

export interface PhaseStatus {
  id: string;
  name: string;
  agent: string;
  agentEmoji: string;
  command: string;
  status: 'done' | 'in-progress' | 'pending' | 'blocked';
  artifact: string | null;
  artifactPath: string | null;
  input: string;
  output: string;
}

export interface EpicStatus {
  key: string;
  title: string;
  folderPath: string;
  phases: PhaseStatus[];
  currentPhase: number;
  progress: number; // 0-100
}

/**
 * Scans an epics folder to detect pipeline status for each epic.
 * Determines phase completion by checking artifact existence + content.
 */
export class EpicScanner {
  private epicsDir: string;

  private static resolveEpicsDir(workspaceRoot: string, configuredPath: string): string {
    return path.resolve(workspaceRoot, configuredPath);
  }

  constructor(workspaceRoot: string, configuredPath?: string) {
    const epicsPath = configuredPath || 'docs/sdlc/epics';
    this.epicsDir = EpicScanner.resolveEpicsDir(workspaceRoot, epicsPath);
  }

  getEpicsDir(): string {
    return this.epicsDir;
  }

  setEpicsDir(workspaceRoot: string, configuredPath: string): void {
    this.epicsDir = EpicScanner.resolveEpicsDir(workspaceRoot, configuredPath);
  }

  scanAll(): EpicStatus[] {
    if (!fs.existsSync(this.epicsDir)) {
      return [];
    }

    const parseEpicKey = (key: string): { prefix: string; number: number } => {
      const match = key.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
      if (!match) {
        return { prefix: key, number: 0 };
      }
      return { prefix: match[1], number: parseInt(match[2], 10) };
    };

    const epicDirs = fs.readdirSync(this.epicsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.match(/^[A-Z][A-Z0-9]*-\d+$/))
      .map(d => d.name)
      .sort((a, b) => {
        const epicA = parseEpicKey(a);
        const epicB = parseEpicKey(b);
        if (epicA.prefix !== epicB.prefix) {
          return epicA.prefix.localeCompare(epicB.prefix);
        }
        return epicB.number - epicA.number; // newest first within same prefix
      });

    return epicDirs.map(key => this.scanEpic(key));
  }

  scanEpic(key: string): EpicStatus {
    const epicDir = path.join(this.epicsDir, key);
    const title = this.extractTitle(epicDir, key);

    const allPhases = this.buildPhases(key, epicDir);
    const enabledIds = this.readEnabledPhases(epicDir);
    const phases = allPhases.filter(p => enabledIds.includes(p.id));
    const currentPhase = this.detectCurrentPhase(phases);
    const doneCount = phases.filter(p => p.status === 'done').length;
    const progress = Math.round((doneCount / phases.length) * 100);

    // Mark current phase as in-progress
    if (currentPhase < phases.length && phases[currentPhase].status === 'pending') {
      phases[currentPhase].status = 'in-progress';
    }

    return { key, title, folderPath: epicDir, phases, currentPhase, progress };
  }

  private buildPhases(key: string, epicDir: string): PhaseStatus[] {
    return [
      {
        id: 'plan',
        name: 'Plan',
        agent: 'Product Owner',
        agentEmoji: 'PO',
        command: `/epic ${key} + /prd ${key}`,
        status: this.checkPhase(epicDir, key, 'plan'),
        artifact: this.artifactExists(epicDir, 'PRD.md') ? 'PRD.md' : this.artifactExists(epicDir, `${key}.md`) ? `${key}.md` : null,
        artifactPath: this.getArtifactPath(epicDir, 'PRD.md') || this.getArtifactPath(epicDir, `${key}.md`),
        input: 'Jira ticket, Figma designs, business context',
        output: 'Epic Doc + PRD with Acceptance Criteria (EPIC-XXXX-AC*)',
      },
      {
        id: 'design',
        name: 'Design',
        agent: 'Tech Lead',
        agentEmoji: 'TL',
        command: `/tech-design ${key}`,
        status: this.checkPhase(epicDir, key, 'design'),
        artifact: this.artifactExists(epicDir, 'TECH-DESIGN.md') ? 'TECH-DESIGN.md' : null,
        artifactPath: this.getArtifactPath(epicDir, 'TECH-DESIGN.md'),
        input: 'PRD, DIContainer.swift, AppState.swift, existing code',
        output: 'Architecture, API contract, DI plan, File impact list',
      },
      {
        id: 'test-plan',
        name: 'Test Plan',
        agent: 'QA Engineer',
        agentEmoji: 'QA',
        command: `/test-plan ${key}`,
        status: this.checkPhase(epicDir, key, 'test-plan'),
        artifact: this.artifactExists(epicDir, 'TEST-PLAN.md') ? 'TEST-PLAN.md' : null,
        artifactPath: this.getArtifactPath(epicDir, 'TEST-PLAN.md'),
        input: 'PRD acceptance criteria, Tech Design file impact, ITS',
        output: 'Test cases (UT/UI/CAM/NET/LC/PM/PF), Device matrix',
      },
      {
        id: 'implement',
        name: 'Implement',
        agent: 'Developer',
        agentEmoji: 'Dev',
        command: `git checkout -b feature/${key}-desc`,
        status: this.checkPhase(epicDir, key, 'implement'),
        artifact: null,
        artifactPath: null,
        input: 'Tech Design blueprint, Test Plan test IDs, Coding rules',
        output: 'Swift files on feature branch, Unit tests, PR commits',
      },
      {
        id: 'review',
        name: 'Review',
        agent: 'Tech Lead',
        agentEmoji: 'TL',
        command: '/review',
        status: this.checkPhase(epicDir, key, 'review'),
        artifact: null,
        artifactPath: null,
        input: 'Git diff, PRD, Tech Design, Test Plan',
        output: 'AC validation table, Architecture check, Verdict',
      },
      {
        id: 'uat',
        name: 'UAT',
        agent: 'QA Engineer',
        agentEmoji: 'QA',
        command: `/uat ${key} + /deploy uat`,
        status: this.checkPhase(epicDir, key, 'uat'),
        artifact: this.artifactExists(epicDir, 'UAT-SCRIPT.md') ? 'UAT-SCRIPT.md' : null,
        artifactPath: this.getArtifactPath(epicDir, 'UAT-SCRIPT.md'),
        input: 'PRD acceptance criteria, Merged code',
        output: 'UAT Script, TestFlight UAT build, Tester sign-off',
      },
      {
        id: 'release',
        name: 'Release',
        agent: 'Release Manager',
        agentEmoji: 'RM',
        command: '/release X.Y.Z + /deploy prod',
        status: this.checkPhase(epicDir, key, 'release'),
        artifact: null,
        artifactPath: null,
        input: 'Git log, Epic UAT status, WhatsNew template',
        output: 'Release checklist, App Store notes, 7 WhatsNew JSONs, Git tag',
      },
      {
        id: 'monitor',
        name: 'Monitor',
        agent: 'SRE',
        agentEmoji: 'SRE',
        command: '/monitor vX.Y.Z',
        status: this.checkPhase(epicDir, key, 'monitor'),
        artifact: null,
        artifactPath: null,
        input: 'App Store Connect crashes, Segment events, Intercom tickets',
        output: 'Health Report, KHI table, GO/HOTFIX decision',
      },
      {
        id: 'doc-sync',
        name: 'Doc Sync',
        agent: 'Archivist',
        agentEmoji: 'Arc',
        command: `/doc-sync ${key}`,
        status: this.checkPhase(epicDir, key, 'doc-sync'),
        artifact: this.artifactExists(epicDir, 'DOC-REVERSE-SYNC.md') ? 'DOC-REVERSE-SYNC.md' : null,
        artifactPath: this.getArtifactPath(epicDir, 'DOC-REVERSE-SYNC.md'),
        input: 'PRD plan, Tech Design plan, Actual git commits',
        output: 'Updated core-business docs, Reverse-sync checklist',
      },
    ];
  }

  private checkPhase(epicDir: string, key: string, phase: string): 'done' | 'pending' {
    switch (phase) {
      case 'plan':
        return (this.hasContent(epicDir, `${key}.md`) || this.hasContent(epicDir, 'PRD.md')) ? 'done' : 'pending';
      case 'design':
        return this.hasContent(epicDir, 'TECH-DESIGN.md') ? 'done' : 'pending';
      case 'test-plan':
        return this.hasContent(epicDir, 'TEST-PLAN.md') ? 'done' : 'pending';
      case 'implement':
        return this.hasGitBranch(key) ? 'done' : 'pending';
      case 'review':
        // Check if APPROVAL.md has "approved" or review passed markers
        return this.hasApproval(epicDir) ? 'done' : 'pending';
      case 'uat':
        return this.hasContent(epicDir, 'UAT-SCRIPT.md') ? 'done' : 'pending';
      case 'release':
        return this.hasReleaseTag(key) ? 'done' : 'pending';
      case 'monitor':
        // No persistent artifact — check if doc-sync is done (implies monitor passed)
        return this.hasContent(epicDir, 'DOC-REVERSE-SYNC.md') ? 'done' : 'pending';
      case 'doc-sync':
        return this.hasContent(epicDir, 'DOC-REVERSE-SYNC.md') ? 'done' : 'pending';
      default:
        return 'pending';
    }
  }

  private static readonly TEMPLATE_MARKERS = [
    '{{',
    '[TODO]',
    '[Feature Title]',
    'Epic Title]',
    'YYYY-MM-DD',
    'Copy to `docs/sdlc/epics/',
  ];

  private hasContent(dir: string, filename: string): boolean {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) { return false; }
    const content = fs.readFileSync(filePath, 'utf8');
    const stripped = content.replace(/^---[\s\S]*?---/, '').trim();
    if (stripped.length <= 200) { return false; }
    return !EpicScanner.TEMPLATE_MARKERS.some(marker => stripped.includes(marker));
  }

  private artifactExists(dir: string, filename: string): boolean {
    return fs.existsSync(path.join(dir, filename));
  }

  private getArtifactPath(dir: string, filename: string): string | null {
    const p = path.join(dir, filename);
    return fs.existsSync(p) ? p : null;
  }

  private hasGitBranch(key: string): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync(`git branch --all --list "*${key}*"`, {
        cwd: this.epicsDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  private hasApproval(dir: string): boolean {
    const approvalPath = path.join(dir, 'APPROVAL.md');
    if (!fs.existsSync(approvalPath)) { return false; }
    const content = fs.readFileSync(approvalPath, 'utf8');
    // Template has unchecked [ ] and the word "Approved" as option text — not real approval.
    // Real approval requires at least 3 checked [x] items (PM, TL, QA sign-offs).
    const checkedCount = (content.match(/\[x\]/gi) || []).length;
    return checkedCount >= 3;
  }

  private hasReleaseTag(key: string): boolean {
    try {
      const { execSync } = require('child_process');
      // Check if any release tag exists that includes commits from this epic
      const result = execSync(`git log --all --oneline --grep="${key}" --format="%D" | grep -o "tag: v[0-9]*\\.[0-9]*\\.[0-9]*" | head -1`, {
        cwd: this.epicsDir,
        encoding: 'utf8',
        timeout: 5000,
        shell: '/bin/zsh',
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  private readEnabledPhases(epicDir: string): string[] {
    const configPath = path.join(epicDir, 'pipeline.json');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.enabledPhases) && parsed.enabledPhases.length > 0) {
          return parsed.enabledPhases;
        }
      } catch { /* ignore */ }
    }
    // Default: all phases
    return ['plan', 'design', 'test-plan', 'implement', 'review', 'uat', 'release', 'monitor', 'doc-sync'];
  }

  private extractTitle(epicDir: string, key: string): string {
    const epicFile = path.join(epicDir, `${key}.md`);
    if (!fs.existsSync(epicFile)) { return key; }
    const content = fs.readFileSync(epicFile, 'utf8');
    // Try to find title from first # heading
    const match = content.match(/^#\s+(.+)$/m);
    if (match) {
      return match[1].replace(key, '').replace(/[:\-—–]/g, '').trim() || key;
    }
    return key;
  }

  detectCurrentPhase(phases: PhaseStatus[]): number {
    for (let i = 0; i < phases.length; i++) {
      if (phases[i].status !== 'done') {
        return i;
      }
    }
    return phases.length; // all done
  }
}
