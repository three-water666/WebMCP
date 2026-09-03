import * as assert from 'assert';

import {
    DeepSeekEventStreamDecoder,
    extractToolCallTextCandidates,
} from '@webcode/shared';

suite('DeepSeek event stream capture', () => {
    test('captures only RESPONSE fragments and ignores a duplicate call in THINK', () => {
        const decoder = new DeepSeekEventStreamDecoder();
        const toolCall = createToolCall('response.txt');
        const stream = buildCompletedStream([
            createInitialResponse('expert', true, 'THINK', `Reasoning\n\n\`\`\`json\n${toolCall}\n\`\`\``),
            createFragmentAppend('RESPONSE', 'Visible response\n\n```json\n'),
            JSON.stringify({ p: 'response/fragments/-1/content', o: 'APPEND', v: toolCall.slice(0, 20) }),
            JSON.stringify({ v: `${toolCall.slice(20)}\n\`\`\`` }),
            createFinishedStatus(),
        ], 'expert');

        pushInSmallChunks(decoder, stream, 11);
        const result = decoder.finish();

        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.messages.length, 1);
        assert.deepStrictEqual(
            extractToolCallTextCandidates(result.messages[0].text),
            [toolCall]
        );
    });

    test('captures a non-thinking default response', () => {
        const decoder = new DeepSeekEventStreamDecoder();
        const toolCall = createToolCall('README.md');
        decoder.push(buildCompletedStream([
            createInitialResponse('default', false, 'RESPONSE', `\`\`\`json\n${toolCall}\n\`\`\``),
            createFinishedStatus(),
        ], 'default'));

        const result = decoder.finish();

        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.messages[0].id, '2');
        assert.deepStrictEqual(extractToolCallTextCandidates(result.messages[0].text), [toolCall]);
    });

    test('does not expose a completed-looking call from an incomplete stream', () => {
        const decoder = new DeepSeekEventStreamDecoder();
        decoder.push([
            'event: ready\n',
            'data: {"request_message_id":1,"response_message_id":2,"model_type":"default"}\n\n',
            `data: ${createInitialResponse('default', false, 'RESPONSE', createToolCall('README.md'))}\n\n`,
        ].join(''));

        const result = decoder.finish();

        assert.strictEqual(result.complete, false);
        assert.deepStrictEqual(result.messages, []);
    });
});

function buildCompletedStream(deltas: readonly string[], modelType: string): string {
    return [
        'event: ready\n',
        `data: {"request_message_id":1,"response_message_id":2,"model_type":"${modelType}"}\n\n`,
        ...deltas.map(delta => `data: ${delta}\n\n`),
        'event: close\n',
        'data: {"click_behavior":"none","auto_resume":false}\n\n',
    ].join('');
}

function createInitialResponse(
    modelType: string,
    thinkingEnabled: boolean,
    fragmentType: string,
    content: string
): string {
    return JSON.stringify({
        v: {
            response: {
                fragments: [{ content, id: 2, stage_id: 1, type: fragmentType }],
                message_id: 2,
                model: modelType,
                role: 'ASSISTANT',
                status: 'WIP',
                thinking_enabled: thinkingEnabled,
            },
        },
    });
}

function createFragmentAppend(type: string, content: string): string {
    return JSON.stringify({
        o: 'APPEND',
        p: 'response/fragments',
        v: [{ content, id: 3, stage_id: 1, type }],
    });
}

function createFinishedStatus(): string {
    return JSON.stringify({ o: 'SET', p: 'response/status', v: 'FINISHED' });
}

function createToolCall(path: string): string {
    return JSON.stringify({
        arguments: { path },
        mcp_action: 'call',
        name: 'read_file',
        purpose: 'Read a file',
    });
}

function pushInSmallChunks(decoder: DeepSeekEventStreamDecoder, stream: string, chunkSize: number): void {
    for (let index = 0; index < stream.length; index += chunkSize) {
        decoder.push(stream.slice(index, index + chunkSize));
    }
}
