const WINDOWS_CMD_META_CHARS_PATTERN = /[&|<>^()%!]/g;

export function escapeWindowsCmdArgument(arg: string): string {
    return arg.replace(WINDOWS_CMD_META_CHARS_PATTERN, '^$&');
}
