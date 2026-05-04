/**
 * Zod schema for `.aidlc/workspace.yaml`.
 *
 * Single source of truth for what a valid AIDLC workspace looks like.
 * Everything else in the loader is structurally typed off `WorkspaceConfig`,
 * so adding a field here automatically propagates to the loader, runner,
 * sidebar renderer, etc. — no manual interface duplication.
 *
 * Validation happens at load time. Invalid YAML produces a thrown
 * `WorkspaceValidationError` with the Zod issue list, which the extension
 * surfaces via the Output panel + diagnostics.
 */

import { z } from 'zod';

// ── Skills ─────────────────────────────────────────────────────────

const SkillSchema = z
  .object({
    id: z.string().min(1),
    /** True for skills bundled with @aidlc/core (no path needed). */
    builtin: z.boolean().optional(),
    /** Relative path to a custom .md skill, e.g. ./.aidlc/skills/foo.md */
    path: z.string().optional(),
  })
  .refine((s) => s.builtin || s.path, {
    message: 'Skill must declare either `builtin: true` or `path: ...`',
  });

// ── Agents ─────────────────────────────────────────────────────────

/**
 * What data sources / external services this agent is allowed to read at
 * run time. Capabilities are *declarative permissions*, not concrete values
 * — declaring `jira` means "this agent can read Jira"; the specific ticket
 * key is supplied per-run (e.g. when starting an epic), never baked into
 * workspace.yaml.
 *
 * Phase 1 ships well-known ids: `jira`, `figma`, `core-business`, `github`,
 * `slack`, `files`, `web`. Users can also write any custom string —
 * downstream tooling can match on whatever it understands.
 */
const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Skill id — must reference a skill in the `skills` list. */
  skill: z.string().min(1),
  model: z.string().optional(),
  runner: z.enum(['default', 'custom']).default('default'),
  /** Required when runner === 'custom'. Relative path to .js or .ts file. */
  runner_path: z.string().optional(),
  /** Per-agent env overrides (layered over workspace.environment). */
  env: z.record(z.string(), z.string()).optional(),
  /** Read-permissions: which data sources the agent may pull from. */
  capabilities: z.array(z.string().min(1)).optional(),

  // Display-only metadata. The runner ignores these — they exist so the
  // sidebar / Builder / Epics panel can show "what does this step take in,
  // what does it produce" without forcing the user to read the skill .md.
  /** One-line summary shown beneath the agent name. */
  description: z.string().optional(),
  /** Free-form description of what context this agent needs. */
  inputs: z.string().optional(),
  /** Free-form description of what this agent produces. */
  outputs: z.string().optional(),
  /** File path or filename pattern for the artifact this step writes. */
  artifact: z.string().optional(),

  depends_on: z.array(z.string()).optional(),
}).refine(
  (a) => a.runner !== 'custom' || !!a.runner_path,
  { message: 'Agent with `runner: custom` must set `runner_path`' },
);

// ── Slash commands ─────────────────────────────────────────────────

const SlashCommandSchema = z.union([
  z.object({
    name: z.string().regex(/^\//, 'Slash commands must start with `/`'),
    agent: z.string().min(1),
  }),
  z.object({
    name: z.string().regex(/^\//),
    pipeline: z.string().min(1),
  }),
]);

// ── Pipelines ──────────────────────────────────────────────────────

/**
 * A pipeline step is either a bare agent id (legacy form) or an object
 * with gating metadata. The object form lets the pipeline runner enforce
 * artifact preconditions (`requires`), validate produced artifacts
 * (`produces`), and pause for human approval (`human_review`).
 *
 * Artifact paths support `{<context-key>}` placeholders that get resolved
 * from the run's context map at execution time — e.g.
 * `docs/sdlc/epics/{epic}/PRD.md` becomes
 * `docs/sdlc/epics/DRM-2100/PRD.md` for a run with `context.epic == "DRM-2100"`.
 */
const PipelineStepObjectSchema = z.object({
  agent: z.string().min(1),
  /** Artifact paths the step is expected to produce. Checked after work. */
  produces: z.array(z.string().min(1)).default([]),
  /** Artifact paths required from upstream. Gate-checked before work. */
  requires: z.array(z.string().min(1)).default([]),
  /** When true, the runner pauses for human approval before advancing. */
  human_review: z.boolean().default(false),
});

const PipelineStepSchema = z.union([
  z.string().min(1),
  PipelineStepObjectSchema,
]);

const PipelineSchema = z.object({
  id: z.string().min(1),
  steps: z.array(PipelineStepSchema).min(1),
  on_failure: z.enum(['stop', 'continue']).default('stop'),
});

export type PipelineStepConfig = z.infer<typeof PipelineStepSchema>;

/** Step in normalized form (object with all defaults applied). */
export interface NormalizedStep {
  agent: string;
  produces: string[];
  requires: string[];
  human_review: boolean;
}

/** Convert either form of a pipeline step into the normalized object. */
export function normalizeStep(step: PipelineStepConfig): NormalizedStep {
  if (typeof step === 'string') {
    return { agent: step, produces: [], requires: [], human_review: false };
  }
  return step;
}

/**
 * Extract the agent id from a pipeline step, accepting both legacy
 * string form and object form. Returns empty string for malformed input
 * so callers don't have to null-check before passing into UI strings.
 */
export function stepAgentId(step: unknown): string {
  if (typeof step === 'string') { return step; }
  if (step && typeof step === 'object' && typeof (step as { agent?: unknown }).agent === 'string') {
    return (step as { agent: string }).agent;
  }
  return '';
}

// ── Domain state (optional) ────────────────────────────────────────

/**
 * Declares an entity type whose state persists across runs (e.g. epic / ticket
 * / customer). Pipeline runs read + write entity state files; the sidebar
 * renders them via the `state-tree` view type.
 *
 * Layout convention: `<root>/<entity-id>/<status_file>` (one file per entity).
 */
const StateSchema = z.object({
  entity: z.string().min(1),
  root: z.string().min(1),
  status_file: z.string().default('.state.json'),
  /**
   * Free-form schema description — drives Config UI form generation in M3.
   * Phase 1 doesn't enforce field validation; the runner is trusted to write
   * conformant data.
   */
  schema: z.record(z.string(), z.unknown()).optional(),
});

// ── Sidebar views (optional) ───────────────────────────────────────

/**
 * Per-project sidebar layout. Workspaces declare which view types appear
 * in the `cfPipelineView` panel. If omitted, sidebar shows defaults
 * (agents-list + run-history).
 *
 * View types are enumerated here to keep the contract closed — a new view
 * type means new code in the renderer + a schema bump. (Custom view plugins
 * are explicitly out of scope per design discussion.)
 */
const FileTreeViewSchema = z.object({
  type: z.literal('file-tree'),
  label: z.string().default('Files'),
  /** Glob relative to workspace root, e.g. `docs/sdlc/epics/*\/*.md`. */
  glob: z.string().min(1),
  /** Group matched files by their parent directory. Default keeps it flat. */
  group_by: z.enum(['parent_dir', 'flat']).default('flat'),
});

const StateTreeViewSchema = z.object({
  type: z.literal('state-tree'),
  /** Reference to `state.entity`. Must match. */
  state: z.string().min(1),
  label: z.string().optional(),
});

const SimpleViewSchema = z.object({
  type: z.enum(['agents-list', 'skills-list', 'run-history', 'pipelines-list']),
  label: z.string().optional(),
});

const SidebarViewSchema = z.discriminatedUnion('type', [
  FileTreeViewSchema,
  StateTreeViewSchema,
  SimpleViewSchema,
]);

const SidebarSchema = z.object({
  views: z.array(SidebarViewSchema).default([]),
});

// ── Top-level workspace ────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  /** Schema version — bump on breaking changes. Currently always "1.0". */
  version: z.string().min(1),
  /** Human-readable workspace name. Shown in the sidebar header. */
  name: z.string().min(1),

  agents: z.array(AgentSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  /** Workspace-wide environment, layered under per-agent env. */
  environment: z.record(z.string(), z.string()).default({}),
  slash_commands: z.array(SlashCommandSchema).default([]),
  pipelines: z.array(PipelineSchema).default([]),

  state: StateSchema.optional(),
  sidebar: SidebarSchema.optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>;
export type AgentConfig = z.infer<typeof AgentSchema>;
export type SkillConfig = z.infer<typeof SkillSchema>;
export type SlashCommandConfig = z.infer<typeof SlashCommandSchema>;
export type PipelineConfig = z.infer<typeof PipelineSchema>;
export type StateConfig = z.infer<typeof StateSchema>;
export type SidebarConfig = z.infer<typeof SidebarSchema>;
export type SidebarView = z.infer<typeof SidebarViewSchema>;

/** Thrown by WorkspaceLoader when YAML doesn't conform to WorkspaceSchema. */
export class WorkspaceValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.core.$ZodIssue[],
    public readonly path: string,
  ) {
    super(`[workspace ${path}] ${message}`);
    this.name = 'WorkspaceValidationError';
  }
}

/**
 * Validate a parsed YAML object against the schema.
 * Throws WorkspaceValidationError with the issue list on failure.
 */
export function validateWorkspace(raw: unknown, path: string): WorkspaceConfig {
  const result = WorkspaceSchema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 5)
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new WorkspaceValidationError(
      `Invalid workspace.yaml:\n${summary}`,
      result.error.issues,
      path,
    );
  }
  return result.data;
}
