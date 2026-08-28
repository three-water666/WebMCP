export const DEFAULT_QA_SITE_ID = 'deepseek';
export const DEFAULT_QA_SCENARIO_ID = 'minimal-tool-loop';

export function parseQaStartArguments(args) {
  const siteId = args[0]?.trim() || DEFAULT_QA_SITE_ID;
  const scenarioId = args[1]?.trim() || DEFAULT_QA_SCENARIO_ID;
  for (const [label, value] of [['site', siteId], ['scenario', scenarioId]]) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
      throw new Error(`Invalid ${label} id: ${value}`);
    }
  }
  if (args.length > 2) {
    throw new Error('qa:start accepts at most a site id and an agent scenario id.');
  }
  return { siteId, scenarioId };
}
