import fs from 'node:fs/promises';
import path from 'node:path';

import { check, gradeResult, runNodeTests, withWorkspaceCopy } from '../../graders/grade-utils.mjs';

const MUTATIONS = [
  {
    id: 'touching-boundary',
    find: 'start <= current[1]',
    replace: 'start < current[1]',
  },
  {
    id: 'contained-interval',
    find: 'Math.max(current[1], end)',
    replace: 'end',
  },
  {
    id: 'unsorted-input',
    find: '.sort((left, right) => left[0] - right[0])',
    replace: '',
  },
];

export async function grade({ workspacePath }) {
  const testDirectory = path.join(workspacePath, 'test');
  const testFiles = await fs.readdir(testDirectory).catch(() => []);
  const baseline = await runNodeTests(workspacePath);
  const mutationChecks = [];

  for (const mutation of MUTATIONS) {
    const killed = await withWorkspaceCopy(workspacePath, async copyPath => {
      const sourcePath = path.join(copyPath, 'src', 'mergeIntervals.mjs');
      const source = await fs.readFile(sourcePath, 'utf8');
      if (!source.includes(mutation.find)) {
        return false;
      }
      await fs.writeFile(sourcePath, source.replace(mutation.find, mutation.replace), 'utf8');
      return (await runNodeTests(copyPath)).exitCode !== 0;
    });
    mutationChecks.push(check(`kills-${mutation.id}-mutant`, 20, killed, `${mutation.id} regression is detected`));
  }

  return gradeResult([
    check('test-files-exist', 10, testFiles.some(file => /\.test\.mjs$/.test(file)), 'test files exist under test/'),
    check('tests-pass', 30, baseline.exitCode === 0, baseline.output.slice(-500) || 'node --test succeeds'),
    ...mutationChecks,
  ]);
}
