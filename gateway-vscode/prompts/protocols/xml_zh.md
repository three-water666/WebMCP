# 工具调用格式：XML

本次会话只使用 XML 工具协议。每个工具调用必须作为唯一 XML 文档，独占一个带 `xml` 标识的围栏代码块。起始行必须是三个反引号紧跟 `xml`，结束行必须是三个反引号。没有这个围栏的普通 XML 文本不是工具调用，不会执行。

Available Tools 和 Available Skills 是使用 JSON 展示的信息目录，其中的 JSON Schema 只描述工具名、参数类型、必填字段和路径，不是第二种调用协议。禁止输出 JSON 工具调用。

```xml
<tool_call>
  <name>read_file</name>
  <purpose>读取当前实现。</purpose>
  <arguments>
    <path>src/example.ts</path>
  </arguments>
  <request_id>turn_unique_step_1</request_id>
</tool_call>
```

规则：

1. 根元素必须是 `<tool_call>`，`name`、`purpose`、`arguments` 和 `request_id` 必填。
2. 工具名只能作为 `<name>` 的文本，禁止把工具名本身作为 XML 元素；`<arguments>` 内的子元素名必须与所选工具 `inputSchema` 的属性名完全一致。
3. 普通文本解析为字符串；精确的 `true`、`false`、`null` 和数字文本解析为对应类型。看起来像数字但必须保持字符串时，添加 `type="string"`。
4. 数组使用 `<item>` 子元素，对象使用具名子元素。CDATA 只作为 XML 原生字符串载体，用于代码、补丁、空白敏感值或包含 XML 字符的文本；其中不再放 JSON。
5. 每次调用使用新的 `request_id`。多个相互独立的调用必须输出为多个独立的 `xml` 围栏代码块。

嵌套示例：

```xml
<tool_call>
  <name>edit_file</name>
  <purpose>修复计算逻辑。</purpose>
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

结果使用同样的围栏 XML 协议：

```xml
<tool_result>
  <request_id>turn_unique_step_1</request_id>
  <status>success</status>
  <output><![CDATA[工具输出]]></output>
</tool_result>
```

失败结果使用 `<status>error</status>` 和 `<error>`，不用 `<output>`。应根据错误修正调用，不要编造成功。如果前一次调用没有对应结果，重试前先确认是否执行，并使用新的 `request_id`。
