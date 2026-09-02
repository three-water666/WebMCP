import type { LocalTool } from './types';
import { textResult } from './result';
import { atomicWriteFile } from './filesystemUtils';
import { WORKSPACE_FILE_PATH_DESCRIPTION, resolveWorkspaceRelativePath } from './workspacePath';

export const writeFileTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'write_file',
        description: 'Create or completely overwrite a UTF-8 text file inside the current VS Code workspace. ' +
            'Parent directories are created automatically if they do not exist. ' +
            'If prior read_file output included line numbers such as "12: code", do not include those line number prefixes in the written content.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: WORKSPACE_FILE_PATH_DESCRIPTION },
                content: {
                    type: 'string',
                    description: 'Complete file content to write. Do not include read_file line number prefixes as file content.'
                }
            },
            required: ['path', 'content']
        },
        annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true }
    },
    async execute(args, context) {
        const filePath = (await resolveWorkspaceRelativePath(context.workspaceRoot, args.path, {
            forWrite: true,
            createParentDirectories: true
        })).absolutePath;
        await atomicWriteFile(filePath, String(args.content));
        context.metricsCollector.recordFileModification(String(args.path));
        context.checkpointState?.recordChangedFile(String(args.path));
        return textResult(`Successfully wrote ${String(args.path)}`);
    }
};
