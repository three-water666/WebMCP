export const FOLLOW_UP_COMPOSER_STYLE_TEXT = `
  .follow-up-section { min-height: 0; display: flex; overflow: hidden; flex: 0 1 auto; flex-direction: column;
    border-top: 1px solid #343942; }
  .follow-up-header { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 7px 11px 7px 12px; background: rgba(255, 255, 255, .025); }
  .follow-up-heading { min-width: 0; flex: 1; }
  .follow-up-title { overflow: hidden; color: #f9fafb; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .follow-up-summary { overflow: hidden; margin-top: 1px; color: #aeb5c2; font-size: 10px;
    text-overflow: ellipsis; white-space: nowrap; }
  .follow-up-count { min-width: 20px; height: 20px; align-items: center; justify-content: center; flex: 0 0 auto;
    padding: 0 6px; color: #bfdbfe; background: rgba(37, 99, 235, .2); border: 1px solid rgba(96, 165, 250, .28);
    border-radius: 999px; font-size: 10px; }
  .follow-up-queue { min-height: 0; max-height: min(150px, 22vh); flex: 1 1 auto; overflow-y: auto; }
  .follow-up-queue:empty { display: none; }
  .follow-up-item { min-height: 39px; display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .follow-up-item-text { min-width: 0; flex: 1; overflow-wrap: anywhere; color: #d8dde6; white-space: pre-wrap; }
  .follow-up-item.sending .follow-up-item-text { color: #93c5fd; }
  .follow-up-item-actions { min-height: 24px; display: flex; align-items: center; justify-content: flex-end; gap: 5px;
    flex: 0 0 auto; }
  .follow-up-item-state { display: inline-flex; align-items: center; height: 22px; flex: 0 0 auto; color: #93c5fd;
    font-size: 10px; line-height: 1; white-space: nowrap; }
  .follow-up-item-state.waiting { color: #aeb5c2; }
  .follow-up-remove { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; padding: 0; border: 0; border-radius: 5px; color: #aeb5c2; background: transparent;
    font-size: 16px; line-height: 1; cursor: pointer; }
  .follow-up-remove:hover { color: #fff; background: #8f1d1d; }
  .follow-up-composer { flex: 0 0 auto; padding: 10px; }
  .follow-up-composer textarea { width: 100%; min-height: 68px; max-height: min(160px, 22vh); resize: vertical; display: block;
    padding: 8px 9px; color: #f3f4f6; background: #111318; border: 1px solid #454b56; border-radius: 7px;
    line-height: 1.45; outline: none; }
  .follow-up-composer textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, .16); }
  .follow-up-composer textarea::placeholder { color: #747d8b; }
  .follow-up-composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
  .follow-up-hint { color: #858d9a; font-size: 10px; }
  .follow-up-confirm { flex: 0 0 auto; padding: 5px 10px; border: 1px solid #3b82f6; border-radius: 6px;
    color: #fff; background: #2563eb; cursor: pointer; }
  .follow-up-confirm:hover { background: #1d4ed8; }
  .follow-up-confirm:disabled { color: #7d8490; background: #292d34; border-color: #3b4048; cursor: default; }
`;
