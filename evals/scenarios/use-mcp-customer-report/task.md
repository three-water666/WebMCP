# Task: prepare a customer report using CRM data

Read `request.json`. Use the configured CRM MCP tool to look up the requested customer, then create
`customer-report.json` with these fields:

- `customerId`
- `name`
- `plan`
- `renewalDate`
- `openTicketCount`
- `risk` (`low`, `medium`, or `high`)
- `evidenceCode`

Do not invent CRM data and do not put fallback sample values in the implementation.
