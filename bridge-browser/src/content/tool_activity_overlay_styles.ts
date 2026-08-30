import { TOOL_ACTIVITY_OVERLAY_Z_INDEX } from "../modules/overlay_layers";

export const TOOL_ACTIVITY_STYLE_TEXT = `
  :host { position: fixed; right: 20px; bottom: 20px; z-index: ${TOOL_ACTIVITY_OVERLAY_Z_INDEX}; width: min(390px, calc(100vw - 32px)); color-scheme: dark; }
  * { box-sizing: border-box; }
  button { font: inherit; }
  .panel { display: flex; max-height: min(460px, calc(100vh - 40px)); overflow: hidden; flex-direction: column; color: #f3f4f6;
    background: rgba(20, 22, 26, .96); border: 1px solid #3b404a; border-radius: 12px; box-shadow: 0 12px 34px rgba(0, 0, 0, .38);
    font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; backdrop-filter: blur(10px); }
  .panel.collapsed { width: fit-content; min-width: 250px; margin-left: auto; }
  .header { min-height: 54px; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 9px 10px 9px 12px; }
  .identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
  .mark { width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; color: #fff;
    background: #2563eb; font-weight: 700; }
  .mark.active { animation: pulse 1.4s ease-in-out infinite; }
  .mark.success { background: #15803d; }
  .mark.warn { background: #b45309; }
  .mark.error { background: #b91c1c; }
  .title { overflow: hidden; color: #f9fafb; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .summary { overflow: hidden; margin-top: 1px; color: #aeb5c2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 3px; }
  .icon-button { width: 25px; height: 25px; padding: 0; border: 0; border-radius: 6px; color: #c8ced8; background: transparent; cursor: pointer; }
  .icon-button:hover { color: #fff; background: rgba(255, 255, 255, .1); }
  .icon-button.close:hover { background: #8f1d1d; }
  .tabs { flex: 0 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 5px; border-top: 1px solid #343942;
    background: rgba(255, 255, 255, .025); }
  .view-tab { padding: 5px 8px; border: 0; border-radius: 6px; color: #9ca3af; background: transparent; cursor: pointer; font-size: 11px; }
  .view-tab.active { color: #f9fafb; background: #303641; font-weight: 650; }
  .list { min-height: 0; flex: 1 1 auto; overflow-y: auto; border-top: 1px solid #343942; }
  .row { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .status-dot { width: 8px; height: 8px; flex: 0 0 auto; margin-top: 5px; border-radius: 50%; background: #718096; }
  .row.awaiting_approval .status-dot { background: #f59e0b; }
  .row.executing .status-dot { background: #3b82f6; box-shadow: 0 0 0 4px rgba(59, 130, 246, .13); animation: pulse 1.2s ease-in-out infinite; }
  .row.succeeded .status-dot { background: #22c55e; }
  .row.failed .status-dot, .row.rejected .status-dot { background: #ef4444; }
  .row-content { min-width: 0; flex: 1; }
  .row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .tool-name { overflow: hidden; color: #f3f4f6; font: 600 12px/1.4 "SFMono-Regular", Consolas, monospace;
    text-overflow: ellipsis; white-space: nowrap; }
  .status { flex: 0 0 auto; color: #aeb5c2; font-size: 10px; }
  .purpose, .detail, .message { overflow: hidden; margin-top: 3px; text-overflow: ellipsis; white-space: nowrap; }
  .purpose { color: #c4c9d2; }
  .detail { color: #8fb9ff; font-family: "SFMono-Regular", Consolas, monospace; }
  .message { color: #fca5a5; }
  .footer { flex: 0 0 auto; padding: 8px 12px; color: #9fbfff; background: rgba(37, 99, 235, .1); font-size: 11px; }
  .footer.success { color: #86efac; background: rgba(21, 128, 61, .13); }
  .footer.warn { color: #fcd34d; background: rgba(180, 83, 9, .13); }
  .footer.error { color: #fca5a5; background: rgba(185, 28, 28, .13); }
  .history-view { min-height: 0; flex: 1 1 auto; display: flex; overflow: hidden; flex-direction: column; border-top: 1px solid #343942; }
  .current-turn { flex: 0 1 auto; padding: 8px 8px 4px; overflow: hidden; }
  .history-label { flex: 0 0 auto; padding: 7px 10px 5px; color: #858d9a; font-size: 10px; font-weight: 650; letter-spacing: .04em;
    text-transform: uppercase; }
  .history-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 0 8px 8px; }
  .history-empty { padding: 14px 8px; color: #858d9a; text-align: center; }
  .turn-card { overflow: hidden; border: 1px solid #343942; border-radius: 8px; background: rgba(255, 255, 255, .025); }
  .turn-card + .turn-card { margin-top: 6px; }
  .turn-card.current { border-color: #3b5278; background: rgba(37, 99, 235, .08); }
  .turn-summary { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; color: inherit;
    background: transparent; text-align: left; cursor: pointer; }
  .turn-summary:hover { background: rgba(255, 255, 255, .045); }
  .turn-summary .mark { width: 20px; height: 20px; font-size: 10px; }
  .turn-heading { min-width: 0; flex: 1; }
  .turn-name { color: #e5e7eb; font-size: 11px; font-weight: 650; }
  .turn-meta { overflow: hidden; margin-top: 1px; color: #9ca3af; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { flex: 0 0 auto; color: #7f8794; font-size: 14px; }
  .turn-details { border-top: 1px solid rgba(255, 255, 255, .07); }
  .turn-tool-list { max-height: min(150px, 22vh); overflow-y: auto; }
  .turn-details .row { padding: 8px 10px; }
  .turn-details .footer { padding: 6px 10px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
`;
