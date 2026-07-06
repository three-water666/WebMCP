import * as assert from 'assert';

import { escapeWindowsCmdArgument } from '../extension/windowsCmdArguments';

suite('Windows cmd arguments', () => {
    test('quotes command separators in bridge URLs', () => {
        assert.strictEqual(
            escapeWindowsCmdArgument('http://127.0.0.1:34567/bridge?bridgeToken=t&siteId=s&target=u'),
            '"http://127.0.0.1:34567/bridge?bridgeToken=t&siteId=s&target=u"'
        );
    });

    test('keeps cmd metacharacters literal in quoted path arguments', () => {
        assert.strictEqual(
            escapeWindowsCmdArgument('--user-data-dir=C:/Users/me/OneDrive - Org (Dev)'),
            '"--user-data-dir=C:/Users/me/OneDrive - Org (Dev)"'
        );
    });

    test('escapes percent signs outside quoted segments', () => {
        assert.strictEqual(
            escapeWindowsCmdArgument('--user-data-dir=C:/Users/me/Profile Root%PATH%'),
            '"--user-data-dir=C:/Users/me/Profile Root"^%"PATH"^%'
        );
    });

    test('quotes empty arguments', () => {
        assert.strictEqual(escapeWindowsCmdArgument(''), '""');
    });

    test('doubles trailing backslashes before closing quotes', () => {
        assert.strictEqual(
            escapeWindowsCmdArgument('--user-data-dir=C:\\Users\\me\\Profile\\'),
            '"--user-data-dir=C:\\Users\\me\\Profile\\\\"'
        );
    });
});
