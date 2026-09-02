import type express from 'express';

import { PROMPTS } from '../defaults';
import type { GatewayConfig, GatewayLogger } from './types';
import { buildSyncedAiSites } from './syncedSites';

export function registerConfigRoutes(
    app: express.Express,
    config: GatewayConfig,
    log: GatewayLogger,
    getSessionHealth?: () => unknown
): void {
    app.get('/v1/status', (_req, res) => {
        res.json({
            ok: true,
            sessionHealth: getSessionHealth?.()
        });
    });

    app.get('/v1/init', (req, res) => {
        log('📥 Init Sync: Browser requested default rules and prompts');

        res.json({
            syncedAiSites: buildSyncedAiSites(config.aiSites ?? []),
            prompts: PROMPTS
        });
    });

    app.get('/v1/config', (req, res) => {
        res.json({ config: null });
    });

    app.post('/v1/config', (req, res) => {
        res.json({ success: true });
    });
}
