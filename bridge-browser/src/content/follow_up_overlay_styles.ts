import { FOLLOW_UP_OVERLAY_Z_INDEX } from "../modules/overlay_layers";

export const FOLLOW_UP_OVERLAY_STYLE_TEXT = `
  :host { position: fixed; left: 20px; bottom: 20px; z-index: ${FOLLOW_UP_OVERLAY_Z_INDEX};
    width: fit-content; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); color-scheme: dark; }
  :host(.webcode-follow-up-expanded) { width: min(360px, calc(100vw - 32px)); }
  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  .launcher { min-height: 42px; display: flex; align-items: center; gap: 8px; padding: 7px 11px 7px 8px;
    color: #f3f4f6; background: rgba(20, 22, 26, .96); border: 1px solid #3b404a; border-radius: 11px;
    box-shadow: 0 9px 26px rgba(0, 0, 0, .34); cursor: grab; backdrop-filter: blur(10px); }
  .launcher:hover { background: rgba(31, 35, 42, .98); border-color: #596171; }
  .launcher:active { cursor: grabbing; }
  .launcher:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
  .launcher-mark { width: 25px; height: 25px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; color: #dbeafe; background: #2563eb; border-radius: 7px; font-size: 19px; line-height: 1; }
  .launcher-label { font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; }
  .launcher-count { min-width: 18px; height: 18px; align-items: center; justify-content: center; padding: 0 5px;
    color: #bfdbfe; background: rgba(37, 99, 235, .2); border: 1px solid rgba(96, 165, 250, .28);
    border-radius: 999px; font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .panel { width: 100%; max-height: inherit; display: none; overflow: hidden; flex-direction: column;
    color: #f3f4f6; background: rgba(20, 22, 26, .96);
    border: 1px solid #3b404a; border-radius: 12px; box-shadow: 0 12px 34px rgba(0, 0, 0, .38);
    font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; backdrop-filter: blur(10px); }
  :host(.webcode-follow-up-expanded) .launcher { display: none; }
  :host(.webcode-follow-up-expanded) .panel { display: flex; }
  .header { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 10px 8px 12px; cursor: move; user-select: none; }
  .heading { min-width: 0; flex: 1; }
  .title { overflow: hidden; color: #f9fafb; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .summary { overflow: hidden; margin-top: 1px; color: #aeb5c2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .count { flex: 0 0 auto; padding: 2px 7px; color: #bfdbfe; background: rgba(37, 99, 235, .2);
    border: 1px solid rgba(96, 165, 250, .28); border-radius: 999px; font-size: 10px; }
  .collapse { width: 26px; height: 26px; flex: 0 0 auto; padding: 0; color: #aeb5c2; background: transparent;
    border: 0; border-radius: 6px; font-size: 18px; line-height: 1; cursor: pointer; }
  .collapse:hover { color: #fff; background: #343942; }
  .body { min-height: 0; display: flex; flex-direction: column; border-top: 1px solid #343942; }
  .queue { min-height: 0; max-height: min(190px, 28vh); flex: 1 1 auto; overflow-y: auto; }
  .queue:empty { display: none; }
  .item { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .item-text { min-width: 0; flex: 1; overflow-wrap: anywhere; color: #d8dde6; white-space: pre-wrap; }
  .item.sending .item-text { color: #93c5fd; }
  .item-actions { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; }
  .item-state { flex: 0 0 auto; color: #93c5fd; font-size: 10px; white-space: nowrap; }
  .item-state.waiting { color: #aeb5c2; }
  .remove { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; padding: 0; border: 0; border-radius: 5px; color: #aeb5c2; background: transparent;
    font-size: 16px; line-height: 1; cursor: pointer; }
  .remove:hover { color: #fff; background: #8f1d1d; }
  .composer { flex: 0 0 auto; padding: 10px; }
  textarea { width: 100%; min-height: 74px; max-height: min(180px, 24vh); resize: vertical; display: block;
    padding: 8px 9px; color: #f3f4f6; background: #111318; border: 1px solid #454b56; border-radius: 7px;
    line-height: 1.45; outline: none; }
  textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, .16); }
  textarea::placeholder { color: #747d8b; }
  .composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
  .hint { color: #858d9a; font-size: 10px; }
  .confirm { flex: 0 0 auto; padding: 5px 10px; border: 1px solid #3b82f6; border-radius: 6px;
    color: #fff; background: #2563eb; cursor: pointer; }
  .confirm:hover { background: #1d4ed8; }
  .confirm:disabled { color: #7d8490; background: #292d34; border-color: #3b4048; cursor: default; }
`;
