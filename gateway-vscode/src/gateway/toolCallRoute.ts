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
import type { SessionMetricsCollector } from '../session/sessionMetricsCollector';
import type { SessionRuntime } from '../session/sessionRuntime';

type ToolCallHandlerOptions = {
    createToolExecutionContext: () => ToolExecutionContext;
    error: GatewayErrorLogger;
    getToolDefinition: (name: string) => ToolDefinition | null;
    getWorkspaceRoot: () => string | null;
    localTools: Map<string, LocalTool>;
    log: GatewayLogger;
    toolRouter: Map<string, RemoteToolRoute>;
    metricsCollector: SessionMetricsCollector;
    sessionRuntime: SessionRuntime;
};

type ParsedToolCallRequest = {
    args: Record<string, unknown>;
    name: string;
};

export function createToolCallHandler(options: ToolCallHandlerOptions): express.RequestHandler {
    return async (req, res) => {
        const toolStart = Date.now();
        const parsed = parseToolCallRequest(req.body, res, options);

        if (!parsed) {
            return;
        }

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

    return { args: rawArgs, name };
}

async function executeLocalTool(
    localTool: LocalTool,
    request: ParsedToolCallRequest,
    toolStart: number,
    res: Response,
    options: ToolCallHandlerOptions
) {
    try {
        options.metricsCollector.recordToolCall(request.name);
        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 80);
        options.log(`   🚀 Executing local tool: ${request.name} ${argsPreview}`);
        const result = await localTool.execute(request.args, options.createToolExecutionContext());

        const checkpointState = options.sessionRuntime.checkpointState;
        checkpointState?.recordCompletedWork(request.name);
        checkpointState?.setVerification(`verified: ${request.name} completed successfully`);
        checkpointState?.setNextStep('continue with next planned task');

        const health = options.sessionRuntime.getHealth();

        if (health.shouldCheckpoint) {
            options.log(`   📌 Checkpoint recommended: ${health.risks.join(', ')}`);
        }

        const toolDuration = Date.now() - toolStart;
        options.log(`   ✅ Finished local tool: ${request.name} (${toolDuration}ms)`);
        return res.json(result);
    } catch (error: unknown) {
        options.error(`Local tool execution failed: ${request.name}`, error);
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
        options.metricsCollector.recordToolCall(request.name);
        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 50) + '...';
        options.log(`   🚀 Executing MCP tool: ${request.name} ${argsPreview}`);
        const result = await route.client.callTool({ name: route.toolName, arguments: request.args ?? {} });
        const toolDuration = Date.now() - toolStart;
        options.log(`   ✅ Finished: ${request.name} (${toolDuration}ms)`);
        return res.json(result);
    } catch (error: unknown) {
        options.error(`Tool execution failed: ${request.name}`, error);
        return sendToolError(res, 500, `Error: ${getErrorMessage(error)}`);
    }
}

function sendToolError(res: Response, status: number, text: string) {
    return res.status(status).json({
        isError: true,
        content: [{ type: 'text', text }]
    });
}
