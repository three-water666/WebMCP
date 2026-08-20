import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findAgentScenario,
  gradeAgentRun,
  loadAgentCatalog,
  prepareAgentScenario,
} from './agent-scenario-lib.mjs';

const evalsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'list', argument] = process.argv.slice(2);

if (command === 'list') {
  const scenarios = await loadAgentCatalog(evalsRoot);
  console.table(scenarios.map(scenario => ({
    id: scenario.id,
    category: scenario.category,
    difficulty: scenario.difficulty,
    mcp: scenario.mcpServers.map(server => server.id).join(', '),
  })));
} else if (command === 'prepare') {
  if (!argument) {
    throw new Error('Usage: pnpm eval:scenarios prepare <scenario-id>');
  }
  const scenario = await findAgentScenario(evalsRoot, argument);
  const run = await prepareAgentScenario(evalsRoot, scenario);
  console.log(`Prepared ${scenario.id}`);
  console.log(`Task: ${run.taskPath}`);
  console.log(`Workspace: ${run.workspacePath}`);
  console.log(`Gateway config: ${run.gatewayConfigPath}`);
  console.log(`Run: ${run.runDirectory}`);
} else if (command === 'grade') {
  if (!argument) {
    throw new Error('Usage: pnpm eval:scenarios grade <run-directory>');
  }
  const { result, gradePath, scenario } = await gradeAgentRun(argument);
  console.log(`${scenario.id}: ${result.passed ? 'passed' : 'failed'} (${result.score}/100)`);
  console.log(`Grade: ${gradePath}`);
  if (!result.passed) {
    process.exitCode = 1;
  }
} else {
  throw new Error(`Unknown agent scenario command: ${command}`);
}
