import * as assert from 'assert';

import { buildSyncedAiSites } from '../gateway/syncedSites';
import type { ResolvedAiSiteConfig } from '../platforms';

suite('gateway init route helpers', () => {
    test('syncs only browser runtime site fields', () => {
        const syncedSites = buildSyncedAiSites([
            {
                id: 'chatgpt',
                name: 'ChatGPT',
                address: 'https://chatgpt.com',
                showQuickLaunch: true,
                browser: 'isolated-edge',
                selectors: {
                    messageBlocks: '.message',
                    codeBlocks: 'pre code',
                    inputArea: 'textarea',
                    sendButton: 'button.send',
                    stopButton: 'button.stop',
                }
            }
        ] satisfies ResolvedAiSiteConfig[]);

        assert.deepStrictEqual(Object.keys(syncedSites[0]).sort(), ['id', 'name', 'selectors']);
        assert.strictEqual(syncedSites[0].id, 'chatgpt');
        assert.strictEqual(syncedSites[0].name, 'ChatGPT');
    });

    test('syncs configured network response capture data', () => {
        const syncedSites = buildSyncedAiSites([{
            id: 'chatgpt',
            name: 'ChatGPT',
            address: 'https://chatgpt.com',
            capture: {
                adapter: 'chatgpt-delta-v1',
                channels: ['commentary'],
                enabled: true,
                method: 'POST',
                strategy: 'network-preferred',
                transport: 'fetch-sse',
                url: 'https://chatgpt.com/backend-api/f/conversation'
            },
            selectors: {
                messageBlocks: '.message',
                codeBlocks: 'pre code',
                inputArea: 'textarea',
                sendButton: 'button.send',
                stopButton: 'button.stop',
            }
        }] satisfies ResolvedAiSiteConfig[]);

        assert.strictEqual(syncedSites[0].capture?.adapter, 'chatgpt-delta-v1');
        assert.deepStrictEqual(syncedSites[0].capture?.channels, ['commentary']);
    });
});
