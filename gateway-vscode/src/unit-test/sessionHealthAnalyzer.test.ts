import assert from 'assert';
import { SessionHealthAnalyzer } from '../session/sessionHealthAnalyzer';

suite('SessionHealthAnalyzer', () => {
    test('returns healthy for fresh session metrics', () => {
        const analyzer = new SessionHealthAnalyzer();

        const result = analyzer.analyze({
            toolCallCount: 0,
            fileReadCount: 0,
            repeatedFileReads: 0,
            searchCount: 0,
            repeatedSearches: 0,
            modifiedFileCount: 0
        });

        assert.strictEqual(result.level, 'healthy');
    });

    test('recommends compression when session grows', () => {
        const analyzer = new SessionHealthAnalyzer();

        const result = analyzer.analyze({
            toolCallCount: 100,
            fileReadCount: 100,
            repeatedFileReads: 10,
            searchCount: 0,
            repeatedSearches: 0,
            modifiedFileCount: 0
        });

        assert.strictEqual(result.level, 'compress_recommended');
    });

    test('recommends restart for severe context degradation', () => {
        const analyzer = new SessionHealthAnalyzer();

        const result = analyzer.analyze({
            toolCallCount: 100,
            fileReadCount: 100,
            repeatedFileReads: 20,
            searchCount: 20,
            repeatedSearches: 10,
            modifiedFileCount: 30
        });

        assert.strictEqual(result.level, 'restart_recommended');
    });
});
