interface I18nState {
  lang: "zh" | "en";
  resources: {
    prompt: string | null;
    train: string | null;
    error: string | null;
    init: string | null;
    oversize: string | null;
  };
}

export const i18n: I18nState = {
  lang: navigator.language.startsWith("zh") ? "zh" : "en",
  resources: {
    prompt: null,
    train: null,
    error: null,
    init: null,
    oversize: null,
  },
};

const I18N_MESSAGES: Record<string, { en: string; zh: string }> = {
  auto_filled: {
    en: "Auto-filled initial Prompt",
    zh: "已自动填充初始 Prompt",
  },
  captured: { en: "Captured Call", zh: "捕获调用" },
  args: { en: "Args", zh: "参数" },
  exec_success: { en: "Execution Success", zh: "执行成功" },
  exec_fail: { en: "Execution Failed", zh: "执行失败" },
  training_hint: {
    en: "Added periodic training note",
    zh: "已附加定期复训提示",
  },
  input_not_found: { en: "Input box not found!", zh: "找不到输入框!" },
  result_written: {
    en: "Result written back to input",
    zh: "结果已回填至输入框",
  },
  send_success_cleared: {
    en: "Send success (Input cleared)",
    zh: "发送成功 (输入框已清空)",
  },
  send_btn_missing: {
    en: "Send button not found...",
    zh: "未找到发送按钮...",
  },
  send_btn_disabled: {
    en: "Send button disabled (UI not updated)...",
    zh: "发送按钮仍被禁用 (UI未更新)...",
  },
  auto_send_attempt: { en: "Attempting auto-send", zh: "尝试自动发送" },
  auto_send_timeout: {
    en: "Auto-send timed out, please click manually",
    zh: "自动发送超时，请手动点击发送",
  },
  config_updated: { en: "Selectors config updated", zh: "选择器配置已更新" },
  waiting_tools: { en: "Waiting for tools...", zh: "等待工具执行..." },
  hitl_intercept: { en: "Intercepted for approval", zh: "拦截等待审批" },
  hitl_rejected: { en: "User rejected execution", zh: "用户拒绝执行" },
  visual_processing: { en: "Running", zh: "执行中" },
  visual_success: { en: "Completed", zh: "执行完成" },
  visual_error: { en: "Error", zh: "错误" },
  activity_title: { en: "Tool activity", zh: "工具活动" },
  activity_captured: { en: "Captured", zh: "已捕获" },
  activity_queued: { en: "Queued", zh: "排队中" },
  activity_awaiting_approval: { en: "Approval", zh: "等待审批" },
  activity_executing: { en: "Running", zh: "执行中" },
  activity_succeeded: { en: "Completed", zh: "已完成" },
  activity_failed: { en: "Failed", zh: "失败" },
  activity_rejected: { en: "Rejected", zh: "已拒绝" },
  activity_waiting_delivery: { en: "Waiting to return results", zh: "等待回填结果" },
  activity_delivering: { en: "Returning results", zh: "正在回填结果" },
  activity_delivered: { en: "Results returned", zh: "结果已回填" },
  activity_delivery_failed: { en: "Result delivery failed", zh: "结果回填失败" },
  activity_minimize: { en: "Minimize", zh: "收起" },
  activity_expand: { en: "Expand", zh: "展开" },
  activity_close: { en: "Close", zh: "关闭" },
  activity_current: { en: "Current", zh: "当前" },
  activity_history: { en: "History", zh: "历史" },
  activity_current_turn: { en: "Current turn", zh: "当前轮" },
  activity_previous_turns: { en: "Previous turns", zh: "之前的轮次" },
  activity_no_history: { en: "No previous tool activity", zh: "暂无之前的工具活动" },

  hitl_title: { en: "Approval Required", zh: "请求执行工具" },
  label_tool: { en: "Tool Name", zh: "工具名称" },
  label_purpose: { en: "Purpose", zh: "操作意图" },
  label_args: { en: "Arguments", zh: "调用参数" },
  label_risk: { en: "Why confirmation is required", zh: "需要确认的风险" },
  label_rule_key: { en: "Rule Key", zh: "匹配规则" },
  placeholder_reason: { en: "Reason for rejection (Optional)...", zh: "拒绝理由 (可选)..." },

  btn_always: { en: "⚡ Always Allow", zh: "⚡ 永久允许" },
  btn_back: { en: "Back", zh: "返回" },
  btn_reject: { en: "Reject", zh: "拒绝" },
  btn_reject_confirm: { en: "Confirm Rejection", zh: "确认拒绝" },
  btn_approve: { en: "Approve", zh: "允许" },
  btn_allow_confirm: { en: "Confirm Allow", zh: "确认永久允许" },
  btn_allow_exact: { en: "Allow Exact Command", zh: "允许精确命令" },
  btn_allow_executable: { en: "Allow Executable", zh: "允许可执行文件" },
  btn_allow_prefix: { en: "Allow Prefix", zh: "允许命令前缀" },

  always_title: { en: "Remove Protection?", zh: "移除保护？" },
  always_desc_1: { en: "You are about to permanently allow", zh: "您即将把以下工具移出保护名单：" },
  always_desc_2: {
    en: "Future calls will execute automatically without approval.",
    zh: "今后 AI 调用此工具将不再经过人工审批。",
  },
  cmd_always_title: { en: "Allow This Command Permanently?", zh: "永久允许这条命令？" },
  cmd_always_desc: {
    en: "Choose the permanent approval scope for this command in the current workspace.",
    zh: "为当前工作区的这条命令选择永久授权范围。",
  },
  cmd_scope_exact_title: { en: "Exact Command", zh: "精确命令" },
  cmd_scope_exact_desc: {
    en: "Only this exact command, directory, and shell profile will be auto-approved.",
    zh: "只有这条精确命令、执行目录和 Shell profile 会被自动放行。",
  },
  cmd_scope_executable_title: { en: "Executable", zh: "可执行文件" },
  cmd_scope_executable_desc: {
    en: "Any command for this tool whose executable matches this value will be auto-approved.",
    zh: "此工具下，只要可执行文件匹配该值的命令都会被自动放行。",
  },
  cmd_scope_prefix_title: { en: "Command Prefix", zh: "命令前缀" },
  cmd_scope_prefix_desc: {
    en: "Any command starting with this normalized prefix will be auto-approved.",
    zh: "只要以这个归一化前缀开头的命令都会被自动放行。",
  },
  cmd_scope_executable_blocked: {
    en: "Executable-wide approval is disabled for shells, interpreters, and package managers. Use exact command approval or a narrower prefix.",
    zh: "Shell、解释器和包管理器不允许按可执行文件永久放行。请使用精确命令或更窄的前缀。",
  },
  cmd_scope_prefix_warning: {
    en: "This prefix starts with a shell, interpreter, or package manager and can still cover many commands.",
    zh: "此前缀以 Shell、解释器或包管理器开头，仍可能覆盖大量命令。",
  },
};

export function t(key: string): string {
  const entry = I18N_MESSAGES[key];
  if (!entry) {return key;}
  return entry[i18n.lang] ?? entry.en;
}
