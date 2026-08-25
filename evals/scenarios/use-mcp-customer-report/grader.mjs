import path from 'node:path';

import { check, gradeResult, readJson } from '../../graders/grade-utils.mjs';

const EXPECTED = {
  customerId: 'CUST-1042',
  name: 'Northstar Labs',
  plan: 'Team',
  renewalDate: '2026-11-15',
  openTicketCount: 2,
  risk: 'medium',
  evidenceCode: 'MCP-EVAL-7F3A',
};

export async function grade({ workspacePath }) {
  const actual = await readJson(path.join(workspacePath, 'customer-report.json'));
  return gradeResult([
    check('structured-report', 10, actual !== null, 'customer-report.json is valid JSON'),
    check('crm-data', 90, JSON.stringify(actual) === JSON.stringify(EXPECTED), 'report matches the mock CRM record'),
  ]);
}
