/** Bundled skill templates — kept in sync with packages/extension/src/v2/skillTemplates.ts */

export interface SkillTemplate {
  id: string;
  description: string;
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
- Custom commands → call equivalent helpers under \`./playwright/helpers/\`.
  If one doesn't exist, leave a TODO comment.

**Output**: plain TypeScript, no fences, no commentary outside the file.
Use Playwright's \`@playwright/test\` style. Preserve test names 1:1.
`,
  },
  {
    id: 'doc-writer',
    description: 'Document a function/class given source code — JSDoc-style',
    suggestedFilename: 'doc-writer.md',
    content: `# Documentation Writer

You write API documentation for the supplied function or class.

**Output a single JSDoc-style block** with these sections:

1. One-line summary (purpose, not mechanics).
2. Detailed description (when/why to use, edge cases, gotchas).
3. \`@param\` for every parameter (name, type, description, default if any).
4. \`@returns\` (type + description).
5. \`@throws\` for each exception class.
6. \`@example\` — at least one, runnable as-is.
`,
  },
  {
    id: 'release-notes',
    description: 'Summarize git commits into user-facing release notes',
    suggestedFilename: 'release-notes.md',
    content: `# Release Notes Writer

You summarize the supplied list of git commit messages into user-facing
release notes for an end-user audience.

**Output structure**

## v<NEW_VERSION>

### ✨ New
### 🛠 Improved
### 🐛 Fixed

**Rules**: translate engineer-speak to user-speak. Skip merge commits,
version bumps, and changelog edits. Drop commits with no user impact.
`,
  },
];

export function findTemplate(id: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find(t => t.id === id);
}

export const TEMPLATE_IDS = SKILL_TEMPLATES.map(t => t.id);
