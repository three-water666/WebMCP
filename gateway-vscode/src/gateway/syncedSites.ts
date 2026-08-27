import type { ResolvedAiSiteConfig } from '../platforms';

export interface SyncedAiSiteConfig {
    capture?: ResolvedAiSiteConfig['capture'];
    id: string;
    name: string;
    selectors: ResolvedAiSiteConfig['selectors'];
}

export function buildSyncedAiSites(aiSites: readonly ResolvedAiSiteConfig[]): SyncedAiSiteConfig[] {
    return aiSites.map(site => ({
        ...(site.capture ? {
            capture: { ...site.capture, channels: [...site.capture.channels] }
        } : {}),
        id: site.id,
        name: site.name,
        selectors: site.selectors
    }));
}
