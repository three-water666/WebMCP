import { TOOL_ACTIVITY_OVERLAY_Z_INDEX } from "../modules/overlay_layers";

export const TOOL_ACTIVITY_STYLE_TEXT = `
  :host { position: fixed; right: 20px; bottom: 20px; z-index: ${TOOL_ACTIVITY_OVERLAY_Z_INDEX}; width: min(390px, calc(100vw - 32px));
    max-height: calc(100vh - 32px); color-scheme: dark; }
  :host(.current-collapsed) { width: min(290px, calc(100vw - 16px)); }
  * { box-sizing: border-box; }
  button { font: inherit; }
  .overlay-stack { display: flex; max-height: inherit; flex-direction: column; gap: 10px; }
  .panel, .history-panel { width: 100%; display: flex; overflow: hidden; flex-direction: column; color: #f3f4f6;
    background: rgba(20, 22, 26, .96); border: 1px solid #3b404a; border-radius: 12px; box-shadow: 0 12px 34px rgba(0, 0, 0, .38);
    font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; backdrop-filter: blur(10px); }
  .panel { max-height: min(360px, 46vh); align-self: flex-end; }
  .panel.collapsed { width: 100%; min-width: 0; }
  .history-panel { height: min(300px, 40vh); min-height: min(160px, 30vh); flex: 0 1 auto; }
  .header, .history-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 10px; user-select: none; }
  .header { min-height: 54px; padding: 9px 10px 9px 12px; }
  .history-header { min-height: 40px; padding: 7px 8px 7px 11px; border-bottom: 1px solid #343942; }
  .drag-header { cursor: move; }
  .identity { min-width: 0; flex: 1; display: flex; align-items: center; gap: 10px; }
  .heading { min-width: 0; }
  .mark { width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; color: #fff;
    background: #2563eb; font-weight: 700; }
  .mark.active { animation: pulse 1.4s ease-in-out infinite; }
  .mark.success { background: #15803d; }
  .mark.warn { background: #b45309; }
  .mark.error { background: #b91c1c; }
  .title, .history-title { overflow: hidden; color: #f9fafb; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .summary { overflow: hidden; margin-top: 1px; color: #aeb5c2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .actions { flex: 0 0 auto; display: flex; gap: 3px; }
  .icon-button, .history-button { height: 25px; padding: 0; border: 0; border-radius: 6px; color: #c8ced8; background: transparent; cursor: pointer; }
  .icon-button { width: 25px; }
  .history-button { width: auto; padding: 0 7px; font-size: 10px; white-space: nowrap; }
  .history-button.active { color: #dbeafe; background: rgba(37, 99, 235, .22); }
  .icon-button:hover, .history-button:hover { color: #fff; background: rgba(255, 255, 255, .1); }
  .icon-button.close:hover { background: #8f1d1d; }
  .list { min-height: 0; flex: 1 1 auto; overflow-y: auto; border-top: 1px solid #343942; }
  .row { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .status-dot { width: 8px; height: 8px; flex: 0 0 auto; margin-top: 5px; border-radius: 50%; background: #718096; }
  .row.awaiting_approval .status-dot { background: #f59e0b; }
  .row.executing .status-dot { background: #3b82f6; box-shadow: 0 0 0 4px rgba(59, 130, 246, .13); animation: pulse 1.2s ease-in-out infinite; }
  .row.succeeded .status-dot { background: #22c55e; }
  .row.failed .status-dot, .row.rejected .status-dot { background: #ef4444; }
  .row-content { min-width: 0; flex: 1; }
  .row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .tool-identity { min-width: 0; display: flex; align-items: center; gap: 6px; }
  .tool-name { min-width: 0; overflow: hidden; color: #f3f4f6; font: 600 12px/1.4 "SFMono-Regular", Consolas, monospace;
    text-overflow: ellipsis; white-space: nowrap; }
  .source-badge { flex: 0 0 auto; padding: 0 5px; border: 1px solid #555d69; border-radius: 999px;
    color: #d1d5db; background: rgba(107, 114, 128, .16); font-size: 9px; font-weight: 650; line-height: 16px; }
  .source-badge.network { border-color: #315d9e; color: #93c5fd; background: rgba(37, 99, 235, .18); }
  .status { flex: 0 0 auto; color: #aeb5c2; font-size: 10px; }
  .purpose, .detail, .message { overflow: hidden; margin-top: 3px; text-overflow: ellipsis; white-space: nowrap; }
  .purpose { color: #c4c9d2; }
  .detail { color: #8fb9ff; font-family: "SFMono-Regular", Consolas, monospace; }
  .message { color: #fca5a5; }
  .footer { flex: 0 0 auto; padding: 8px 12px; color: #9fbfff; background: rgba(37, 99, 235, .1); font-size: 11px; }
  .footer.success { color: #86efac; background: rgba(21, 128, 61, .13); }
  .footer.warn { color: #fcd34d; background: rgba(180, 83, 9, .13); }
  .footer.error { color: #fca5a5; background: rgba(185, 28, 28, .13); }
  .history-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 8px; }
  .history-empty { padding: 18px 8px; color: #858d9a; text-align: center; }
  .history-turn { overflow: hidden; border: 1px solid #343942; border-radius: 8px; background: rgba(255, 255, 255, .025); }
  .history-turn + .history-turn { margin-top: 8px; }
  .history-turn-header { min-height: 42px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; background: rgba(255, 255, 255, .025); }
  .history-turn-header .mark { width: 20px; height: 20px; font-size: 10px; }
  .turn-heading { min-width: 0; flex: 1; }
  .turn-name { color: #e5e7eb; font-size: 11px; font-weight: 650; }
  .turn-meta { overflow: hidden; margin-top: 1px; color: #9ca3af; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .history-tool-list .row { padding: 9px 10px; }
  .history-turn .footer { padding: 6px 10px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
`;
