import { t } from "../modules/i18n";
import { Logger } from "../modules/logger";
import * as UI from "../modules/ui";
import { type SiteSelectors } from "../modules/config";
import { looksLikeToolCall, parseToolCall } from "../modules/toolCallProtocol";
import { BRANDING, PROTOCOL } from "@webcode/shared";
import {
  getSiteNetworkCaptureConfig, getSyncedAiSites, isMessageRequest, isSiteSelectors, isStatusResponse,
  type StatusUpdateMessageRequest, type SyncedAiSite,
} from "../types";
import { AutoInitPromptController } from "./auto_init_prompt";
import { createApprovalState, parseStoredApprovalEntries, type ApprovalState } from "./approval_policy";
import { DomToolActivityController } from "./dom_tool_activity";
import { DomToolTurnController } from "./dom_tool_turn";
import { FollowUpQueue } from "./follow_up_queue";
import { FollowUpWorkController, OBSERVED_PAGE_WORK_ATTRIBUTES } from "./follow_up_work_controller";
import { hasPromptResourceChange, loadPromptsFromStorage } from "./prompt_resources";
import { createNetworkCaptureRuntime } from "./network_capture_runtime";
import { ResultDeliveryController } from "./result_delivery_controller";
import { getCurrentStatus, getStorage } from "./runtime_helpers";
import { logToolSummary, ToolCallTracker } from "./tool_call_tracker";
import { ToolActivityTracker } from "./tool_activity";
import { ToolActivityOverlay } from "./tool_activity_overlay";
import { ToolExecutor } from "./tool_executor";
import { ToolRequestRegistry } from "./tool_request_registry";
import { logVirtualizedHistorySkip } from "./virtualized_history_skip";

// === 配置与状态 ===
const CONFIG = { pollInterval: 1000, autoSend: true, autoApproveTools: false };

// [State] Connection Guard
let isClientConnected = false;
let currentWorkspaceId = "global";

let approvalState: ApprovalState = createApprovalState();

function loadWorkspaceData(workspaceId: string): Promise<void> {
  return new Promise((resolve) => {
    const storageKey = `allowed_tools_${workspaceId}`;
    chrome.storage.local.get([storageKey], (localItems: Record<string, unknown>) => {
      approvalState = parseStoredApprovalEntries(localItems[storageKey]);
      resolve();
    });
  });
}

// Initially load prompts from local storage in case we are already connected
void loadPromptsFromStorage();
// Load default workspace data
void loadWorkspaceData(currentWorkspaceId);

type RuntimeSendResponse = (response?: unknown) => void;

// === DOM 选择器与配置 ===
let DOM: SiteSelectors | null = null;
let currentSiteName: string | null = null;
let currentSiteId: string | null = null;

// 监听消息 (日志开关 & 状态同步)
chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse): boolean | void => (
  handleRuntimeMessage(request, sendResponse)
));

function handleRuntimeMessage(request: unknown, sendResponse: RuntimeSendResponse): boolean | void {
  if (!isMessageRequest(request)) {return;}

  if (request.type === "MANUAL_INIT") {
    void handleManualInitRequest(sendResponse);
    return true;
  }

  if (request.type === "TOGGLE_LOG") {
    const show = request.show === true;
    Logger.toggle(show);
    Logger.log("Logger Visible: " + show, "info");
  }
  if (request.type === "SET_AUTO_SEND") {
    CONFIG.autoSend = request.autoSend !== false;
    if (!CONFIG.autoSend) {
      UI.cancelAutoSend();
    }
    Logger.log(`Auto Send: ${CONFIG.autoSend}`, "info");
  }
  if (request.type === "SET_AUTO_APPROVE_TOOLS") {
    CONFIG.autoApproveTools = request.autoApproveTools === true;
    Logger.log(`Auto-Approve Tools: ${CONFIG.autoApproveTools}`, "info");
  }
  if (request.type === "STATUS_UPDATE") {
    handleStatusUpdate(request);
  }
}

function handleStatusUpdate(request: StatusUpdateMessageRequest): void {
  const wasConnected = isClientConnected;
  const wasWorkspaceId = currentWorkspaceId;
  const wasSiteId = currentSiteId;

  applyStatusUpdateFields(request);

  if (!isClientConnected) {
    resetCurrentSite();
  }

  if (isClientConnected !== wasConnected) {
    Logger.log(`[MCP] Connection Status: ${isClientConnected ? "Connected" : "Disconnected"}`, "info");
  }

  if (isClientConnected && currentSiteId !== wasSiteId) {
    initDOMConfig();
  }

  if (isClientConnected && (isClientConnected !== wasConnected || currentWorkspaceId !== wasWorkspaceId)) {
    void refreshConnectedState();
  }
}

function applyStatusUpdateFields(request: StatusUpdateMessageRequest): void {
  isClientConnected = request.connected === true;
  if (typeof request.workspaceId === "string") {currentWorkspaceId = request.workspaceId;}
  if (typeof request.siteId === "string") {currentSiteId = request.siteId;}
  if (typeof request.autoSend === "boolean") {CONFIG.autoSend = request.autoSend;}
  if (typeof request.autoApproveTools === "boolean") {CONFIG.autoApproveTools = request.autoApproveTools;}
}

async function refreshConnectedState(): Promise<void> {
  // 连接状态或工作区发生变化时，页面 DOM 不一定会同步变化，因此不能只依赖 MutationObserver。
  // 这里先刷新当前工作区的放行规则和提示词资源，再主动触发自动初始化检查和主循环扫描。
  // runMainLoop 直接执行一次，可以立刻捕获页面上已经存在、但在连接前还不能执行的工具调用。
  await loadWorkspaceData(currentWorkspaceId);
  await loadPromptsFromStorage();
  autoInitPrompt.scheduleCheck();
  if (DOM) {
    followUpWork.observe(DOM);
  }
  runMainLoop();
}

async function handleManualInitRequest(sendResponse: RuntimeSendResponse): Promise<void> {
  try {
    sendResponse(await autoInitPrompt.appendManualInitPrompt());
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const autoInitPrompt = new AutoInitPromptController({
  getSelectors: () => DOM,
  getSiteId: () => currentSiteId,
  isClientConnected: () => isClientConnected,
  loadPromptsFromStorage,
});

function initDOMConfig(): void {
  void loadDOMConfig();
}

async function loadDOMConfig(): Promise<void> {
  const status = await getCurrentStatus();
  CONFIG.autoSend = status?.autoSend !== false;
  CONFIG.autoApproveTools = status?.autoApproveTools === true;

  if (!status?.connected || typeof status.siteId !== "string") {
    resetCurrentSite();
    console.log(`${BRANDING.productName}: Current tab is not connected to a configured site. Idle.`);
    return;
  }

  isClientConnected = true;
  currentSiteId = status.siteId;
  if (typeof status.workspaceId === "string") {
    currentWorkspaceId = status.workspaceId;
  }

  const localItems = await getStorage(chrome.storage.local, ["syncedAiSites"]);
  const sites = getSyncedAiSites(localItems.syncedAiSites);
  applySyncedSiteConfig(status.siteId, sites);
}

function applySyncedSiteConfig(siteId: string, sites: SyncedAiSite[]): void {
  const matchedSite = sites.find((site) => site.id === siteId);

  if (matchedSite && isSiteSelectors(matchedSite.selectors)) {
    DOM = matchedSite.selectors;
    currentSiteName = matchedSite.name ?? matchedSite.id;
    domToolActivity.reset();
    domToolTurns.reset();
    networkCapture.configure(getSiteNetworkCaptureConfig(matchedSite.capture));
    followUpWork.reset();
    autoInitPrompt.setupTrigger();
    void loadPromptsFromStorage();
    autoInitPrompt.scheduleCheck();
    startObserver();
    followUpWork.observe(DOM);
    return;
  }

  DOM = null;
  currentSiteName = null;
  domToolActivity.reset();
  domToolTurns.reset();
  networkCapture.reset();
  followUpWork.reset();
  console.log(`${BRANDING.productName}: Site '${siteId}' is not configured in VS Code. Idle.`);
}

function resetCurrentSite(): void {
  domToolActivity.reset();
  domToolTurns.reset();
  networkCapture.reset();
  followUpWork.reset();
  DOM = null;
  currentSiteName = null;
  currentSiteId = null;
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    const approvalStorageKey = `allowed_tools_${currentWorkspaceId}`;
    if (changes[approvalStorageKey]) {
      approvalState = parseStoredApprovalEntries(changes[approvalStorageKey].newValue as unknown);
      Logger.log(`Allowed tools updated (Workspace: ${currentWorkspaceId})`, "action");
    }
    if (changes.syncedAiSites) {
      initDOMConfig();
      Logger.log(t("config_updated"), "action");
    }
    if (hasPromptResourceChange(changes, currentSiteId)) {
      void loadPromptsFromStorage().then(() => {
        autoInitPrompt.scheduleCheck();
      });
    }
  }
});

// === 主循环逻辑 ===

// 统一管理工具调用内部 requestKey 的生命周期：已发现、执行中、结果缓存、已回填，以及当前轮次去重。
const requestRegistry = new ToolRequestRegistry();
const toolActivityTracker = new ToolActivityTracker();
const domToolActivity = new DomToolActivityController(toolActivityTracker);
const domToolTurns = new DomToolTurnController(requestRegistry);
const followUpQueue = new FollowUpQueue();
const workPanel = new ToolActivityOverlay(toolActivityTracker, followUpQueue);
let lastProgressLogTime = 0, lastProgressStatus = "";

// === 性能优化: MutationObserver 取代 setInterval ===
// 主循环调度锁。DOM 变化、工具完成、协议错误稳定性检查都可能频繁触发 runMainLoop；
// 这个标记确保同一时间只挂起一个延迟检查，避免页面流式输出时排出大量重复 setTimeout。
let isCheckScheduled = false;

const toolCallTracker = new ToolCallTracker({
  requestRegistry,
  scheduleMainLoop,
});

const toolExecutor = new ToolExecutor({
  getSelectors: () => DOM,
  getSiteId: () => currentSiteId,
  getWorkspaceId: () => currentWorkspaceId,
  getApprovalState: () => approvalState,
  getAutoApproveTools: () => CONFIG.autoApproveTools,
  onActivityStatusChange: (identity, status, message) => {
    toolActivityTracker.updateStatus(identity, status, message);
  },
  requestRegistry,
  scheduleMainLoop,
});

const networkCapture = createNetworkCaptureRuntime({
  canDeliver: () => Boolean(DOM && !UI.isStopButtonVisible(DOM)),
  deliver: (batch) => {
    if (DOM) {
      resultDelivery.deliver(batch, DOM);
    }
  },
  isConnected: () => isClientConnected,
  requestRegistry,
  scheduleMainLoop,
  toolActivityTracker,
  toolCallTracker,
  toolExecutor,
});

const resultDelivery = new ResultDeliveryController({
  followUpQueue,
  getAutoSend: () => CONFIG.autoSend,
  hasPendingTurns: () => networkCapture.hasPendingTurns(),
  onBatchFinalized: (requestKeys) => domToolTurns.finalizeRequests(requestKeys),
  requestRegistry,
  scheduleMainLoop,
  toolActivityTracker,
});

const followUpWork = new FollowUpWorkController(workPanel, () => {
  if (DOM && !networkCapture.hasPendingTurns()) {
    resultDelivery.deliverFollowUps(DOM);
  }
});

/**
 * 延迟调度一次主循环扫描。
 *
 * 这个函数是所有异步入口重新进入 runMainLoop 的统一入口，包括 DOM 变化、工具执行完成、
 * 协议错误等待稳定、以及 AI 还在输出时的延迟重试。isCheckScheduled 会把同一时间窗口内的
 * 多次触发合并成一次 setTimeout，避免流式输出时每个字符变化都排队一次完整扫描。
 *
 * delayMs 表示调用方认为页面或工具状态还需要多久才可能稳定。进入 runMainLoop 后会释放
 * 调度锁；如果本轮扫描发现还需要继续等待，会再次通过 scheduleMainLoop 安排下一轮。
 */
function scheduleMainLoop(delayMs: number): void {
  if (isCheckScheduled) {return;}
  isCheckScheduled = true;
  setTimeout(runMainLoop, delayMs);
}

/**
 * 扫描当前页面最新一轮 AI 回复中的工具调用，并在本轮工具都结束后把结果回填给输入框。
 *
 * 这个循环可能由页面 DOM 变化、工具执行完成、协议错误稳定性检查等多个入口触发。它只处理
 * 最新的一条 AI 消息，避免历史消息反复触发工具；每个工具调用再用内部 requestKey 做去重、执行
 * 状态跟踪和结果回填标记。
 *
 * 整体流程：
 * 1. 找到最新 AI 消息里的候选代码块。
 * 2. 解析工具调用协议，并根据当前消息作用域生成模型不可见的内部 requestKey。
 * 3. 新调用进入执行路径，已知调用只刷新视觉状态。
 * 4. 当前轮次所有工具都有结果后，按页面顺序合并结果并写回输入框。
 * 5. 如果 AI 还在输出、工具还没完成、或 JSON 还没稳定，则安排下一次检查。
 */
// eslint-disable-next-line max-lines-per-function, complexity
function runMainLoop() {

  // 进入实际扫描后释放调度锁；本轮扫描期间如果还需要等待，会重新调用 scheduleMainLoop。
  isCheckScheduled = false;
  if (!DOM || !isClientConnected) { return; }

  networkCapture.flushReadyTurn();
  if (networkCapture.shouldSuppressDomCapture()) { return; }

  // UI 层统一按 VS Code 下发的选择器定位最新响应块和其中的 JSON 代码块。
  const latestCodeBlocks = UI.getLatestResponseCodeBlocks(DOM);
  if (!latestCodeBlocks) { return; }

  const { messageIndex, messageElement, codeElements } = latestCodeBlocks;
  const messageLocation = { conversationKey: location.href, messageIndex };
  const viewingVirtualizedHistory = UI.isLikelyViewingVirtualizedHistory(DOM);
  const isActiveDomTurn = domToolTurns.observeMessage(messageElement, messageLocation, viewingVirtualizedHistory);

  for (const [codeBlockIndex, codeEl] of codeElements.entries()) {
    const codeElement = codeEl as HTMLElement;
    const textContent = (codeElement.textContent ?? "").trim();
    if (!looksLikeToolCall(textContent)) { continue; }

    try {
      // parseToolCall 会做协议校验；解析失败的代码块会走 catch 中的稳定性和错误反馈流程。
      const payload = parseToolCall(textContent);

      // 同一个代码块可能先是不完整 JSON，后续流式输出补全；成功解析后清掉旧错误样式。
      if (codeElement.dataset.mcpState === "error") {
        UI.clearVisualState(codeElement);
      }

      // requestKey 按会话位置和代码块生成，DOM 节点整体替换时保持稳定，新会话也不会碰撞。
      const requestIdentity = toolCallTracker.ensurePayloadRequestIdentity(
        payload,
        codeElement,
        messageLocation,
        codeBlockIndex
      );
      toolCallTracker.clearProtocolErrorFeedbackState(requestIdentity.requestKey);

      const isProcessing = requestRegistry.isRunning(requestIdentity.requestKey);
      const isKnown = requestRegistry.hasSeen(requestIdentity.requestKey);

      if (!isKnown && !isActiveDomTurn) {
        if (viewingVirtualizedHistory) {logVirtualizedHistorySkip(payload.name);}
        continue;
      }
      if (isActiveDomTurn) {domToolTurns.recordRequest(codeBlockIndex, requestIdentity.requestKey);}

      if (!isKnown) {
        // 新发现的工具调用只进入执行路径一次，后续扫描只会根据 registry 中的执行状态刷新视觉状态。
        requestRegistry.markRunning(requestIdentity.requestKey);
        domToolActivity.capture({
          identity: requestIdentity,
          messageElement,
          payload,
        });

        // 页面上出现新工具调用时，先取消已有自动发送，避免还没写回工具结果就把输入框发出去。
        UI.cancelAutoSend();

        // 立即标记为处理中，让用户能看到该代码块已经被捕获并进入执行队列。
        UI.markVisualProcessing(codeElement);

        Logger.log(`${t("captured")}: ${payload.name}`, "info");
        logToolSummary(payload);
        toolExecutor.execute(payload, requestIdentity);
      } else {
        // 已知调用不重复执行，只根据 registry 判断它还在处理中还是已经完成。
        if (isProcessing) {
          UI.markVisualProcessing(codeElement);
        } else {
          UI.markVisualSuccess(codeElement);
        }
      }
    } catch (error) {
      if (!isActiveDomTurn) {
        if (viewingVirtualizedHistory) {logVirtualizedHistorySkip();}
        continue;
      }

      // 流式输出中 JSON 可能暂时不完整。tracker 会先等待文本稳定，确认失败后才回填协议错误。
      const requestIdentity = toolCallTracker.handleProtocolErrorBlock(
        codeElement,
        textContent,
        messageLocation,
        codeBlockIndex,
        error
      );
      domToolTurns.recordRequest(codeBlockIndex, requestIdentity.requestKey);
    }
  }

  // 只处理当前轮次里还没有写回过的请求。已 flush 的 requestKey 不会再次写入输入框。
  const unflushedBatch = domToolTurns.getUnflushedBatch();

  if (unflushedBatch.hasRequests) {
    // 工具完成的判定由 registry 统一计算：已不在执行中，并且已经有结果可回填。
    const completedCount = unflushedBatch.completedCount;
    const totalCount = unflushedBatch.totalCount;

    // 只有本轮所有待回填工具都完成后，才合并结果；否则继续等待，避免分批打断 AI 上下文。
    if (unflushedBatch.isComplete) {
      // 如果页面仍有 Stop 按钮，说明 AI 还在生成回复。推迟回填，避免和模型输出竞争输入区。
      if (UI.isStopButtonVisible(DOM)) {
        // AI 停止生成时不一定有 DOM 变化可监听，所以这里主动安排一次延迟检查。
        scheduleMainLoop(1000);
        return;
      }

      // 按当前页面顺序收集结果，保证多工具调用的回填顺序和 AI 原始请求顺序一致。
      const resultBatch = requestRegistry.buildBufferedResultBatch(unflushedBatch.ids);

      if ((resultBatch.hasOutput || resultBatch.attachmentGroups.length > 0) && DOM) {
        const selectors = DOM;
        Logger.log(
          `Batch finished: ${resultBatch.outputCount} tools. Writing...`,
          "success"
        );
        resultDelivery.deliver(resultBatch, selectors);
      } else {
        // 某些路径可能没有文本输出；它们完成后也要标记为已处理。
        if (resultBatch.hasAnyResult) {
          requestRegistry.markFlushed(resultBatch.ids);
          domToolTurns.finalizeRequests(resultBatch.ids);
          toolActivityTracker.updateDelivery(resultBatch.ids, "delivered");
        }
      }
      lastProgressStatus = "";
    } else {
      // 还有工具在执行或等待审批时，仅在进度变化或间隔超过阈值时写日志，避免刷屏。
      const statusStr = `${completedCount}/${totalCount}`;
      const now = Date.now();
      if (
        statusStr !== lastProgressStatus ||
        now - lastProgressLogTime > 3000
      ) {
        Logger.log(`${t("waiting_tools")} (${statusStr})`, "warn");
        lastProgressStatus = statusStr;
        lastProgressLogTime = now;
      }
    }
  }
}

/**
 * 监听页面内容变化，并把高频 DOM 更新合并成一次延迟主循环扫描。
 *
 * AI 输出通常是流式写入页面的，MutationObserver 可能在很短时间内被触发很多次。这里不直接
 * 调用 runMainLoop，而是通过 scheduleMainLoop 按 CONFIG.pollInterval 节流，让工具解析在
 * 文本相对稳定后再发生，也避免重复解析同一批代码块。
 *
 * 很多站点通过 class/style/aria-* 切换发送和停止按钮的可见性，不一定增删 DOM 节点。因此也
 * 监听常见状态属性变化，让 CompletionNotifier 有机会重新执行可见性判断。
 */
const observer = new MutationObserver(() => {
  if (!isClientConnected) { return; }

  if (DOM) {
    followUpWork.observe(DOM);
  }

  // DOM 变化只说明页面可能出现了新内容；延迟扫描能等待流式文本继续补全。
  scheduleMainLoop(CONFIG.pollInterval);
});

/**
 * 启动页面观察，并在首次确认 VS Code 网关已连接后主动运行一次主循环。
 *
 * 观察者只负责之后的 DOM 变化；如果 content script 注入时页面上已经有工具调用，或者连接
 * 状态是在注入后才返回的，页面可能不会再产生新的 DOM 事件。因此 GET_STATUS 成功后需要
 * 立即刷新工作区数据、加载提示资源，并直接调用 runMainLoop 做一次首轮扫描。
 */
function startObserver() {
  if (!currentSiteName || !DOM) {return;}
  // Initialize observer only once
  const observerWindow = window as unknown as Record<string, boolean | undefined>;
  if (observerWindow[PROTOCOL.observerStartedFlag]) {return;}
  observerWindow[PROTOCOL.observerStartedFlag] = true;

  // 1. Start observing immediately (but logic inside is guarded by isClientConnected)
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: OBSERVED_PAGE_WORK_ATTRIBUTES,
    childList: true,
    subtree: true,
    characterData: true
  });

  // 2. Check initial status
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, async (response: unknown) => {
    if (isStatusResponse(response) && response.connected) {
      isClientConnected = true;
      if (typeof response.workspaceId === "string") {
        currentWorkspaceId = response.workspaceId;
        await loadWorkspaceData(currentWorkspaceId);
      }
      await loadPromptsFromStorage();
      Logger.log(`${BRANDING.productName} activated for ${currentSiteName} (Connected)`, "info");
      // 连接恢复后先检查自动初始化触发词，再立刻扫描现有消息，避免等待下一次页面变化。
      autoInitPrompt.scheduleCheck();
      if (DOM) {
        followUpWork.observe(DOM);
      }
      runMainLoop();
    } else {
      isClientConnected = false;
      console.log(`${BRANDING.productName} loaded for ${currentSiteName} (Disconnected - Idle)`);
      // Optional: Inform user that connection is missing
    }
  });
}

initDOMConfig();
