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
import type { CommandApprovalManager } from './commandApproval';

type ToolCallHandlerOptions = {
    commandApprovalManager: CommandApprovalManager;
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
    approvalToken?: string;
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

export function createToolPreflightHandler(options: ToolCallHandlerOptions): express.RequestHandler {
    return async (req, res) => {
        const parsed = parseToolCallRequest(req.body, res, options);
        if (!parsed) {
            return;
        }

        const localTool = options.localTools.get(parsed.name);
        if (!localTool?.assessRisk) {
            return res.json({ risk: { level: 'allowed', reasons: [] } });
        }

        try {
            const context = options.createToolExecutionContext();
            const preflight = await localTool.assessRisk(parsed.args, context);
            if (preflight.assessment.level !== 'requires_confirmation') {
                return res.json({ risk: preflight.assessment });
            }

            const challenge = options.commandApprovalManager.issueChallenge(preflight.fingerprint);
            return res.json({
                risk: preflight.assessment,
                challenge: {
                    id: challenge.challengeId,
                    expires_at: challenge.expiresAt
                }
            });
        } catch (error: unknown) {
            return sendToolError(res, 400, getErrorMessage(error));
        }
    };
}

export function createToolApprovalHandler(
    commandApprovalManager: CommandApprovalManager
): express.RequestHandler {
    return (req, res) => {
        const challengeId = isRecord(req.body) && typeof req.body.challenge_id === 'string'
            ? req.body.challenge_id.trim()
            : '';
        if (!challengeId) {
            return sendToolError(res, 400, 'Invalid command approval request: challenge_id is required.');
        }

        const grant = commandApprovalManager.approveChallenge(challengeId);
        if (!grant) {
            return sendToolError(res, 410, 'Command approval challenge is invalid or expired.');
        }

        return res.json({
            approval_token: grant.approvalToken,
            expires_at: grant.expiresAt
        });
    };
}

function parseToolCallRequest(
    body: unknown,
    res: Response,
    options: ToolCallHandlerOptions
): ParsedToolCallRequest | null {
    const payload = body as (Partial<ToolExecutionPayload> & { approval_token?: unknown }) | null;

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

    const requestId = readOptionalString(payload.request_id);
    const approvalToken = readOptionalString(payload.approval_token);
    return { approvalToken, args: rawArgs, name, requestId };
}

async function executeLocalTool(
    localTool: LocalTool,
    request: ParsedToolCallRequest,
    toolStart: number,
    res: Response,
    options: ToolCallHandlerOptions
) {
    try {
        const context = options.createToolExecutionContext();
        const authorized = await authorizeLocalTool(localTool, request, context, res, options);
        if (!authorized) {
            return;
        }

        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 80);
        options.log(`   🚀 Executing local tool: ${request.name} ${argsPreview}`);
        options.trace?.({
            event: 'tool_call_started',
            requestId: request.requestId,
            toolName: request.name,
            status: 'started',
            details: createTraceArgumentDetails(request.args)
        });
        const result = await localTool.execute(request.args, context);
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

async function authorizeLocalTool(
    localTool: LocalTool,
    request: ParsedToolCallRequest,
    context: ToolExecutionContext,
    res: Response,
    options: ToolCallHandlerOptions
): Promise<boolean> {
    if (!localTool.assessRisk) {
        return true;
    }

    const preflight = await localTool.assessRisk(request.args, context);
    if (preflight.assessment.level === 'blocked') {
        sendToolError(res, 400, `Security Error: ${preflight.assessment.reasons.join(' ')}`);
        return false;
    }
    if (preflight.assessment.level !== 'requires_confirmation') {
        return true;
    }

    const approved = options.commandApprovalManager.consumeGrant(
        request.approvalToken,
        preflight.fingerprint
    );
    if (!approved) {
        res.status(409).json({
            isError: true,
            commandRisk: preflight.assessment,
            content: [{
                type: 'text',
                text: `Approval Required: ${preflight.assessment.reasons.join(' ')}`
            }]
        });
        return false;
    }

    context.approvedCommandFingerprint = preflight.fingerprint;
    return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    return value.trim() || undefined;
}
