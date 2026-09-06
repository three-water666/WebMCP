import * as crypto from 'crypto';

export const DEFAULT_BRIDGE_CODE_TTL_MS = 60 * 1000;

const MAX_PENDING_BRIDGE_CODES = 64;

export interface PendingBridgeLaunch {
    siteId: string;
    targetUrl: string;
}

type PendingBridgeCode = PendingBridgeLaunch & {
    expiresAt: number;
};

type RandomSecretFactory = () => string;

function createRandomSecret(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Owns the short-lived launch codes and the browser session token shared by the
 * current gateway lifecycle. Launch codes are safe to place in a URL because they
 * expire quickly and can be consumed only once. The API session token is returned
 * only by the redemption response and is revoked when the gateway stops or restarts.
 */
export class BridgeSessionManager {
    private readonly pendingCodes = new Map<string, PendingBridgeCode>();
    private activeSessionToken: string | null = null;

    constructor(
        private readonly bridgeCodeTtlMs = DEFAULT_BRIDGE_CODE_TTL_MS,
        private readonly now: () => number = Date.now,
        private readonly createSecret: RandomSecretFactory = createRandomSecret
    ) { }

    issueBridgeCode(launch: PendingBridgeLaunch): string {
        this.cleanupExpiredCodes();
        this.enforcePendingCodeLimit();

        let code = this.createSecret();
        while (this.pendingCodes.has(code)) {
            code = this.createSecret();
        }

        this.pendingCodes.set(code, {
            ...launch,
            expiresAt: this.now() + this.bridgeCodeTtlMs
        });
        return code;
    }

    getBridgeLaunch(code: string): PendingBridgeLaunch | null {
        this.cleanupExpiredCodes();
        const pending = this.pendingCodes.get(code);
        return pending ? { siteId: pending.siteId, targetUrl: pending.targetUrl } : null;
    }

    consumeBridgeCode(code: string): PendingBridgeLaunch | null {
        this.cleanupExpiredCodes();
        const pending = this.pendingCodes.get(code);
        if (!pending) {
            return null;
        }

        this.pendingCodes.delete(code);
        return {
            siteId: pending.siteId,
            targetUrl: pending.targetUrl
        };
    }

    activateSession(): string {
        this.activeSessionToken ??= this.createSecret();
        return this.activeSessionToken;
    }

    isSessionTokenValid(token: string | undefined): boolean {
        return Boolean(token && this.activeSessionToken && token === this.activeSessionToken);
    }

    clear(): void {
        this.pendingCodes.clear();
        this.activeSessionToken = null;
    }

    private cleanupExpiredCodes(): void {
        const now = this.now();
        for (const [code, pending] of this.pendingCodes) {
            if (pending.expiresAt <= now) {
                this.pendingCodes.delete(code);
            }
        }
    }

    private enforcePendingCodeLimit(): void {
        while (this.pendingCodes.size >= MAX_PENDING_BRIDGE_CODES) {
            const oldestCode = this.pendingCodes.keys().next().value;
            if (!oldestCode) {
                return;
            }
            this.pendingCodes.delete(oldestCode);
        }
    }
}
