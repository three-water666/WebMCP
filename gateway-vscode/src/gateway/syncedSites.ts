import type { ResolvedAiSiteConfig } from '../platforms';

export interface SyncedAiSiteConfig {
    id: string;
    name: string;
    toolProtocol: ResolvedAiSiteConfig['toolProtocol'];
    selectors: ResolvedAiSiteConfig['selectors'];
}

export function buildSyncedAiSites(aiSites: readonly ResolvedAiSiteConfig[]): SyncedAiSiteConfig[] {
    return aiSites.map(site => ({
        id: site.id,
        name: site.name,
        toolProtocol: site.toolProtocol,
        selectors: site.selectors
    }));
}
