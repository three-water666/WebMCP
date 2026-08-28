import * as crypto from 'crypto';

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING_RECORDS = 256;

type ChallengeRecord = {
    expiresAt: number;
    fingerprint: string;
};

export type CommandApprovalChallenge = {
    challengeId: string;
    expiresAt: number;
};

export type CommandApprovalGrant = {
    approvalToken: string;
    expiresAt: number;
};

export class CommandApprovalManager {
    private readonly challenges = new Map<string, ChallengeRecord>();
    private readonly grants = new Map<string, ChallengeRecord>();

    constructor(
        private readonly ttlMs = DEFAULT_TTL_MS,
        private readonly now: () => number = Date.now
    ) { }

    issueChallenge(fingerprint: string): CommandApprovalChallenge {
        this.cleanup();
        this.enforceRecordLimit(this.challenges);
        const challengeId = crypto.randomUUID();
        const expiresAt = this.now() + this.ttlMs;
        this.challenges.set(challengeId, { expiresAt, fingerprint });
        return { challengeId, expiresAt };
    }

    approveChallenge(challengeId: string): CommandApprovalGrant | null {
        this.cleanup();
        const challenge = this.challenges.get(challengeId);
        if (!challenge) {
            return null;
        }

        this.challenges.delete(challengeId);
        this.enforceRecordLimit(this.grants);
        const approvalToken = crypto.randomUUID();
        const expiresAt = this.now() + this.ttlMs;
        this.grants.set(approvalToken, {
            expiresAt,
            fingerprint: challenge.fingerprint
        });
        return { approvalToken, expiresAt };
    }

    consumeGrant(approvalToken: string | undefined, fingerprint: string): boolean {
        this.cleanup();
        if (!approvalToken) {
            return false;
        }

        const grant = this.grants.get(approvalToken);
        if (grant?.fingerprint !== fingerprint) {
            return false;
        }

        this.grants.delete(approvalToken);
        return true;
    }

    clear(): void {
        this.challenges.clear();
        this.grants.clear();
    }

    private cleanup(): void {
        const now = this.now();
        this.removeExpired(this.challenges, now);
        this.removeExpired(this.grants, now);
    }

    private removeExpired(records: Map<string, ChallengeRecord>, now: number): void {
        for (const [key, record] of records) {
            if (record.expiresAt <= now) {
                records.delete(key);
            }
        }
    }

    private enforceRecordLimit(records: Map<string, ChallengeRecord>): void {
        while (records.size >= MAX_PENDING_RECORDS) {
            const oldestKey = records.keys().next().value;
            if (!oldestKey) {
                return;
            }
            records.delete(oldestKey);
        }
    }
}
