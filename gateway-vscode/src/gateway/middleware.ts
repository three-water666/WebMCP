import cors from 'cors';
import type express from 'express';
import { PROTOCOL } from '@webcode/shared';

import type { GatewayConfig, GatewayLogger } from './types';

export function createCorsMiddleware(config: GatewayConfig, log: GatewayLogger): express.RequestHandler {
    return cors({
        origin: (origin, callback) => {
            if (isAllowedCorsOrigin(origin, config.allowedOrigins)) {
                return callback(null, true);
            }
            log(`⛔ Blocked CORS request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    });
}

export function isAllowedCorsOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
    if (!origin) {
        return true;
    }
    if (allowedOrigins.includes(origin)) {
        return true;
    }

    let parsedOrigin: URL;
    try {
        parsedOrigin = new URL(origin);
    } catch {
        return false;
    }

    return isChromeExtensionOrigin(parsedOrigin) || isLoopbackHttpOrigin(parsedOrigin, origin);
}

function isChromeExtensionOrigin(origin: URL): boolean {
    return origin.protocol === 'chrome-extension:' &&
        Boolean(origin.hostname) &&
        !origin.username &&
        !origin.password &&
        !origin.search &&
        !origin.hash &&
        (origin.pathname === '' || origin.pathname === '/');
}

function isLoopbackHttpOrigin(parsedOrigin: URL, rawOrigin: string): boolean {
    return parsedOrigin.protocol === 'http:' &&
        (parsedOrigin.hostname === '127.0.0.1' || parsedOrigin.hostname === 'localhost') &&
        parsedOrigin.origin === rawOrigin;
}

export function createRequestLoggerMiddleware(
    log: GatewayLogger
): express.RequestHandler {
    return (req, res, next) => {
        const start = Date.now();
        if (req.method !== 'OPTIONS') {
            log(`🔔 [${req.method}] ${req.path}`);
        }
        res.on('finish', () => {
            const duration = Date.now() - start;
            if (req.method !== 'OPTIONS') {
                const icon = res.statusCode >= 400 ? '❌' : '   🏁';
                log(`${icon} Status: ${res.statusCode} (${duration}ms)`);
            }
        });
        next();
    };
}

const GATEWAY_ACTIVITY_ROUTES = new Set([
    'GET /v1/init',
    'GET /v1/config',
    'POST /v1/config',
    'POST /v1/tools/preflight',
    'POST /v1/tools/approve',
    'POST /v1/tools/call'
]);

export function isGatewayActivityRequest(method: string, requestPath: string): boolean {
    return GATEWAY_ACTIVITY_ROUTES.has(`${method.toUpperCase()} ${requestPath}`);
}

export function createGatewayActivityMiddleware(resetWatchdog: () => void): express.RequestHandler {
    return (req, _res, next) => {
        if (isGatewayActivityRequest(req.method, req.path)) {
            resetWatchdog();
        }
        next();
    };
}

export function createAuthMiddleware(
    isTokenValid: (token: string | undefined) => boolean,
    log: GatewayLogger
): express.RequestHandler {
    return (req, res, next) => {
        if (req.method === 'OPTIONS') {
            return next();
        }

        const rawClientToken = req.headers[PROTOCOL.authHeaderLowerName];
        const clientToken = Array.isArray(rawClientToken) ? rawClientToken[0] : rawClientToken;
        if (!isTokenValid(clientToken)) {
            log(`⛔ Unauthorized access attempt (${clientToken ? 'invalid token' : 'missing token'}).`);
            return res.status(403).json({
                isError: true,
                content: [{ type: 'text', text: "⛔ Forbidden: Invalid Security Token. Please launch from VS Code." }]
            });
        }
        next();
    };
}
