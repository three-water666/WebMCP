import { t } from "./i18n";

export type ApprovalModalContent = {
  alwaysDescription: string;
  alwaysOptionsHtml: string;
  alwaysTitle: string;
  safeAlwaysTarget: string;
  safeArgs: string;
  safeName: string;
  safePurpose: string;
  safeRiskReasons: string[];
};

export type CommandApprovalOptions = {
  exactKey: string;
  executableKey: string;
  isBroadExecutable: boolean;
  prefixKey: string;
};

export const APPROVAL_MODAL_STYLE = `
          :host { all: initial; color-scheme: light; }
          *, *::before, *::after { box-sizing: border-box; }
          .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; padding: 24px; overflow-y: auto; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .card { background: #fff; padding: 24px; border-radius: 12px; width: 450px; max-width: min(90vw, 450px); max-height: calc(100vh - 48px); overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.4); border: 1px solid #e0e0e0; color: #333; animation: fadeIn 0.2s ease-out; box-sizing: border-box; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          h2 { margin: 0 0 16px 0; color: #d32f2f; display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 600; }
          .warn-icon { font-size: 24px; }
          .field { margin-bottom: 16px; }
          .label { font-weight: 600; font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: block; }
          .value { background: #f8f9fa; padding: 10px; border-radius: 6px; font-family: "Menlo", "Consolas", monospace; font-size: 13px; white-space: pre-wrap; word-break: break-all; max-height: 250px; overflow-y: auto; border: 1px solid #e9ecef; color: #212529; }
          .buttons { display: flex; gap: 12px; margin-top: 24px; justify-content: flex-end; align-items: center; }
          button, input { font: inherit; }
          button { padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s; }
          button:hover { transform: translateY(-1px); box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          .btn-reject { background: #fff; color: #dc3545; border: 1px solid #dc3545; }
          .btn-reject:hover { background: #dc3545; color: white; }
          .btn-confirm { background: #2e7d32; color: white; box-shadow: 0 2px 5px rgba(46, 125, 50, 0.3); }
          .btn-confirm:hover { background: #1b5e20; box-shadow: 0 4px 8px rgba(46, 125, 50, 0.4); }
          .btn-always { background: #ff9800; color: white; margin-right: auto; }
          .btn-always:hover { background: #f57c00; }
          .btn-back { background: #6c757d; color: white; display: none; margin-right: auto; }
          .btn-back:hover { background: #5a6268; }
          .approval-options { display: grid; gap: 10px; margin-top: 14px; text-align: left; }
          .approval-option { border: 1px solid #d7dce2; border-radius: 8px; padding: 12px; background: #f8f9fa; }
          .approval-option.warning { border-color: #f59e0b; background: #fff7ed; }
          .approval-option.disabled { border-color: #fca5a5; background: #fff1f2; }
          .approval-option strong { display: block; color: #1f2937; margin-bottom: 4px; }
          .approval-option code { display: block; margin-top: 6px; padding: 8px; border-radius: 6px; background: #eef2f7; color: #1d4ed8; word-break: break-all; }
          .approval-option button { margin-top: 10px; width: 100%; }
          .scope-warning { color: #b45309; font-size: 12px; font-weight: 600; margin-top: 8px; }
          .risk-reasons { border: 1px solid #f59e0b; background: #fff7ed; color: #92400e; }
          .risk-reasons ul { margin: 0; padding-left: 20px; }
          .risk-reasons li + li { margin-top: 6px; }
          button:disabled { cursor: not-allowed; opacity: 0.65; transform: none; box-shadow: none; }
          input.reason { width: 100%; box-sizing: border-box; padding: 10px; margin-top: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; display: none; }
          input.reason:focus { outline: none; border-color: #dc3545; }
      `;

export function renderApprovalModalHtml(content: ApprovalModalContent): string {
  const riskHtml = content.safeRiskReasons.length > 0
    ? `
              <div class="field">
                  <span class="label">${t("label_risk")}</span>
                  <div class="value risk-reasons"><ul>${content.safeRiskReasons.map(reason => `<li>${reason}</li>`).join("")}</ul></div>
              </div>`
    : "";
  return `
          <h2><span class="warn-icon">✋</span> ${t("hitl_title")}</h2>

          <div id="view-main">
              <div class="field">
                  <span class="label">${t("label_tool")}</span>
                  <div class="value" style="font-weight:bold; color:#d32f2f">${content.safeName}</div>
              </div>
              <div class="field">
                  <span class="label">${t("label_purpose")}</span>
                  <div class="value" style="color:#1976d2; font-weight:500">${content.safePurpose}</div>
              </div>
              <div class="field">
                  <span class="label">${t("label_args")}</span>
                  <div class="value">${content.safeArgs}</div>
              </div>
              ${riskHtml}
          </div>

          <div id="view-always-confirm" style="display:none; padding: 15px 0; text-align: center;">
               <div style="font-size: 40px; margin-bottom: 10px;">🔓</div>
               <p style="color:#d32f2f; font-weight:bold; font-size: 16px; margin: 0 0 10px 0;">${content.alwaysTitle}</p>
               <p style="color:#666; font-size: 13px; line-height: 1.5; margin: 0;">
                  ${t("always_desc_1")} <b>${content.safeAlwaysTarget}</b>.<br>
                  ${content.alwaysDescription}
               </p>
               ${content.alwaysOptionsHtml}
          </div>

          <input type="text" class="reason" placeholder="${t("placeholder_reason")}">

          <div class="buttons">
              <button class="btn-always">${t("btn_always")}</button>
              <button class="btn-back">${t("btn_back")}</button>
              <button class="btn-reject">${t("btn_reject")}</button>
              <button class="btn-confirm">${t("btn_approve")}</button>
              <button class="btn-confirm-always" style="display:none; background:#ff9800; color:white;">${t("btn_allow_confirm")}</button>
          </div>
      `;
}

export function renderCommandApprovalOptions(options: CommandApprovalOptions): string {
  const executableOptionHtml = options.executableKey
    ? renderExecutableApprovalOption(options.executableKey, options.isBroadExecutable)
    : "";
  const prefixOptionHtml = options.prefixKey
    ? renderPrefixApprovalOption(options.prefixKey, options.isBroadExecutable)
    : "";

  return `
          <div class="approval-options">
              <div class="approval-option">
                  <strong>${t("cmd_scope_exact_title")}</strong>
                  <div>${t("cmd_scope_exact_desc")}</div>
                  <div class="label">${t("label_rule_key")}</div>
                  <code>${options.exactKey}</code>
                  <button class="btn-allow-exact btn-scope-approve">${t("btn_allow_exact")}</button>
              </div>
              ${prefixOptionHtml}
              ${executableOptionHtml}
          </div>
      `;
}

export function escapeHtml(unsafe: string): string {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderExecutableApprovalOption(executableKey: string, isBroadExecutable: boolean): string {
  if (isBroadExecutable) {
    return `
              <div class="approval-option disabled">
                  <strong>${t("cmd_scope_executable_title")}</strong>
                  <div>${t("cmd_scope_executable_desc")}</div>
                  <div class="scope-warning">${t("cmd_scope_executable_blocked")}</div>
                  <button class="btn-allow-executable btn-scope-approve" disabled>${t("btn_allow_executable")}</button>
              </div>
          `;
  }

  return `
              <div class="approval-option">
                  <strong>${t("cmd_scope_executable_title")}</strong>
                  <div>${t("cmd_scope_executable_desc")}</div>
                  <div class="label">${t("label_rule_key")}</div>
                  <code>${executableKey}</code>
                  <button class="btn-allow-executable btn-scope-approve">${t("btn_allow_executable")}</button>
              </div>
          `;
}

function renderPrefixApprovalOption(prefixKey: string, isBroadExecutable: boolean): string {
  const warning = isBroadExecutable
    ? `<div class="scope-warning">${t("cmd_scope_prefix_warning")}</div>`
    : "";

  return `
              <div class="approval-option${isBroadExecutable ? " warning" : ""}">
                  <strong>${t("cmd_scope_prefix_title")}</strong>
                  <div>${t("cmd_scope_prefix_desc")}</div>
                  ${warning}
                  <div class="label">${t("label_rule_key")}</div>
                  <code>${prefixKey}</code>
                  <button class="btn-allow-prefix btn-scope-approve">${t("btn_allow_prefix")}</button>
              </div>
          `;
}
