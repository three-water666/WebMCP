import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_QA_SCENARIO_ID,
  DEFAULT_QA_SITE_ID,
  parseQaStartArguments,
} from './qa-start-arguments.mjs';

test('QA start defaults to DeepSeek and the minimal scenario', () => {
  assert.deepEqual(parseQaStartArguments([]), {
    siteId: DEFAULT_QA_SITE_ID,
    scenarioId: DEFAULT_QA_SCENARIO_ID,
  });
  assert.equal(DEFAULT_QA_SITE_ID, 'deepseek');
});

test('QA start honors an explicitly selected site and scenario', () => {
  assert.deepEqual(parseQaStartArguments(['chatgpt', 'read-code-call-chain']), {
    siteId: 'chatgpt',
    scenarioId: 'read-code-call-chain',
  });
});

test('QA start rejects invalid or excess arguments', () => {
  assert.throws(() => parseQaStartArguments(['not/a/site']), /Invalid site id/);
  assert.throws(
    () => parseQaStartArguments(['deepseek', 'minimal-tool-loop', 'extra']),
    /accepts at most a site id and an agent scenario id/
  );
});
