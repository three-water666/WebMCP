import * as assert from 'assert';

import {
    ChatGptEventStreamDecoder,
    extractToolCallTextCandidates,
    ServerSentEventDecoder,
} from '@webcode/shared';

suite('ChatGPT event stream capture', () => {
    test('decodes SSE fields across arbitrary chunks', () => {
        const decoder = new ServerSentEventDecoder();
        const events = [
            ...decoder.push('event: delta\r\ndata: first'),
            ...decoder.push('\r\ndata: second\r\n\r\n: ping\r\n\r\n'),
            ...decoder.finish(),
        ];

        assert.deepStrictEqual(events, [{
            data: 'first\nsecond',
            event: 'delta',
            id: undefined,
            retry: undefined,
        }]);
    });

    test('reconstructs inherited ChatGPT v1 deltas before exposing commentary', () => {
        const decoder = new ChatGptEventStreamDecoder({ channels: ['commentary'] });
        const stream = buildCompletedStream([
            createMessageDelta('system-1', 'system', null, 'finished_successfully', 'mcp_action example'),
            createMessageDelta('assistant-1', 'assistant', 'commentary', 'in_progress', ''),
            createDelta('/message/content/parts/0', 'append', '```json\n{"mcp_act'),
            JSON.stringify({ v: 'ion":"call","name":"read_file","purpose":"Read a file","arguments":{}}\n```' }),
            createStatusPatch('finished_successfully'),
        ]);

        pushInSmallChunks(decoder, stream, 7);
        const result = decoder.finish();

        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.conversationId, 'conversation-1');
        assert.strictEqual(result.messages.length, 1);
        const candidates = extractToolCallTextCandidates(result.messages[0].text);
        assert.strictEqual(candidates.length, 1);
        const parsedCandidate: unknown = JSON.parse(candidates[0]);
        assert.ok(isRecord(parsedCandidate));
        assert.strictEqual(parsedCandidate.name, 'read_file');
    });

    test('drops a commentary message removed before stream completion', () => {
        const decoder = new ChatGptEventStreamDecoder({ channels: ['commentary'] });
        const stream = buildCompletedStream([
            createMessageDelta('assistant-1', 'assistant', 'commentary', 'in_progress', ''),
            createDelta('/message/content/parts/0', 'append', createToolCall()),
            createStatusPatch('finished_successfully'),
            createDelta('', 'remove', null),
        ]);

        decoder.push(stream);
        const result = decoder.finish();

        assert.strictEqual(result.complete, true);
        assert.deepStrictEqual(result.messages, []);
    });

    test('does not expose a completed-looking call from an incomplete stream', () => {
        const decoder = new ChatGptEventStreamDecoder({ channels: ['commentary'] });
        decoder.push([
            'event: delta_encoding\n',
            'data: "v1"\n\n',
            `data: ${createMessageDelta('assistant-1', 'assistant', 'commentary', 'in_progress', createToolCall())}\n\n`,
        ].join(''));

        const result = decoder.finish();

        assert.strictEqual(result.complete, false);
        assert.deepStrictEqual(result.messages, []);
    });

    test('extracts fenced and bare tool call objects without collapsing duplicates', () => {
        const call = createToolCall();
        assert.deepStrictEqual(extractToolCallTextCandidates(`${call}\n${call}`), [call, call]);
        assert.deepStrictEqual(extractToolCallTextCandidates(`before\n\`\`\`json\n${call}\n\`\`\``), [call]);
    });
});

function buildCompletedStream(deltas: readonly string[]): string {
    return [
        'event: delta_encoding\n',
        'data: "v1"\n\n',
        ...deltas.map(delta => `data: ${delta}\n\n`),
        'data: {"type":"message_stream_complete","conversation_id":"conversation-1"}\n\n',
        'data: [DONE]\n\n',
    ].join('');
}

function createMessageDelta(
    id: string,
    role: string,
    channel: string | null,
    status: string,
    text: string
): string {
    return JSON.stringify({
        c: 1,
        o: 'add',
        p: '',
        v: {
            conversation_id: 'conversation-1',
            message: {
                author: { role },
                channel,
                content: { content_type: 'text', parts: [text] },
                end_turn: false,
                id,
                recipient: 'all',
                status,
            },
        },
    });
}

function createDelta(path: string, operation: string, value: unknown): string {
    return JSON.stringify({ o: operation, p: path, v: value });
}

function createStatusPatch(status: string): string {
    return JSON.stringify({
        o: 'patch',
        p: '',
        v: [{ o: 'replace', p: '/message/status', v: status }],
    });
}

function createToolCall(): string {
    return JSON.stringify({
        arguments: {},
        mcp_action: 'call',
        name: 'read_file',
        purpose: 'Read a file',
    });
}

function pushInSmallChunks(decoder: ChatGptEventStreamDecoder, stream: string, chunkSize: number): void {
    for (let index = 0; index < stream.length; index += chunkSize) {
        decoder.push(stream.slice(index, index + chunkSize));
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
