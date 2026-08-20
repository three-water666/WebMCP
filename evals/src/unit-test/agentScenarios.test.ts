import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { prepareEvalRun } from '../harness/runWorkspace';
import { discoverAgentScenarios } from '../harness/scenario';

suite('Agent eval scenarios', () => {
    const evalsRoot = path.resolve(__dirname, '..', '..');

    test('discovers one validated scenario for every first-batch category', async () => {
        const scenarios = await discoverAgentScenarios(path.join(evalsRoot, 'scenarios'));
        assert.strictEqual(scenarios.length, 6);
        assert.deepStrictEqual(
            new Set(scenarios.map(scenario => scenario.category)),
            new Set(['read-code', 'implement-feature', 'fix-bug', 'write-tests', 'follow-skill', 'use-mcp'])
        );
        assert.strictEqual(new Set(scenarios.map(scenario => scenario.id)).size, scenarios.length);
    });

    test('copies only the visible fixture into an isolated run workspace', async () => {
        const scenarios = await discoverAgentScenarios(path.join(evalsRoot, 'scenarios'));
        const scenario = scenarios.find(item => item.id === 'follow-skill-release-notes');
        assert.ok(scenario);
        const run = await prepareEvalRun(evalsRoot, scenario);
        try {
            assert.strictEqual(
                await fs.readFile(path.join(run.workspacePath, '.agents', 'skills', 'release-note', 'SKILL.md'), 'utf8')
                    .then(() => true),
                true
            );
            await assert.rejects(fs.access(path.join(run.workspacePath, 'grader.mjs')));
            await assert.rejects(fs.access(path.join(run.workspacePath, 'task.md')));
            await assert.rejects(fs.access(path.join(run.workspacePath, 'reference')));
        } finally {
            await fs.rm(run.runDirectory, { recursive: true, force: true });
        }
    });
});
