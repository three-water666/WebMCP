import * as fs from 'fs/promises';
import * as path from 'path';

export class SessionCheckpointPersistence {
    async save(
        workspaceRoot: string,
        content: string
    ): Promise<string> {
        const checkpointPath = path.join(
            workspaceRoot,
            'SESSION_CHECKPOINT.md'
        );

        await fs.writeFile(
            checkpointPath,
            content,
            'utf8'
        );

        return checkpointPath;
    }
}
