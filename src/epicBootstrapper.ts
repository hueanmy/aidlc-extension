import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_PHASES = [
  'plan',
  'design',
  'test-plan',
  'implement',
  'review',
  'uat',
  'release',
  'monitor',
  'doc-sync',
];

const TEMPLATE_FILE_MAP: Array<{ source: string; target: string }> = [
  { source: 'EPIC-TEMPLATE.md', target: '__EPIC_KEY__.md' },
  { source: 'PRD-TEMPLATE.md', target: 'PRD.md' },
  { source: 'TECH-DESIGN-TEMPLATE.md', target: 'TECH-DESIGN.md' },
  { source: 'TEST-PLAN-TEMPLATE.md', target: 'TEST-PLAN.md' },
  { source: 'APPROVAL-CHECKLIST-TEMPLATE.md', target: 'APPROVAL.md' },
  { source: 'UAT-SCRIPT-TEMPLATE.md', target: 'UAT-SCRIPT.md' },
  { source: 'DOC-REVERSE-SYNC-TEMPLATE.md', target: 'DOC-REVERSE-SYNC.md' },
  { source: 'RELEASE-CHECKLIST-TEMPLATE.md', target: 'RELEASE-CHECKLIST.md' },
  { source: 'ROLLBACK-PLAYBOOK.md', target: 'ROLLBACK-PLAYBOOK.md' },
];

export interface BootstrapResult {
  created: boolean;
  epicKey?: string;
  epicsDir: string;
}

export function ensureEpicsBootstrap(
  workspaceRoot: string,
  configuredEpicsPath: string,
  templateSourcePath: string,
  log: (msg: string) => void,
): BootstrapResult {
  const epicsDir = path.resolve(workspaceRoot, configuredEpicsPath);
  if (!fs.existsSync(epicsDir)) {
    fs.mkdirSync(epicsDir, { recursive: true });
    log(`Created epics directory: ${epicsDir}`);
  }

  const hasExistingEpic = fs.readdirSync(epicsDir, { withFileTypes: true })
    .some((d) => d.isDirectory() && /^[A-Z][A-Z0-9]*-\d+$/.test(d.name));
  if (hasExistingEpic) {
    return { created: false, epicsDir };
  }

  const epicKey = 'EPIC-1000';
  const epicDir = path.join(epicsDir, epicKey);
  fs.mkdirSync(epicDir, { recursive: true });

  const resolvedTemplateRoot = path.isAbsolute(templateSourcePath)
    ? templateSourcePath
    : path.resolve(workspaceRoot, templateSourcePath);

  for (const file of TEMPLATE_FILE_MAP) {
    const sourceFile = path.join(resolvedTemplateRoot, file.source);
    const targetName = file.target.replace('__EPIC_KEY__', epicKey);
    const targetFile = path.join(epicDir, targetName);

    const raw = fs.existsSync(sourceFile)
      ? fs.readFileSync(sourceFile, 'utf8')
      : fallbackTemplate(targetName, epicKey);
    const rendered = renderTemplate(raw, epicKey);
    fs.writeFileSync(targetFile, rendered, 'utf8');
  }

  fs.writeFileSync(
    path.join(epicDir, 'pipeline.json'),
    JSON.stringify({ enabledPhases: DEFAULT_PHASES }, null, 2) + '\n',
    'utf8',
  );

  log(`Seeded default epic template: ${epicKey} (${epicDir})`);
  return { created: true, epicKey, epicsDir };
}

function renderTemplate(content: string, epicKey: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return content
    .replaceAll('[EPIC-KEY]', epicKey)
    .replaceAll('EPIC-XXXX', epicKey)
    .replaceAll('EPIC-YYYY', epicKey)
    .replaceAll('[Epic Title]', 'Initial Epic Template')
    .replaceAll('[Feature Title]', 'Initial Epic Template')
    .replaceAll('YYYY-MM-DD', today)
    .replaceAll('vX.Y.Z', 'v0.1.0')
    .replaceAll('(Build XX)', '(Build 1)')
    .replaceAll('release/X.Y.Z', 'release/0.1.0')
    .replaceAll('v{X.Y.Z}', 'v0.1.0')
    .replaceAll('v{PREVIOUS_VERSION}', 'v0.0.1');
}

function fallbackTemplate(targetName: string, epicKey: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (targetName === `${epicKey}.md`) {
    return `# Epic: ${epicKey} — Initial Epic Template\n\nCreated: ${today}\n`;
  }
  return `# ${targetName}\n\nEpic: ${epicKey}\nCreated: ${today}\n`;
}
