export function escapeWindowsCmdArgument(arg: string): string {
    let result = '';
    let segment = '';

    // Used with windowsVerbatimArguments: build a cmd.exe command-line token, not a spawn argv value.
    const flushSegment = () => {
        if (!segment) {
            return;
        }

        result += quoteWindowsArgumentSegment(segment);
        segment = '';
    };

    for (const char of arg) {
        if (char === '%') {
            flushSegment();
            result += '^%';
            continue;
        }

        segment += char;
    }

    flushSegment();
    return result || '""';
}

function quoteWindowsArgumentSegment(segment: string): string {
    let result = '"';
    let backslashCount = 0;

    for (const char of segment) {
        if (char === '\\') {
            backslashCount += 1;
            continue;
        }

        if (char === '"') {
            result += '\\'.repeat(backslashCount * 2 + 1);
            result += '"';
            backslashCount = 0;
            continue;
        }

        result += '\\'.repeat(backslashCount);
        result += char;
        backslashCount = 0;
    }

    result += '\\'.repeat(backslashCount * 2);
    result += '"';
    return result;
}
