import * as assert from 'assert';

import { escapeWindowsCmdArgument } from '../extension/windowsCmdArguments';

suite('Windows cmd arguments', () => {
    test('escapes command separators in bridge URLs', () => {
        assert.strictEqual(
            escapeWindowsCmdArgument('http://127.0.0.1:34567/bridge?bridgeToken=t&siteId=s&target=u'),
            'http://127.0.0.1:34567/bridge?bridgeToken=t^&siteId=s^&target=u'
        );
    });

    test('escapes percent-encoded URLs without changing spaces', () => {
        assert.strictEqual(
            escapeWindowsCmdArgument('--user-data-dir=C:/Users/me/Profile Root%PATH%'),
            '--user-data-dir=C:/Users/me/Profile Root^%PATH^%'
        );
    });
});
