import * as assert from 'assert';

import { buildBridgeUrl } from '../extension/bridgeUrl';
import {
    DEFAULT_IDLE_TIMEOUT_MINUTES,
    MAX_IDLE_TIMEOUT_MINUTES,
    MIN_IDLE_TIMEOUT_MINUTES,
    resolveIdleTimeoutMinutes
} from '../gateway/idleTimeout';
import { isAllowedCorsOrigin, isGatewayActivityRequest } from '../gateway/middleware';

suite('Gateway security helpers', () => {
    test('places only the one-time bridge code in launch URLs', () => {
        const url = new URL(buildBridgeUrl(34567, 'one-time-code'));

        assert.strictEqual(url.origin, 'http://127.0.0.1:34567');
        assert.strictEqual(url.pathname, '/bridge');
        assert.deepStrictEqual(Array.from(url.searchParams.keys()), ['bridgeCode']);
        assert.strictEqual(url.searchParams.get('bridgeCode'), 'one-time-code');
    });

    test('matches loopback CORS origins by parsed hostname instead of prefix', () => {
        const configuredOrigins = ['https://chatgpt.com'];

        assert.strictEqual(isAllowedCorsOrigin(undefined, configuredOrigins), true);
        assert.strictEqual(isAllowedCorsOrigin('https://chatgpt.com', configuredOrigins), true);
        assert.strictEqual(isAllowedCorsOrigin('http://127.0.0.1:34567', configuredOrigins), true);
        assert.strictEqual(isAllowedCorsOrigin('http://localhost:34567', configuredOrigins), true);
        assert.strictEqual(isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', configuredOrigins), true);
        assert.strictEqual(isAllowedCorsOrigin('http://localhost.attacker.example:34567', configuredOrigins), false);
        assert.strictEqual(isAllowedCorsOrigin('http://127.0.0.1.attacker.example:34567', configuredOrigins), false);
        assert.strictEqual(isAllowedCorsOrigin('https://localhost:34567', configuredOrigins), false);
    });

    test('counts only known authenticated API routes as gateway activity', () => {
        assert.strictEqual(isGatewayActivityRequest('POST', '/v1/tools/call'), true);
        assert.strictEqual(isGatewayActivityRequest('GET', '/v1/init'), true);
        assert.strictEqual(isGatewayActivityRequest('GET', '/v1/status'), false);
        assert.strictEqual(isGatewayActivityRequest('OPTIONS', '/v1/tools/call'), false);
        assert.strictEqual(isGatewayActivityRequest('GET', '/unknown'), false);
    });

    test('keeps the idle timeout default at 30 minutes and constrains overrides', () => {
        assert.strictEqual(resolveIdleTimeoutMinutes(undefined), DEFAULT_IDLE_TIMEOUT_MINUTES);
        assert.strictEqual(resolveIdleTimeoutMinutes(30), 30);
        assert.strictEqual(resolveIdleTimeoutMinutes(2), MIN_IDLE_TIMEOUT_MINUTES);
        assert.strictEqual(resolveIdleTimeoutMinutes(999), MAX_IDLE_TIMEOUT_MINUTES);
        assert.strictEqual(resolveIdleTimeoutMinutes(60.9), 60);
        assert.strictEqual(resolveIdleTimeoutMinutes(Number.NaN), DEFAULT_IDLE_TIMEOUT_MINUTES);
    });
});
