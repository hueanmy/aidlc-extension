/**
 * Bundled skill templates exposed by the "Add Skill → Load template" wizard
 * step. Kept inline as TypeScript constants (vs. shipping .md files) so the
 * VSIX picks them up automatically without messing with .vscodeignore.
 *
 * Add new templates by appending to SKILL_TEMPLATES below. Each template
 * shows up in the picker as "<id> — <description>".
 *
 * Style guideline: keep prompts focused (one job per skill), include
 * concrete acceptance criteria so the user can adapt without rewriting.
 */

export interface SkillTemplate {
  id: string;
  description: string;
  /** Suggested skill id when scaffolded. User can override. */
  suggestedFilename: string;
  content: string;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'hello-world',
    description: 'Minimal greeting agent — good first skill to verify the runner works',
    suggestedFilename: 'hello-skill.md',
    content: `# Hello World Skill

You are a friendly assistant. Greet the user warmly and ask what they would
like help with today.

**Output rules**

- Keep your reply to two sentences max.
- End with a single open-ended question.
- Plain text only — no markdown, no code blocks.
`,
  },

  {
    id: 'code-reviewer',
    description: 'Review a code diff for bugs, security, performance — outputs structured table',
    suggestedFilename: 'code-reviewer.md',
    content: `# Code Reviewer

You review the supplied code diff. Focus only on issues that would block a
merge in a serious team. Skip nitpicks and stylistic preferences unless
they introduce a real bug.

**For every issue you find, output one row:**

| File:line | Severity | Category | What's wrong | Suggested fix |
|-----------|----------|----------|--------------|---------------|

**Severity**: \`block\` (must fix), \`warn\` (should fix), \`note\` (FYI).
**Category**: bug | security | perf | api-contract | test-coverage.

If there are no blockers, end your reply with \`VERDICT: PASS\`.
Otherwise, end with \`VERDICT: FAIL — N blockers\`.
`,
  },

  {
    id: 'test-converter',
    description: 'Convert one Cypress test file to Playwright equivalent',
    suggestedFilename: 'test-converter.md',
    content: `# Cypress → Playwright Converter

You convert one Cypress test file to its Playwright equivalent.

**Mapping rules**

- \`cy.visit(url)\` → \`await page.goto(url)\`
- \`cy.get(selector).click()\` → \`await page.locator(selector).click()\`
- \`cy.get(selector).type(text)\` → \`await page.locator(selector).fill(text)\`
- \`cy.contains(text)\` → \`page.getByText(text)\`
- Custom commands (\`cy.login()\`, etc.) → call equivalent helpers under
  \`./playwright/helpers/\`. If one doesn't exist, leave a TODO comment.

**Output**

- Plain TypeScript — no fences, no commentary outside the file.
- Use Playwright's \`@playwright/test\` style: \`import { test, expect } ...\`.
- Preserve test names and structure 1:1.
`,
  },

  {
    id: 'doc-writer',
    description: 'Document a function/class given source code — JSDoc-style',
    suggestedFilename: 'doc-writer.md',
    content: `# Documentation Writer

You write API documentation for the supplied function or class.

**Output a single JSDoc-style block** with these sections, in order:

1. One-line summary (purpose, not mechanics).
2. Detailed description (when/why to use, edge cases, gotchas).
3. \`@param\` for every parameter (name, type, description, default if any).
4. \`@returns\` (type + description).
5. \`@throws\` for each exception class.
6. \`@example\` — at least one, runnable as-is.

**Don't**

- Don't repeat the function signature in prose.
- Don't add lifecycle / framework boilerplate not present in the source.
- Don't speculate about future features.
`,
  },

  {
    id: 'release-notes',
    description: 'Summarize a list of git commits into user-facing release notes',
    suggestedFilename: 'release-notes.md',
    content: `# Release Notes Writer

You summarize the supplied list of git commit messages into user-facing
release notes for an end-user audience.

**Output structure**

\`\`\`md
## v<NEW_VERSION>

### ✨ New
- One bullet per genuinely user-visible feature.

### 🛠 Improved
- Performance, reliability, polish — nothing internal-only.

### 🐛 Fixed
- Bug fixes the user might have hit. Skip "fix typo" / "fix CI".

### 🚧 Behind the scenes (optional)
- Refactors, deps, tooling — only if the audience cares.
\`\`\`

**Rules**

- Translate engineer-speak into user-speak. "Switched API client to
  retry on 503" → "Fewer dropped requests when the server is busy".
- Skip merge commits, version bumps, and changelog edits themselves.
- If a commit doesn't map to a user-visible change, drop it.
`,
  },
];

export function findTemplate(id: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find((t) => t.id === id);
}
