import * as assert from 'assert';

import { BridgeSessionManager } from '../gateway/bridgeSession';

suite('Bridge session security', () => {
    test('issues short-lived bridge codes that can be consumed only once', () => {
        let now = 1000;
        const secrets = ['bridge-code'];
        const manager = new BridgeSessionManager(100, () => now, () => secrets.shift() ?? 'fallback');
        const launch = { siteId: 'chatgpt', targetUrl: 'https://chatgpt.com/' };

        const code = manager.issueBridgeCode(launch);
        assert.strictEqual(code, 'bridge-code');
        assert.deepStrictEqual(manager.getBridgeLaunch(code), launch);
        assert.deepStrictEqual(manager.consumeBridgeCode(code), launch);
        assert.strictEqual(manager.consumeBridgeCode(code), null);

        const expiringCode = manager.issueBridgeCode(launch);
        now += 101;
        assert.strictEqual(manager.getBridgeLaunch(expiringCode), null);
        assert.strictEqual(manager.consumeBridgeCode(expiringCode), null);
    });

    test('shares one API session token for the gateway lifecycle', () => {
        const secrets = ['session-one', 'session-two'];
        const manager = new BridgeSessionManager(100, Date.now, () => secrets.shift() ?? 'fallback');

        const firstToken = manager.activateSession();
        const secondToken = manager.activateSession();

        assert.strictEqual(firstToken, 'session-one');
        assert.strictEqual(secondToken, firstToken);
        assert.strictEqual(manager.isSessionTokenValid(firstToken), true);
        assert.strictEqual(manager.isSessionTokenValid('session-two'), false);

        manager.clear();
        assert.strictEqual(manager.isSessionTokenValid(firstToken), false);
    });
});
