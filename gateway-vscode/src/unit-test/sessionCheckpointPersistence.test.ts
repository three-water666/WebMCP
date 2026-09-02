import assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SessionCheckpointPersistence } from '../session/sessionCheckpointPersistence';

suite('SessionCheckpointPersistence', () => {
    test('writes checkpoint markdown file', async () => {
        const workspaceRoot = await fs.mkdtemp(
            path.join(os.tmpdir(), 'checkpoint-')
        );

        const persistence = new SessionCheckpointPersistence();
        const result = await persistence.save(
            workspaceRoot,
            '# Session Checkpoint\n'
        );

        assert.strictEqual(
            result,
            path.join(workspaceRoot, 'SESSION_CHECKPOINT.md')
        );

        assert.strictEqual(
            await fs.readFile(result, 'utf8'),
            '# Session Checkpoint\n'
        );
    });
});
