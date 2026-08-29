export function getRemoteToolPublicName(serverId: string, toolName: string): string {
    return `${serverId}:${toolName}`;
}

const LOCAL_PATH_TOOL_NAMES = new Set([
    'attach_file',
    'read_file',
    'read_text_file',
    'read_multiple_files',
    'write_file',
    'edit_file',
    'append_file',
    'list_directory',
    'list_directory_with_sizes',
    'directory_tree',
    'move_file',
    'search_files',
    'get_file_info',
    'create_directory'
]);

export function isLocalPathToolName(toolName: string): boolean {
    return LOCAL_PATH_TOOL_NAMES.has(toolName) || toolName.startsWith('git_');
}
