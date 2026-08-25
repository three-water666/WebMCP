# Task: add effective tests for `mergeIntervals`

Write Node.js tests for `src/mergeIntervals.mjs` using the built-in `node:test` and
`node:assert` modules. Do not change the implementation.

Your tests must cover at least:

- unsorted input;
- touching intervals, which must merge;
- intervals fully contained by another interval;
- empty input;
- input immutability.

Put the tests under `test/` and make sure `node --test` succeeds.
