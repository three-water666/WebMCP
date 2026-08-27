import * as http from 'node:http';
import * as path from 'node:path';

import * as vscode from 'vscode';

interface QaExtensionApi {
    getGatewayState(): {
        currentPort: number | null;
        isStarting: boolean;
        isRunning: boolean;
    };
    evaluation: {
        getSiteConfiguration(siteId: string): {
            address: string;
            id: string;
            name: string;
        };
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

interface QaControlOptions {
    extensionApi: QaExtensionApi;
    runDirectory: string;
    token: string;
}

interface QaRequest {
    action?: string;
    [key: string]: unknown;
}

export interface InteractiveQaControl {
    close(): Promise<void>;
    port: number;
    stopped: Promise<void>;
}

const EXTENSION_ID = 'three-water666.gateway-vscode';

export async function startInteractiveQaControl(
    options: QaControlOptions
): Promise<InteractiveQaControl> {
    let stopResolve: (() => void) | undefined;
    const stopped = new Promise<void>(resolve => { stopResolve = resolve; });
    const server = http.createServer((request, response) => {
        void handleRequest(request, response, options, () => stopResolve?.());
    });
    const port = await listen(server);
    return {
        port,
        stopped,
        close: () => closeServer(server),
    };
}

async function handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    options: QaControlOptions,
    stop: () => void
): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/action') {
        sendJson(response, 404, { ok: false, error: 'Not found.' });
        return;
    }
    if (request.headers.authorization !== `Bearer ${options.token}`) {
        sendJson(response, 401, { ok: false, error: 'Unauthorized.' });
        return;
    }
    try {
        const payload = await readJsonBody(request);
        const result = await dispatchAction(payload, options, stop);
        sendJson(response, 200, { ok: true, result });
    } catch (error) {
        sendJson(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function dispatchAction(
    request: QaRequest,
    options: QaControlOptions,
    stop: () => void
): Promise<unknown> {
    switch (request.action) {
        case undefined:
            throw new Error('Missing QA control action.');
        case 'status':
            return buildStatus(options.extensionApi);
        case 'site.start':
            return startSite(options.extensionApi, requireString(request.siteId, 'siteId'));
        case 'gateway.stop':
            await options.extensionApi.evaluation.stop();
            return buildStatus(options.extensionApi);
        case 'vscode.command':
            return vscode.commands.executeCommand(
                requireString(request.command, 'command'),
                ...readArray(request.arguments)
            );
        case 'vscode.config.get':
            return getConfiguration(requireString(request.key, 'key'));
        case 'vscode.config.set':
            return updateConfiguration(request);
        case 'vscode.openFile':
            return openFile(request, options.runDirectory);
        case 'stop':
            stop();
            return { stopping: true };
        default:
            throw new Error(`Unknown QA control action: ${String(request.action)}`);
    }
}

async function startSite(extensionApi: QaExtensionApi, siteId: string): Promise<unknown> {
    const site = extensionApi.evaluation.getSiteConfiguration(siteId);
    const bridgeUrl = await extensionApi.evaluation.startAndCreateBridgeUrl(site.id, site.address);
    return {
        site,
        bridgeUrl,
        gateway: extensionApi.getGatewayState(),
    };
}

function buildStatus(extensionApi: QaExtensionApi): unknown {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const editor = vscode.window.activeTextEditor;
    return {
        gateway: extensionApi.getGatewayState(),
        extension: {
            id: EXTENSION_ID,
            active: extension?.isActive ?? false,
            version: readExtensionVersion(extension),
        },
        workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
        activeEditor: editor ? {
            path: editor.document.uri.fsPath,
            languageId: editor.document.languageId,
            line: editor.selection.active.line + 1,
            column: editor.selection.active.character + 1,
            dirty: editor.document.isDirty,
        } : null,
        visibleEditors: vscode.window.visibleTextEditors.map(item => item.document.uri.fsPath),
    };
}

function getConfiguration(fullKey: string): unknown {
    const { section, key } = splitConfigurationKey(fullKey);
    const configuration = vscode.workspace.getConfiguration(section);
    return {
        key: fullKey,
        value: configuration.get(key),
        inspect: configuration.inspect(key),
    };
}

async function updateConfiguration(request: QaRequest): Promise<unknown> {
    const fullKey = requireString(request.key, 'key');
    const { section, key } = splitConfigurationKey(fullKey);
    const target = resolveConfigurationTarget(request.target);
    await vscode.workspace.getConfiguration(section).update(key, request.value, target);
    return getConfiguration(fullKey);
}

async function openFile(request: QaRequest, runDirectory: string): Promise<unknown> {
    const requestedPath = requireString(request.path, 'path');
    const workspacePath = path.resolve(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.join(runDirectory, 'workspace')
    );
    const filePath = path.isAbsolute(requestedPath)
        ? path.resolve(requestedPath)
        : path.resolve(workspacePath, requestedPath);
    assertPathWithinWorkspace(filePath, workspacePath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(document);
    const line = readPositiveInteger(request.line, 1) - 1;
    const column = readPositiveInteger(request.column, 1) - 1;
    const position = new vscode.Position(line, column);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
    return buildStatusForEditor(editor);
}

function assertPathWithinWorkspace(filePath: string, workspacePath: string): void {
    const relativePath = path.relative(workspacePath, filePath);
    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        throw new Error(`QA file navigation is limited to the isolated workspace: ${filePath}`);
    }
}

function buildStatusForEditor(editor: vscode.TextEditor): unknown {
    return {
        path: editor.document.uri.fsPath,
        line: editor.selection.active.line + 1,
        column: editor.selection.active.character + 1,
    };
}

function splitConfigurationKey(fullKey: string): { section: string; key: string } {
    const separator = fullKey.indexOf('.');
    if (separator <= 0 || separator === fullKey.length - 1) {
        throw new Error(`Configuration key must include a section: ${fullKey}`);
    }
    return { section: fullKey.slice(0, separator), key: fullKey.slice(separator + 1) };
}

function resolveConfigurationTarget(value: unknown): vscode.ConfigurationTarget {
    if (value === undefined || value === 'global') {
        return vscode.ConfigurationTarget.Global;
    }
    if (value === 'workspace') {
        return vscode.ConfigurationTarget.Workspace;
    }
    if (value === 'folder') {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    throw new Error(`Invalid configuration target: ${describeUnknown(value)}`);
}

function readArray(value: unknown): unknown[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('arguments must be a JSON array.');
    }
    return value;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} must be a non-empty string.`);
    }
    return value.trim();
}

function readPositiveInteger(value: unknown, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || Number(value) <= 0) {
        throw new Error(`Expected a positive integer, received ${describeUnknown(value)}.`);
    }
    return Number(value);
}

async function readJsonBody(request: http.IncomingMessage): Promise<QaRequest> {
    let content = '';
    for await (const chunk of request as AsyncIterable<unknown>) {
        if (typeof chunk === 'string') {
            content += chunk;
        } else if (Buffer.isBuffer(chunk)) {
            content += chunk.toString('utf8');
        } else {
            throw new Error('QA control request contained an unsupported body chunk.');
        }
        if (content.length > 1_000_000) {
            throw new Error('QA control request is too large.');
        }
    }
    const parsed: unknown = JSON.parse(content || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('QA control body must be a JSON object.');
    }
    return parsed as QaRequest;
}

function readExtensionVersion(extension: vscode.Extension<unknown> | undefined): string | null {
    const packageJson: unknown = extension?.packageJSON;
    if (!packageJson || typeof packageJson !== 'object' || !('version' in packageJson)) {
        return null;
    }
    const version = packageJson.version;
    return typeof version === 'string' ? version : null;
}

function describeUnknown(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return 'undefined';
    }
    try {
        return JSON.stringify(value);
    } catch {
        return typeof value;
    }
}

function sendJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
    const content = JSON.stringify(value);
    response.writeHead(statusCode, {
        'content-length': Buffer.byteLength(content),
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(content);
}

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('QA control server did not receive a TCP address.'));
                return;
            }
            resolve(address.port);
        });
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
