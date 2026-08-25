import path from 'node:path';

import { check, gradeResult, readText } from '../../graders/grade-utils.mjs';

const EXPECTED = `# Release 1.4.0 — 2026-08-20

## Highlights
- Search workspaces faster.

## Fixes
- Prevent duplicate tool calls after streaming updates.

## Upgrade note
No migration is required.
`;

export async function grade({ workspacePath }) {
  const actual = await readText(path.join(workspacePath, 'RELEASE_NOTES.md'));
  return gradeResult([
    check('skill-output', 100, actual === EXPECTED, 'release notes exactly follow the workspace Skill'),
  ]);
}
