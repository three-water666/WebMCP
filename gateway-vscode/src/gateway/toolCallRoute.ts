import type express from 'express';
import type { Response } from 'express';
import { type ToolExecutionPayload } from '@webcode/shared';

import {
    formatToolArgumentValidationError,
    validateToolArguments
} from '../schemaValidation';
import type {
    LocalTool,
    ToolDefinition,
    ToolExecutionContext
} from '../tools';
import { getErrorMessage } from './errorUtils';
import { resolveLocalPathArguments } from './pathArguments';
import type { GatewayErrorLogger, GatewayLogger, RemoteToolRoute } from './types';
import type { GatewayRuntimeTraceSink } from './runtimeTrace';

type ToolCallHandlerOptions = {
    createToolExecutionContext: () => ToolExecutionContext;
    error: GatewayErrorLogger;
    getToolDefinition: (name: string) => ToolDefinition | null;
    getWorkspaceRoot: () => string | null;
    localTools: Map<string, LocalTool>;
    log: GatewayLogger;
    trace?: GatewayRuntimeTraceSink;
    toolRouter: Map<string, RemoteToolRoute>;
};

type ParsedToolCallRequest = {
    args: Record<string, unknown>;
    name: string;
    requestId?: string;
};

const TRACE_EVIDENCE_ARGUMENTS = new Set(['path', 'customerId']);

export function createToolCallHandler(options: ToolCallHandlerOptions): express.RequestHandler {
    return async (req, res) => {
        const toolStart = Date.now();
        const parsed = parseToolCallRequest(req.body, res, options);

        if (!parsed) {
            return;
        }

        options.trace?.({
            event: 'tool_call_received',
            requestId: parsed.requestId,
            toolName: parsed.name,
            status: 'started'
        });

        const localTool = options.localTools.get(parsed.name);
        if (localTool) {
            return executeLocalTool(localTool, parsed, toolStart, res, options);
        }

        const route = options.toolRouter.get(parsed.name);
        if (!route) {
            return sendToolError(
                res,
                404,
                `Tool '${parsed.name}' not found. Third-party MCP tools must be called as 'server:tool'.`
            );
        }

        try {
            resolveLocalPathArguments(route, parsed.args, options.getWorkspaceRoot());
        } catch (error: unknown) {
            const errorText = getErrorMessage(error);
            options.log(`   ⛔ Rejected unsafe local path arguments for ${parsed.name}: ${errorText}`);
            return sendToolError(res, 400, errorText);
        }

        return executeRemoteTool(route, parsed, toolStart, res, options);
    };
}

function parseToolCallRequest(
    body: unknown,
    res: Response,
    options: ToolCallHandlerOptions
): ParsedToolCallRequest | null {
    const payload = body as Partial<ToolExecutionPayload> | null;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendToolError(res, 400, 'Invalid tool call request: request body must be a JSON object.');
        return null;
    }

    if (typeof payload.name !== 'string' || payload.name.trim() === '') {
        sendToolError(res, 400, 'Invalid tool call request: "name" must be a non-empty string.');
        return null;
    }

    const name = payload.name;
    const rawArgs = payload.arguments ?? {};
    const toolDefinition = options.getToolDefinition(name);

    if (!toolDefinition) {
        sendToolError(res, 404, `Tool '${name}' not found.`);
        return null;
    }

    const argumentErrors = validateToolArguments(rawArgs, toolDefinition.inputSchema);
    if (argumentErrors.length > 0) {
        const errorText = formatToolArgumentValidationError(name, toolDefinition.inputSchema, argumentErrors);
        options.log(`   ⛔ Rejected invalid arguments for ${name}: ${argumentErrors.join(' ')}`);
        sendToolError(res, 400, errorText);
        return null;
    }

    const requestId = typeof payload.request_id === 'string' && payload.request_id.trim()
        ? payload.request_id.trim()
        : undefined;
    return { args: rawArgs, name, requestId };
}

async function executeLocalTool(
    localTool: LocalTool,
    request: ParsedToolCallRequest,
    toolStart: number,
    res: Response,
    options: ToolCallHandlerOptions
) {
    try {
        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 80);
        options.log(`   🚀 Executing local tool: ${request.name} ${argsPreview}`);
        options.trace?.({
            event: 'tool_call_started',
            requestId: request.requestId,
            toolName: request.name,
            status: 'started',
            details: createTraceArgumentDetails(request.args)
        });
        const result = await localTool.execute(request.args, options.createToolExecutionContext());
        const toolDuration = Date.now() - toolStart;
        options.log(`   ✅ Finished local tool: ${request.name} (${toolDuration}ms)`);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.requestId,
            toolName: request.name,
            status: 'success',
            durationMs: toolDuration
        });
        return res.json(result);
    } catch (error: unknown) {
        options.error(`Local tool execution failed: ${request.name}`, error);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.requestId,
            toolName: request.name,
            status: 'error',
            durationMs: Date.now() - toolStart,
            details: { error: getErrorMessage(error) }
        });
        return sendToolError(res, 500, `Error: ${getErrorMessage(error)}`);
    }
}

async function executeRemoteTool(
    route: RemoteToolRoute,
    request: ParsedToolCallRequest,
    toolStart: number,
    res: Response,
    options: ToolCallHandlerOptions
) {
    try {
        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 50) + '...';
        options.log(`   🚀 Executing MCP tool: ${request.name} ${argsPreview}`);
        options.trace?.({
            event: 'tool_call_started',
            requestId: request.requestId,
            toolName: request.name,
            status: 'started',
            details: createTraceArgumentDetails(request.args)
        });
        const result = await route.client.callTool({ name: route.toolName, arguments: request.args ?? {} });
        const toolDuration = Date.now() - toolStart;
        options.log(`   ✅ Finished: ${request.name} (${toolDuration}ms)`);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.requestId,
            toolName: request.name,
            status: 'success',
            durationMs: toolDuration
        });
        return res.json(result);
    } catch (error: unknown) {
        options.error(`Tool execution failed: ${request.name}`, error);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.requestId,
            toolName: request.name,
            status: 'error',
            durationMs: Date.now() - toolStart,
            details: { error: getErrorMessage(error) }
        });
        return sendToolError(res, 500, `Error: ${getErrorMessage(error)}`);
    }
}

function sendToolError(res: Response, status: number, text: string) {
    return res.status(status).json({
        isError: true,
        content: [{ type: 'text', text }]
    });
}

function createTraceArgumentDetails(args: Record<string, unknown>): Record<string, unknown> {
    const evidenceArguments = Object.fromEntries(
        Object.entries(args).filter(([key, value]) => (
            TRACE_EVIDENCE_ARGUMENTS.has(key)
            && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        ))
    );
    return {
        argumentKeys: Object.keys(args).sort(),
        arguments: evidenceArguments
    };
}
