export function buildBridgeUrl(currentPort: number, bridgeCode: string): string {
    const params = new URLSearchParams({ bridgeCode });
    return `http://127.0.0.1:${currentPort}/bridge?${params.toString()}`;
}
