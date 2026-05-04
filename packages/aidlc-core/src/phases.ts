export const PHASE_ORDER = [
  'plan',
  'design',
  'test-plan',
  'implement',
  'review',
  'execute-test',
  'release',
  'monitor',
  'doc-sync',
] as const;

export type PhaseId = typeof PHASE_ORDER[number];

export const PHASE_ID_SET: ReadonlySet<string> = new Set(PHASE_ORDER);

/** Which phases a review of `phase` may cascade-reject back to. */
export const REJECT_TO: Readonly<Record<string, string[]>> = {
  'design':       ['plan'],
  'test-plan':    ['plan', 'design'],
  'implement':    ['plan', 'design', 'test-plan'],
  'review':       ['plan', 'design', 'test-plan', 'implement'],
  'execute-test': ['plan', 'design', 'test-plan', 'implement', 'review'],
  'release':      ['plan', 'design', 'test-plan', 'implement', 'review', 'execute-test'],
  'monitor':      ['plan', 'design', 'test-plan', 'implement', 'review', 'execute-test', 'release'],
  'doc-sync':     ['plan', 'design', 'test-plan', 'implement', 'review', 'execute-test', 'release', 'monitor'],
};
