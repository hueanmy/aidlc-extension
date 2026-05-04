/**
 * Built-in workspace presets shipped with the extension.
 *
 * Phase 1 ships the **SDLC Pipeline** preset, ported from the legacy
 * aidlc-pipeline orchestrator: Plan → Design → Test Plan → Implement →
 * Review → Execute Test → Release → Monitor → Doc Sync, with PO / Tech
 * Lead / QA / Developer / RM / SRE / Archivist agents.
 *
 * Each phase's v2 skill is composed at load time from two source files
 * bundled under `templates/sdlc/`:
 *   - `agents/<persona>.md`  — agent persona (PO, Tech Lead, …)
 *   - `skills/<id>.md`        — slash-command instruction (epic, tech-design, …)
 * The two are joined with a separator so the composed skill is
 * self-contained — applying the preset yields a single .md per phase
 * that doesn't need extra `.claude/agents/*` files to work.
 *
 * Built-in presets carry `builtin: true`. Wizards use that to label them
 * "(built-in)" in pickers and skip them from delete flows.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { WorkspacePreset } from './presetStore';

interface PhaseDef {
  id: string;
  name: string;
  persona: string;        // file under agents/
  skillFile: string | null; // file under skills/, or null = use persona only
  model: string;
  description: string;
  inputs: string;
  outputs: string;
  artifact: string;
}

const PHASES: PhaseDef[] = [
  {
    id: 'plan', name: 'Plan', persona: 'po', skillFile: 'epic', model: 'claude-opus-4-7',
    description: 'Scaffold the epic and write the PRD.',
    inputs: 'Jira ticket, business context, Figma designs',
    outputs: 'Epic doc + PRD with measurable acceptance criteria',
    artifact: 'PRD.md',
  },
  {
    id: 'design', name: 'Design', persona: 'tech-lead', skillFile: 'tech-design', model: 'claude-opus-4-7',
    description: 'Design the implementation approach.',
    inputs: 'PRD, existing code, dependency graph',
    outputs: 'Architecture, API contract, DI plan, file impact list',
    artifact: 'TECH-DESIGN.md',
  },
  {
    id: 'test-plan', name: 'Test Plan', persona: 'qa', skillFile: 'test-plan', model: 'claude-sonnet-4-6',
    description: 'Plan how the feature will be verified.',
    inputs: 'PRD acceptance criteria, tech design, ITS / device matrix',
    outputs: 'Test cases (UT / UI / integration / performance), device matrix',
    artifact: 'TEST-PLAN.md',
  },
  {
    id: 'implement', name: 'Implement', persona: 'developer', skillFile: null, model: 'claude-sonnet-4-6',
    description: 'Build the feature on a feature branch.',
    inputs: 'Tech design, test plan, project coding rules',
    outputs: 'Code + unit tests on feature branch, PR opened',
    artifact: 'feature/<EPIC>-<slug>',
  },
  {
    id: 'review', name: 'Review', persona: 'auto-reviewer', skillFile: 'review', model: 'claude-opus-4-7',
    description: 'Review the diff against the PRD + tech design.',
    inputs: 'Git diff, PRD, tech design, test plan',
    outputs: 'AC validation table, architecture check, verdict (pass / reject)',
    artifact: 'APPROVAL.md',
  },
  {
    id: 'execute-test', name: 'Execute Test', persona: 'qa', skillFile: 'execute-test', model: 'claude-sonnet-4-6',
    description: 'Run the test plan on the merged code.',
    inputs: 'Merged code, test plan, UAT environment',
    outputs: 'Test execution report, tester sign-off',
    artifact: 'TEST-SCRIPT.md',
  },
  {
    id: 'release', name: 'Release', persona: 'release-manager', skillFile: 'release', model: 'claude-sonnet-4-6',
    description: 'Cut the release.',
    inputs: 'Git log since last tag, epic test execution status',
    outputs: 'Release checklist, app store / changelog notes, version tag',
    artifact: 'v<X.Y.Z> tag',
  },
  {
    id: 'monitor', name: 'Monitor', persona: 'sre', skillFile: 'monitor', model: 'claude-sonnet-4-6',
    description: 'Watch production for regressions after release.',
    inputs: 'App Store crashes, analytics events, support tickets',
    outputs: 'Health report, KHI table, Go / Hotfix decision',
    artifact: 'HEALTH-REPORT.md',
  },
  {
    id: 'doc-sync', name: 'Doc Sync', persona: 'archivist', skillFile: 'doc-sync', model: 'claude-sonnet-4-6',
    description: 'Reverse-sync docs to match what was actually built.',
    inputs: 'PRD plan, tech design plan, actual git commits',
    outputs: 'Updated core-business / architecture docs, reverse-sync checklist',
    artifact: 'DOC-REVERSE-SYNC.md',
  },
];

const IMPLEMENT_FALLBACK_INSTRUCTION = `# Implement Phase

You are responsible for translating the approved tech design + test plan
into working code on a feature branch.

**Workflow**

1. Read \`docs/sdlc/epics/<KEY>/TECH-DESIGN.md\` and \`docs/sdlc/epics/<KEY>/TEST-PLAN.md\`.
2. Create a feature branch \`feature/<KEY>-<short-slug>\` from main.
3. Implement files listed in the design's File Impact section.
4. Write the unit tests called out in the test plan as you go (test-first
   when reasonable, alongside otherwise — don't skip them).
5. Run the project's lint + typecheck + test commands locally before
   handing off to /review.
6. Open a PR with the body referencing the epic key.

**Style rules**

- Match existing code conventions; don't introduce new patterns unless the
  tech design called for them.
- Keep diffs small and reviewable.
- No silent behavior changes outside the epic scope.
`;

/**
 * Load + compose the SDLC built-in preset. Bundled .md files are read at
 * runtime from the extension's installed location, so the build pipeline
 * doesn't need a separate "compose preset JSON" step.
 */
export function loadSdlcPreset(extensionPath: string): WorkspacePreset {
  const sdlcDir = path.join(extensionPath, 'templates', 'sdlc');
  const agentsDir = path.join(sdlcDir, 'agents');
  const skillsDir = path.join(sdlcDir, 'skills');

  const skillContents: Record<string, string> = {};
  const agents: Array<Record<string, unknown>> = [];
  const skills: Array<Record<string, unknown>> = [];
  const slashCommands: Array<Record<string, unknown>> = [];

  for (const phase of PHASES) {
    const personaPath = path.join(agentsDir, `${phase.persona}.md`);
    const persona = fs.existsSync(personaPath)
      ? fs.readFileSync(personaPath, 'utf8')
      : `# ${phase.name}\n\n(persona file missing: agents/${phase.persona}.md)\n`;

    let instruction: string;
    if (phase.skillFile) {
      const skillPath = path.join(skillsDir, `${phase.skillFile}.md`);
      instruction = fs.existsSync(skillPath)
        ? fs.readFileSync(skillPath, 'utf8')
        : `# /${phase.id}\n\n(skill file missing: skills/${phase.skillFile}.md)\n`;
    } else {
      instruction = IMPLEMENT_FALLBACK_INSTRUCTION;
    }

    skillContents[phase.id] = composeSkill(persona, instruction, phase.id);

    skills.push({ id: phase.id, path: `./.aidlc/skills/${phase.id}.md` });
    agents.push({
      id: phase.id,
      name: phase.name,
      skill: phase.id,
      model: phase.model,
      description: phase.description,
      inputs: phase.inputs,
      outputs: phase.outputs,
      artifact: phase.artifact,
    });
    slashCommands.push({ name: `/${phase.id}`, agent: phase.id });
  }

  const pipeline = {
    id: 'sdlc-full',
    steps: PHASES.map((p) => p.id),
    on_failure: 'stop' as const,
  };

  return {
    formatVersion: 1,
    builtin: true,
    id: 'sdlc-pipeline',
    name: 'SDLC Pipeline',
    description: 'Plan → Design → Test Plan → Implement → Review → Execute Test → Release → Monitor → Doc Sync. Ported from the legacy aidlc-pipeline orchestrator with PO / Tech Lead / QA / Developer / RM / SRE / Archivist agents.',
    savedAt: '2026-01-01T00:00:00Z',
    workspace: {
      version: '1.0',
      agents,
      skills,
      environment: {},
      slash_commands: slashCommands,
      pipelines: [pipeline],
      sidebar: {
        views: [
          { type: 'agents-list' },
          { type: 'skills-list' },
          { type: 'pipelines-list' },
        ],
      },
    },
    skillContents,
  };
}

/**
 * Compose a self-contained v2 skill from an agent persona + slash-command
 * instruction. Strips the original `Load your full persona from .claude/...`
 * lines because the persona is now inlined right above.
 */
function composeSkill(persona: string, instruction: string, phaseId: string): string {
  const cleanedInstruction = instruction
    .replace(/^.*Load your full persona from `?\.?\.?\/?\.claude\/agents\/[^\n]*\n/gm, '')
    .replace(/^.*Reference `?\.?\.?\/?\.claude\/agents\/[^\n]*\n/gm, '');

  return [
    `<!-- Composed by AIDLC Flow built-in preset "sdlc-pipeline" — phase: ${phaseId} -->`,
    '',
    '## Persona',
    '',
    persona.trim(),
    '',
    '---',
    '',
    '## Phase Behavior',
    '',
    cleanedInstruction.trim(),
    '',
  ].join('\n');
}

/**
 * List of built-in preset ids — used by wizards to flag them as undeletable
 * and to skip them when listing user presets only.
 */
export const BUILTIN_PRESET_IDS = new Set<string>(['sdlc-pipeline']);

export function isBuiltinPreset(id: string): boolean {
  return BUILTIN_PRESET_IDS.has(id);
}
