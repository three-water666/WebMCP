import type { SiteNetworkCaptureConfig } from "@webcode/shared";
import type { BufferedResultBatch, ToolRequestRegistry } from "./tool_request_registry";
import type { ToolCallTracker } from "./tool_call_tracker";
import type { ToolActivityTracker } from "./tool_activity";
import type { ToolExecutor } from "./tool_executor";
import { NetworkCaptureBridge } from "./network_capture_bridge";
import { NetworkToolCallController } from "./network_tool_calls";

interface NetworkCaptureRuntimeOptions {
  canDeliver: () => boolean;
  deliver: (batch: BufferedResultBatch) => void;
  isConnected: () => boolean;
  requestRegistry: ToolRequestRegistry;
  scheduleMainLoop: (delayMs: number) => void;
  toolActivityTracker: ToolActivityTracker;
  toolCallTracker: ToolCallTracker;
  toolExecutor: ToolExecutor;
}

export interface NetworkCaptureRuntime {
  configure: (capture: SiteNetworkCaptureConfig | null) => void;
  flushReadyTurn: () => void;
  hasPendingTurns: () => boolean;
  reset: () => void;
  shouldSuppressDomCapture: () => boolean;
}

export function createNetworkCaptureRuntime(options: NetworkCaptureRuntimeOptions): NetworkCaptureRuntime {
  const toolCalls = new NetworkToolCallController(options);
  const bridge = new NetworkCaptureBridge({
    onCompleted: (event) => options.isConnected() && toolCalls.ingest(event),
    onFallbackNeeded: () => options.scheduleMainLoop(1000),
  });
  const resetToolCalls = () => {
    toolCalls.reset();
    options.toolActivityTracker.reset();
  };

  return {
    configure: (capture) => {
      resetToolCalls();
      bridge.configure(capture);
    },
    flushReadyTurn: () => toolCalls.flushReadyTurn(),
    hasPendingTurns: () => toolCalls.hasPendingTurns(),
    reset: () => {
      resetToolCalls();
      bridge.configure(null);
    },
    shouldSuppressDomCapture: () => bridge.shouldSuppressDomCapture() || toolCalls.hasPendingTurns(),
  };
}
