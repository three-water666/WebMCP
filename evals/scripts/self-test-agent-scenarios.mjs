import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  createReferenceTrace,
  gradeAgentWorkspace,
  loadAgentCatalog,
} from './agent-scenario-lib.mjs';

const evalsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = await loadAgentCatalog(evalsRoot);
if (scenarios.length !== 6) {
  throw new Error(`Expected 6 agent scenarios, found ${scenarios.length}.`);
}

for (const scenario of scenarios) {
  const scenarioDirectory = path.dirname(scenario.manifestPath);
  const referencePath = path.join(scenarioDirectory, 'reference');
  const tracePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-eval-trace-')), 'trace.jsonl');
  try {
    const trace = createReferenceTrace(scenario);
    await fs.writeFile(tracePath, trace.map(event => JSON.stringify(event)).join('\n'), 'utf8');
    const referenceGrade = await gradeAgentWorkspace(scenario, referencePath, tracePath);
    if (!referenceGrade.passed || referenceGrade.score !== 100) {
      throw new Error(`Reference solution failed for ${scenario.id}: ${JSON.stringify(referenceGrade)}`);
    }
    const untouchedGrade = await gradeAgentWorkspace(scenario, scenario.fixturePath, tracePath);
    if (untouchedGrade.passed) {
      throw new Error(`Untouched fixture unexpectedly passed for ${scenario.id}.`);
    }
  } finally {
    await fs.rm(path.dirname(tracePath), { recursive: true, force: true });
  }
}

const mcpScenario = scenarios.find(scenario => scenario.id === 'use-mcp-customer-report');
if (!mcpScenario) {
  throw new Error('Missing MCP scenario.');
}
await verifyMockMcpServer(mcpScenario.mcpServers[0]);
console.log(`Validated ${scenarios.length} agent scenarios and the mock MCP server.`);

async function verifyMockMcpServer(server) {
  const client = new Client({ name: 'webcode-eval-self-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.resolvedArgs,
    env: process.env,
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (!tools.tools.some(tool => tool.name === 'lookup_customer')) {
      throw new Error('Mock CRM MCP server did not expose lookup_customer.');
    }
    const response = await client.callTool({
      name: 'lookup_customer',
      arguments: { customerId: 'CUST-1042' },
    });
    if (!JSON.stringify(response).includes('MCP-EVAL-7F3A')) {
      throw new Error('Mock CRM MCP server returned unexpected customer data.');
    }
  } finally {
    await client.close();
  }
}
