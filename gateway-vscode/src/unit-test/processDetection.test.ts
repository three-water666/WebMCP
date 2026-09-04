import * as assert from 'assert';
import * as path from 'path';

import {
    browserArgumentsUseProfile,
    browserCommandLineUsesProfile,
    commandLineHasExactArgument,
    getBrowserBridgeMarkerArgument,
    getBrowserFamilyForExecutableName,
    getBrowserProfileMarkerArgument
} from '../extension/processDetection';

suite('Browser process detection', () => {
    test('matches user data dir passed with equals syntax', () => {
        const profileDir = path.posix.join('/root', 'isolated-browser-profiles', 'edge');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge --user-data-dir=${profileDir}`, profileDir, 'linux'),
            true
        );
    });

    test('does not match profile dirs that only share a path prefix', () => {
        const profileDir = path.posix.join('/root', 'isolated-browser-profiles', 'edge');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge --user-data-dir=${profileDir}-backup`, profileDir, 'linux'),
            false
        );
        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge --user-data-dir=${profileDir}2`, profileDir, 'linux'),
            false
        );
    });

    test('matches quoted user data dir passed as the next argument', () => {
        const profileDir = path.posix.join('/root', 'isolated-browser-profiles', 'edge profile');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge --user-data-dir "${profileDir}"`, profileDir, 'linux'),
            true
        );
        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge --user-data-dir '${profileDir}'`, profileDir, 'linux'),
            true
        );
    });

    test('matches quoted equals syntax and ignores trailing slashes', () => {
        const profileDir = path.posix.join('/root', 'isolated-browser-profiles', 'edge');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge --user-data-dir="${profileDir}/"`, profileDir, 'linux'),
            true
        );
    });

    test('matches Windows profile paths case-insensitively', () => {
        const profileDir = path.win32.join('C:\\', 'Users', 'me', 'AppData', 'Local', 'webcode', 'edge');
        const commandProfileDir = path.win32.join('c:\\', 'users', 'ME', 'AppData', 'Local', 'webcode', 'edge');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge.exe --user-data-dir="${commandProfileDir}"`, profileDir, 'win32'),
            true
        );
    });

    test('returns false when no user data dir is present', () => {
        const profileDir = path.posix.join('/root', 'isolated-browser-profiles', 'edge');

        assert.strictEqual(
            browserCommandLineUsesProfile('msedge --no-first-run https://example.test', profileDir, 'linux'),
            false
        );
    });

    test('matches Windows profile paths with backslash equals syntax', () => {
        const profileDir = path.win32.join('C:\\', 'Users', 'me', 'AppData', 'Local', 'webcode', 'edge');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge.exe --user-data-dir=${profileDir}`, profileDir, 'win32'),
            true
        );
    });

    test('keeps escaped quotes inside quoted user data dirs', () => {
        const profileDir = path.win32.join('C:\\', 'Users', 'me', 'webcode', 'edge "quoted"');
        const escapedProfileDir = profileDir.replace(/"/g, '\\"');

        assert.strictEqual(
            browserCommandLineUsesProfile(`msedge.exe --user-data-dir="${escapedProfileDir}"`, profileDir, 'win32'),
            true
        );
    });

    test('preserves POSIX argv values containing spaces', () => {
        const profileDir = '/Users/me/Library/Application Support/webcode/edge';

        assert.strictEqual(
            browserArgumentsUseProfile(
                ['/Applications/Microsoft Edge', `--user-data-dir=${profileDir}`, '--no-first-run'],
                profileDir,
                'darwin'
            ),
            true
        );
    });

    test('recognizes an encoded profile marker in flattened macOS ps output', () => {
        const profileDir = '/Users/me/Library/Application Support/webcode/edge';
        const marker = getBrowserProfileMarkerArgument(profileDir, 'darwin');
        const commandLine = [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            `--user-data-dir=${profileDir}`,
            marker,
            '--no-first-run'
        ].join(' ');

        assert.strictEqual(marker.includes(' '), false);
        assert.strictEqual(commandLineHasExactArgument(commandLine, marker), true);
        assert.strictEqual(browserCommandLineUsesProfile(commandLine, profileDir, 'darwin'), true);
        assert.strictEqual(commandLineHasExactArgument(commandLine, `${marker}0`), false);
    });

    test('matches a legacy unquoted macOS profile path flattened by ps', () => {
        const profileDir = '/Users/me/Library/Application Support/webcode/edge';
        const commandLine = [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            `--user-data-dir=${profileDir}`,
            '--load-extension=/Users/me/Library/Application Support/webcode/browser-extensions/bridge'
        ].join(' ');

        assert.strictEqual(browserCommandLineUsesProfile(commandLine, profileDir, 'darwin'), true);
    });

    test('creates one stable marker for every process loading the shared bridge', () => {
        const extensionPath = '/Users/me/Library/Application Support/webcode/browser-extensions/bridge';

        assert.strictEqual(
            getBrowserBridgeMarkerArgument(extensionPath, 'darwin'),
            getBrowserBridgeMarkerArgument(`${extensionPath}/`, 'darwin')
        );
        assert.strictEqual(getBrowserBridgeMarkerArgument(extensionPath, 'darwin').includes(' '), false);
    });

    test('recognizes every supported Windows Chromium executable', () => {
        assert.strictEqual(getBrowserFamilyForExecutableName('chrome.exe', 'win32'), 'chrome');
        assert.strictEqual(getBrowserFamilyForExecutableName('chrome-for-testing.exe', 'win32'), 'chrome');
        assert.strictEqual(getBrowserFamilyForExecutableName('chromium.exe', 'win32'), 'chrome');
        assert.strictEqual(getBrowserFamilyForExecutableName('msedge.exe', 'win32'), 'edge');
    });
});
