import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeIntervals } from '../src/mergeIntervals.mjs';

test('merges unsorted and touching intervals without mutating input', () => {
  const input = [[8, 10], [1, 3], [3, 6]];
  const snapshot = structuredClone(input);
  assert.deepEqual(mergeIntervals(input), [[1, 6], [8, 10]]);
  assert.deepEqual(input, snapshot);
});

test('keeps the wider end when one interval contains another', () => {
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3], [4, 8]]), [[1, 10]]);
});

test('returns an empty list for empty input', () => {
  assert.deepEqual(mergeIntervals([]), []);
});
