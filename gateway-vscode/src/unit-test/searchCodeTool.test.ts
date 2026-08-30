import * as assert from 'assert';
import * as path from 'path';
import { matchesPattern } from '../tools/filesystemUtils';
import { createSearchCodeFallbackNotice } from '../tools/searchCodeFallback';
import { formatSearchCodeOutput } from '../tools/searchCodeOutput';
import { createSearchCodeRipgrepArgs } from '../tools/searchCodeRipgrepArgs';
import {
    getVSCodeAppRootCandidatesFromPath,
    getVSCodeRipgrepCandidates
} from '../tools/searchCodeRipgrepPaths';
import { createSearchCandidate, sortSearchCandidatesByRelativePath } from '../tools/searchCodeGitFiles';
import { appendRipgrepMatch } from '../tools/searchCodeRipgrepOutput';
import type { SearchCodeOptions } from '../tools/searchCodeTypes';
import {
    createRipgrepGitMetadataExcludeGlobs,
    getSearchCodeMatchMode,
    isGitMetadataPath,
    looksLikeRegexQuery,
    normalizeIncludeGlob,
    truncateSearchMatchLine
} from '../tools/searchCodeUtils';

suite('Search Code Tool', () => {
    test('treats bare include names as recursive globs', () => {
        assert.strictEqual(normalizeIncludeGlob('package.json'), '**/package.json');
        assert.strictEqual(normalizeIncludeGlob('gateway-vscode/package.json'), 'gateway-vscode/package.json');
    });

    test('matches fallback include globs with brace alternation', () => {
        const includePattern = '**/*.{js,ts,jsx,tsx}';

        assert.ok(matchesPattern('src/modules/logger.ts', includePattern));
        assert.ok(matchesPattern('logger.ts', includePattern));
        assert.ok(matchesPattern('src/App.jsx', includePattern));
        assert.ok(!matchesPattern('src/styles/logger.css', includePattern));
    });

    test('sorts ripgrep search_code results by path', () => {
        const args = createSearchCodeRipgrepArgs(createOptions());
        const sortIndex = args.indexOf('--sort');

        assert.ok(sortIndex >= 0);
        assert.strictEqual(args[sortIndex + 1], 'path');
    });

    test('sorts fallback search candidates by relative path', () => {
        const root = path.resolve('workspace-root');
        const sorted = sortSearchCandidatesByRelativePath([
            { filePath: path.join(root, 'src/b.ts'), relativeToSearchRoot: 'src/b.ts' },
            { filePath: path.join(root, 'README.md'), relativeToSearchRoot: 'README.md' },
            { filePath: path.join(root, 'src/a.ts'), relativeToSearchRoot: 'src/a.ts' }
        ]);

        assert.deepStrictEqual(sorted.map(candidate => candidate.relativeToSearchRoot), [
            'README.md',
            'src/a.ts',
            'src/b.ts'
        ]);
    });

    test('describes fallback search capabilities when ripgrep is unavailable', () => {
        const notice = createSearchCodeFallbackNotice();

        assert.ok(notice.includes('ripgrep is unavailable'));
        assert.ok(notice.includes('in-process fallback'));
        assert.ok(notice.includes('simple comma brace alternation'));
        assert.ok(notice.includes('JavaScript RegExp'));
    });

    test('keeps fallback notices before no-match regex hints', () => {
        const output = formatSearchCodeOutput({
            matches: [],
            limited: false,
            notices: ['Notice: fallback active.']
        }, createOptions({
            query: 'preventDefault|stopPropagation',
            useRegex: false
        }));

        assert.deepStrictEqual(output.split('\n'), [
            'Notice: fallback active.',
            'No matches found.',
            'Hint: query looks like a regular expression. Did you mean to set match: "regex"?'
        ]);
    });

    test('infers VS Code app roots from Windows PATH bin directories', () => {
        const candidates = getVSCodeAppRootCandidatesFromPath(
            path.win32.join('D:\\', 'Microsoft VS Code', 'bin'),
            'win32'
        );

        assert.ok(candidates.includes(path.win32.join('D:\\', 'Microsoft VS Code', 'resources', 'app')));
    });

    test('infers VS Code app roots from MSYS-style Windows PATH entries', () => {
        const candidates = getVSCodeAppRootCandidatesFromPath(
            '/d/Microsoft VS Code/bin:/c/Users/example/bin',
            'win32'
        );

        assert.ok(candidates.includes(path.win32.join('D:\\', 'Microsoft VS Code', 'resources', 'app')));
    });

    test('includes VS Code ripgrep-universal platform arch candidates', () => {
        const appRoot = path.win32.join('D:\\', 'Microsoft VS Code', 'resources', 'app');
        const candidates = getVSCodeRipgrepCandidates(appRoot, '', 'win32', 'x64');

        assert.ok(candidates.includes(path.win32.join(
            appRoot,
            'node_modules',
            '@vscode',
            'ripgrep-universal',
            'bin',
            'win32-x64',
            'rg.exe'
        )));
    });

    test('keeps only git metadata as an internal ripgrep exclusion', () => {
        const globs = createRipgrepGitMetadataExcludeGlobs();

        assert.deepStrictEqual(globs, ['.git', '**/.git', '.git/**', '**/.git/**']);
        assert.ok(isGitMetadataPath('.git/config'));
        assert.ok(isGitMetadataPath('nested/.git/config'));
        assert.ok(!isGitMetadataPath('node_modules/package/index.js'));
        assert.ok(!globs.includes('target/**'));
    });

    test('crops long matching lines around the match', () => {
        const prefix = 'a'.repeat(120);
        const suffix = 'b'.repeat(120);
        const query = '"version"';
        const line = `${prefix}${query}${suffix}`;
        const result = truncateSearchMatchLine(line, 80, {
            start: prefix.length,
            end: prefix.length + query.length
        });

        assert.ok(result.includes(query));
        assert.ok(result.startsWith('[...'));
        assert.ok(result.endsWith('chars omitted...]'));
        assert.ok(result.length < line.length);
    });

    test('uses ripgrep submatch offsets when cropping regex matches', () => {
        const prefix = '你'.repeat(100);
        const needle = 'needle';
        const line = `${prefix}${needle}${'b'.repeat(100)}`;
        const start = Buffer.byteLength(prefix, 'utf8');
        const message = {
            type: 'match',
            data: {
                path: { text: 'src/sample.txt' },
                lines: { text: `${line}\n` },
                line_number: 7,
                submatches: [{
                    match: { text: needle },
                    start,
                    end: start + Buffer.byteLength(needle, 'utf8')
                }]
            }
        };
        const matches: string[] = [];

        appendRipgrepMatch(JSON.stringify(message), createOptions({
            query: '(?P<word>needle)',
            useRegex: true,
            matchLineMaxChars: 80
        }), matches);

        assert.strictEqual(matches.length, 1);
        assert.ok(matches[0].includes(needle));
        assert.ok(matches[0].includes('chars omitted'));
    });

    test('preserves git ls-files paths with leading or trailing spaces', () => {
        const root = path.resolve('workspace-root');

        assert.strictEqual(
            createSearchCandidate(root, './ leading-space.ts')?.relativeToSearchRoot,
            ' leading-space.ts'
        );
        assert.strictEqual(
            createSearchCandidate(root, 'trailing-space.ts ')?.relativeToSearchRoot,
            'trailing-space.ts '
        );
        assert.strictEqual(createSearchCandidate(root, ''), null);
    });

    test('uses substring search by default', () => {
        assert.strictEqual(getSearchCodeMatchMode(undefined), 'substring');
        assert.strictEqual(getSearchCodeMatchMode('substring'), 'substring');
    });

    test('uses regex search when match is regex', () => {
        assert.strictEqual(getSearchCodeMatchMode('regex'), 'regex');
    });

    test('rejects invalid search code match modes', () => {
        assert.throws(() => getSearchCodeMatchMode('glob'), /match must be "substring" or "regex"/);
    });

    test('detects obvious regex intent in substring queries', () => {
        assert.ok(looksLikeRegexQuery('preventDefault|stopPropagation'));
        assert.ok(looksLikeRegexQuery('addEventListener.*(touch|mouse|pointer|drag)'));
        assert.ok(looksLikeRegexQuery('\\brequest_key\\b'));
        assert.ok(looksLikeRegexQuery('[A-Z]+'));
        assert.ok(looksLikeRegexQuery('[a-z]'));
        assert.ok(!looksLikeRegexQuery('foo.ts'));
        assert.ok(!looksLikeRegexQuery('preventDefault'));
        assert.ok(!looksLikeRegexQuery('[TODO]'));
        assert.ok(!looksLikeRegexQuery('[abc]'));
        assert.ok(!looksLikeRegexQuery('literal\\|pipe'));
    });
});

function createOptions(overrides: Partial<SearchCodeOptions> = {}): SearchCodeOptions {
    const root = path.resolve('workspace-root');
    return {
        searchRoot: root,
        workspaceRoot: root,
        query: 'needle',
        maxResults: 100,
        caseSensitive: true,
        useRegex: false,
        matchLineMaxChars: 500,
        ...overrides
    };
}
