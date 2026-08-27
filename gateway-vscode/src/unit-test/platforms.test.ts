import * as assert from 'assert';

import {
    findAiSiteById,
    getConfiguredAiSites,
    isTargetAllowedForSite,
    type SiteSelectors
} from '../platforms';

suite('platform registry', () => {
    test('returns built-in sites with stable ids and complete selectors', () => {
        const sites = getConfiguredAiSites(undefined);
        const chatgpt = findAiSiteById(sites, 'chatgpt');

        assert.ok(chatgpt);
        assert.strictEqual(chatgpt.name, 'ChatGPT');
        assert.strictEqual(chatgpt.address, 'https://chatgpt.com');
        assert.strictEqual(chatgpt.capture?.adapter, 'chatgpt-delta-v1');
        assert.strictEqual(chatgpt.capture?.url, 'https://chatgpt.com/backend-api/f/conversation');
        assert.strictEqual(typeof chatgpt.selectors.inputArea, 'string');
    });

    test('uses Qwen selectors that prefer the first comparison response', () => {
        const sites = getConfiguredAiSites(undefined);
        const qwen = findAiSiteById(sites, 'qwen');

        assert.ok(qwen);
        assert.strictEqual(
            qwen.selectors.messageBlocks,
            '.qwen-chat-message-dual-message .smulti-o-response-message-wrapper > .response-message-box:first-child .chat-response-message-right, .qwen-chat-message-assistant:not(.qwen-chat-message-dual-message) .chat-response-message-right'
        );
    });

    test('merges user overrides by id', () => {
        const sites = getConfiguredAiSites([
            {
                id: 'chatgpt',
                address: 'https://chatgpt.com/g/example',
                showQuickLaunch: false,
                selectors: {
                    inputArea: '#custom-input'
                }
            }
        ]);
        const chatgpt = findAiSiteById(sites, 'chatgpt');

        assert.ok(chatgpt);
        assert.strictEqual(chatgpt.address, 'https://chatgpt.com/g/example');
        assert.strictEqual(chatgpt.showQuickLaunch, false);
        assert.strictEqual(chatgpt.selectors.inputArea, '#custom-input');
        assert.strictEqual(chatgpt.selectors.codeBlocks, 'pre code');
    });

    test('keeps name fallback for old built-in overrides without id', () => {
        const sites = getConfiguredAiSites([
            {
                name: 'ChatGPT',
                selectors: {
                    sendButton: 'button[data-test="send"]'
                }
            }
        ]);
        const chatgpt = findAiSiteById(sites, 'chatgpt');

        assert.ok(chatgpt);
        assert.strictEqual(chatgpt.selectors.sendButton, 'button[data-test="send"]');
    });

    test('merges network capture overrides by id', () => {
        const sites = getConfiguredAiSites([{
            id: 'chatgpt',
            capture: {
                enabled: false
            }
        }]);
        const chatgpt = findAiSiteById(sites, 'chatgpt');

        assert.ok(chatgpt?.capture);
        assert.strictEqual(chatgpt.capture.enabled, false);
        assert.strictEqual(chatgpt.capture.adapter, 'chatgpt-delta-v1');
        assert.deepStrictEqual(chatgpt.capture.channels, ['commentary']);
    });

    test('adds custom sites with a new id and complete selectors', () => {
        const sites = getConfiguredAiSites([
            {
                id: 'custom-ai',
                name: 'Custom AI',
                address: 'https://ai.example.test/chat',
                selectors: createSelectors()
            }
        ]);
        const custom = findAiSiteById(sites, 'custom-ai');

        assert.ok(custom);
        assert.strictEqual(custom.name, 'Custom AI');
        assert.strictEqual(custom.address, 'https://ai.example.test/chat');
        assert.strictEqual(custom.selectors.inputArea, 'textarea');
    });

    test('does not add custom sites without complete selectors', () => {
        const sites = getConfiguredAiSites([
            {
                id: 'broken-ai',
                name: 'Broken AI',
                address: 'https://broken.example.test',
                selectors: {
                    inputArea: 'textarea'
                }
            }
        ]);

        assert.strictEqual(findAiSiteById(sites, 'broken-ai'), null);
    });

    test('checks whether a target belongs to a site address', () => {
        assert.strictEqual(
            isTargetAllowedForSite('https://chatgpt.com/g/example', { address: 'https://chatgpt.com' }),
            true
        );
        assert.strictEqual(
            isTargetAllowedForSite('https://ai.example.test/chat/new', { address: 'https://ai.example.test/chat' }),
            true
        );
        assert.strictEqual(
            isTargetAllowedForSite('https://ai.example.test/other', { address: 'https://ai.example.test/chat' }),
            false
        );
    });
});

function createSelectors(): SiteSelectors {
    return {
        messageBlocks: '.message',
        codeBlocks: 'pre code',
        inputArea: 'textarea',
        sendButton: 'button.send',
        stopButton: 'button.stop',
    };
}
