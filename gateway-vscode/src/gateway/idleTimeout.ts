export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_IDLE_TIMEOUT_MINUTES = 240;

const MILLISECONDS_PER_MINUTE = 60 * 1000;

export function resolveIdleTimeoutMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_IDLE_TIMEOUT_MINUTES;
    }

    return Math.min(
        MAX_IDLE_TIMEOUT_MINUTES,
        Math.max(MIN_IDLE_TIMEOUT_MINUTES, Math.trunc(value))
    );
}

export function resolveIdleTimeoutMs(value: unknown): number {
    return resolveIdleTimeoutMinutes(value) * MILLISECONDS_PER_MINUTE;
}

export function formatIdleTimeoutMinutes(idleTimeoutMs: number): string {
    return String(Math.round(idleTimeoutMs / MILLISECONDS_PER_MINUTE));
}
