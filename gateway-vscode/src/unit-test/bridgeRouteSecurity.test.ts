import * as assert from 'assert';
import express from 'express';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { registerBridgeRoute } from '../gateway/bridgeRoute';
import { BridgeSessionManager } from '../gateway/bridgeSession';
import type { ResolvedAiSiteConfig } from '../platforms';

const TEST_SITE: ResolvedAiSiteConfig = {
    id: 'chatgpt',
    name: 'ChatGPT',
    address: 'https://chatgpt.com/',
    showQuickLaunch: true,
    browser: 'isolated-edge',
    selectors: {
        messageBlocks: '.message',
        codeBlocks: 'pre code',
        inputArea: 'textarea',
        sendButton: 'button.send',
        stopButton: 'button.stop'
    }
};

suite('Bridge route security', () => {
    test('redeems a launch code once without placing the API token in the page', async () => {
        const sessions = new BridgeSessionManager();
        let activityCount = 0;
        const server = await startBridgeServer(sessions, () => {
            activityCount += 1;
        });

        try {
            const bridgeCode = sessions.issueBridgeCode({
                siteId: TEST_SITE.id,
                targetUrl: TEST_SITE.address
            });
            const bridgeResponse = await fetch(`${server.baseUrl}/bridge?bridgeCode=${bridgeCode}`);
            const bridgeHtml = await bridgeResponse.text();

            assert.strictEqual(bridgeResponse.status, 200);
            assert.strictEqual(bridgeResponse.headers.get('referrer-policy'), 'no-referrer');
            assert.match(bridgeResponse.headers.get('cache-control') ?? '', /no-store/);
            assert.doesNotMatch(bridgeHtml, new RegExp(bridgeCode));
            assert.match(bridgeHtml, /bridge-upgrade-required/);
            assert.match(bridgeHtml, new RegExp(`"bridgeProtocolVersion":${BRIDGE_PROTOCOL_VERSION}`));
            assert.strictEqual(activityCount, 0);

            const protocolMismatchResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION - 1
            );
            assert.strictEqual(protocolMismatchResponse.status, 409);
            assert.ok(sessions.getBridgeLaunch(bridgeCode));

            const mismatchResponse = await redeemBridgeCode(server.baseUrl, bridgeCode, '0.0.0');
            assert.strictEqual(mismatchResponse.status, 409);
            assert.ok(sessions.getBridgeLaunch(bridgeCode));

            const redeemResponse = await redeemBridgeCode(server.baseUrl, bridgeCode, '1.0.1');
            const redemption = await redeemResponse.json() as Record<string, unknown>;
            const sessionToken = redemption.token;

            assert.strictEqual(redeemResponse.status, 200);
            assert.strictEqual(redemption.success, true);
            assert.strictEqual(redemption.siteId, TEST_SITE.id);
            assert.strictEqual(redemption.targetUrl, TEST_SITE.address);
            assert.strictEqual(redemption.idleTimeoutMs, 30 * 60 * 1000);
            assert.strictEqual(redemption.bridgeProtocolVersion, BRIDGE_PROTOCOL_VERSION);
            assert.strictEqual(typeof sessionToken, 'string');
            assert.notStrictEqual(sessionToken, bridgeCode);
            assert.strictEqual(sessions.isSessionTokenValid(sessionToken as string), true);
            assert.strictEqual(activityCount, 1);

            const reusedResponse = await redeemBridgeCode(server.baseUrl, bridgeCode, '1.0.1');
            assert.strictEqual(reusedResponse.status, 410);
            assert.strictEqual(activityCount, 1);
        } finally {
            await closeServer(server.httpServer);
        }
    });
});

async function startBridgeServer(
    sessions: BridgeSessionManager,
    recordActivity: () => void
): Promise<{ baseUrl: string; httpServer: HttpServer }> {
    const app = express();
    app.use(express.json());
    registerBridgeRoute(app, {
        activateSession: () => sessions.activateSession(),
        consumeBridgeCode: code => sessions.consumeBridgeCode(code),
        getBridgeLaunch: code => sessions.getBridgeLaunch(code),
        getAiSites: () => [TEST_SITE],
        getExtensionVersion: () => '1.0.1',
        getIdleTimeoutMs: () => 30 * 60 * 1000,
        getWorkspaceRoot: () => null,
        log: () => undefined,
        recordActivity
    });

    const httpServer = await new Promise<HttpServer>((resolve) => {
        const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = httpServer.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        httpServer
    };
}

function redeemBridgeCode(
    baseUrl: string,
    bridgeCode: string,
    browserExtensionVersion: string,
    bridgeProtocolVersion = BRIDGE_PROTOCOL_VERSION
): Promise<Response> {
    return fetch(`${baseUrl}/v1/bridge/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeCode, browserExtensionVersion, bridgeProtocolVersion })
    });
}

function closeServer(server: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
