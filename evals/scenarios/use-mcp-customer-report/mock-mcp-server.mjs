import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'webcode-eval-crm', version: '1.0.0' });

server.registerTool(
  'lookup_customer',
  {
    description: 'Look up a customer record by its exact customer ID.',
    inputSchema: { customerId: z.string() },
  },
  async ({ customerId }) => {
    if (customerId !== 'CUST-1042') {
      return {
        isError: true,
        content: [{ type: 'text', text: `Customer not found: ${customerId}` }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          customerId,
          name: 'Northstar Labs',
          plan: 'Team',
          renewalDate: '2026-11-15',
          openTicketCount: 2,
          risk: 'medium',
          evidenceCode: 'MCP-EVAL-7F3A',
        }),
      }],
    };
  }
);

await server.connect(new StdioServerTransport());
