import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareEvalRun } from '../harness/runWorkspace';
import { loadScenario } from '../harness/scenario';

suite('Eval scenario harness', () => {
    test('loads the minimal scenario and copies its fixture into an isolated run', async () => {
        const evalsRoot = path.resolve(__dirname, '..', '..');
        const scenario = await loadScenario(path.join(
            evalsRoot,
            'scenarios',
            'minimal-tool-loop',
            'scenario.json'
        ));
        const temporaryEvalsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-evals-harness-'));

        const run = await prepareEvalRun(temporaryEvalsRoot, scenario);

        assert.strictEqual(scenario.id, 'minimal-tool-loop');
        assert.strictEqual(
            (await fs.readFile(path.join(run.workspacePath, 'seed.txt'), 'utf8'))
                .replace(/\r\n/g, '\n'),
            'webcode deterministic fixture\n'
        );
        assert.notStrictEqual(path.resolve(run.workspacePath), path.resolve(scenario.fixturePath));
    });
});
