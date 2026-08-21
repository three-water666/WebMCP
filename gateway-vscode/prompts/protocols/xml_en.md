# Tool Call Format: XML

This conversation uses only the XML tool protocol. Every tool call must be the sole XML document inside its own fenced `xml` code block. The opening line must be exactly three backticks followed by `xml`, and the closing line must be exactly three backticks. Plain XML text without this fence is not a tool call and will not execute.

Available Tools and Available Skills are informational catalogs shown as JSON. Their JSON Schema describes names, parameter types, required fields, and paths only; it is not a second call protocol. Never output a JSON tool call.

```xml
<tool_call>
  <name>read_file</name>
  <purpose>Read the current implementation.</purpose>
  <arguments>
    <path>src/example.ts</path>
  </arguments>
  <request_id>turn_unique_step_1</request_id>
</tool_call>
```

Rules:

1. The root must be `<tool_call>`. `name`, `purpose`, `arguments`, and `request_id` are required.
2. The tool name must be text inside `<name>`; never use the tool name itself as an XML element. Child names inside `<arguments>` must exactly match the selected tool's `inputSchema` property names.
3. Scalar text becomes a string. Exact `true`, `false`, `null`, and numeric text become their corresponding types. Add `type="string"` when numeric-looking text must stay a string.
4. Represent arrays with `<item>` children and objects with named child elements. Use CDATA as native XML string content for code, patches, whitespace-sensitive values, or text containing XML characters; it never contains JSON.
5. Use a new `request_id` for every call. For multiple independent calls, output multiple separate fenced `xml` code blocks.

Nested example:

```xml
<tool_call>
  <name>edit_file</name>
  <purpose>Fix the calculation.</purpose>
  <arguments>
    <path>src/example.ts</path>
    <edits>
      <item>
        <oldText><![CDATA[const total = subtotal + tax;]]></oldText>
        <newText><![CDATA[const total = discountedSubtotal + tax;]]></newText>
      </item>
    </edits>
  </arguments>
  <request_id>turn_unique_step_2</request_id>
</tool_call>
```

Results use the same fenced XML protocol:

```xml
<tool_result>
  <request_id>turn_unique_step_1</request_id>
  <status>success</status>
  <output><![CDATA[tool output]]></output>
</tool_result>
```

Errors use `<status>error</status>` and `<error>` instead of `<output>`. Correct failed calls instead of fabricating success. If a prior call has no matching result, verify whether it executed before retrying with a new `request_id`.
