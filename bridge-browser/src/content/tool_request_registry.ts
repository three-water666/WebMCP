import { type McpResponse, type ToolProtocolFormat } from "@webcode/shared";
import { i18n } from "../modules/i18n";
import { buildToolCallReminder, formatToolResultCodeBlock } from "../modules/toolProtocolFormatting";

/**
 * 当前页面扫描轮次中，仍需要等待或回填的一组 requestKey。
 *
 * 这里的 ids 已经排除了 flushedRequests 中的 ID，因此只代表“当前最新 AI 回复里还没写回过结果”
 * 的工具调用。completedCount/totalCount 用于主循环判断是否可以进行一次批量回填。
 */
export interface UnflushedRequestBatch {
  ids: string[];
  completedCount: number;
  totalCount: number;
  hasRequests: boolean;
  isComplete: boolean;
}

/**
 * 从 bufferedResults 中按页面顺序取出的待回填结果。
 *
 * hasOutput 表示至少有一段非空文本需要写回输入框；hasAnyResult 表示至少有 requestKey 已经
 * 产出结果，即使结果是空字符串也算。空字符串用于不需要回填正文但仍要推进生命周期的路径。
 */
export interface BufferedResultBatch {
  ids: string[];
  output: string;
  outputCount: number;
  hasOutput: boolean;
  hasAnyResult: boolean;
}

/**
 * 一次工具调用在 bridge 内部使用的稳定身份。
 *
 * requestId 是模型协议里的 request_id，会写回 MCP result。requestKey 是 bridge 自己生成的
 * 唯一生命周期键，用来避免模型复用 request_id 时把多个工具调用合并成同一个请求。
 */
export interface ToolRequestIdentity {
  requestId: string;
  requestKey: string;
}

type BufferedResult =
  | {
    content: string;
    kind: "raw";
  }
  | {
    content: string;
    isError: boolean;
    kind: "tool";
    requestId: string;
    systemNote?: string;
    toolName?: string;
  };

interface DuplicateResultContext {
  occurrence: number;
  total: number;
}

/**
 * 管理工具调用内部 requestKey 的完整生命周期。
 *
 * main.ts 每次扫描页面时只负责发现工具调用和推进 UI；这个 registry 负责记录 requestKey
 * 是否已经见过、是否还在执行、是否已有结果、是否已经回填过。这样主循环不用直接操作多个
 * Set/Map，也能避免重复执行工具或重复写回结果。
 */
export class ToolRequestRegistry {
  public constructor(private readonly options: {
    getToolProtocol: () => ToolProtocolFormat;
  } = { getToolProtocol: () => "json" }) {}

  /**
   * 所有已经进入执行路径的 requestKey。
   *
   * 用来区分“新发现的工具调用”和“之前扫描过的工具调用”。同一个代码块在流式输出或 DOM
   */
  private readonly seenRequests = new Set<string>();

  /**
   * 已经写回输入框或确认无需写回文本的 requestKey。
   *
   * 主循环每次都会重新扫描最新消息。写回过的 ID 放在这里，可以防止 deliverResult 触发 DOM
   * 变化后再次把同一份工具结果写进输入框。
   */
  private readonly flushedRequests = new Set<string>();

  /**
   * 已完成但尚未回填的工具结果。
   *
   * key 是 requestKey，value 是准备写回输入框的字符串。普通工具结果会包装成标准
   * ```json 代码块；初始化工具等特殊路径可以通过 saveRawResult 写入原始文本。
   */
  private readonly bufferedResults = new Map<string, BufferedResult>();

  /**
   * 正在执行或等待用户审批的 requestKey。
   *
   * 工具开始执行时加入，后台返回、用户拒绝、或客户端路径完成时移除。某个 requestKey 只有
   * 同时“不在 runningRequests 中”且“bufferedResults 中已有结果”，才算完成。
   */
  private readonly runningRequests = new Set<string>();

  /**
   * 已保存的工具结果计数。
   *
   * 每隔几个工具调用会附加一次协议格式提醒，帮助后续模型回复继续使用正确的工具调用格式。
   */
  private toolCallCount = 0;

  /**
   * 创建一次页面扫描轮次的临时收集器。
   *
   * ToolRequestTurn 只保存本次扫描看到的 requestKey 及其顺序；跨轮次状态仍由 registry 持有。
   */
  public createTurn(): ToolRequestTurn {
    return new ToolRequestTurn(this);
  }

  /**
   * 判断 requestKey 是否已经进入过执行路径。
   *
   * 返回 true 时，调用方应该只刷新视觉状态，不能再次执行工具。
   */
  public hasSeen(requestKey: string): boolean {
    return this.seenRequests.has(requestKey);
  }

  /**
   * 标记 requestKey 已进入执行状态。
   *
   * 这个方法同时写入 seenRequests 和 runningRequests：seenRequests 防止重复执行，
   * runningRequests 表示该工具还没产生可回填结果。
   */
  public markRunning(requestKey: string): void {
    this.seenRequests.add(requestKey);
    this.runningRequests.add(requestKey);
  }

  /**
   * 判断 requestKey 是否仍在执行或等待审批。
   *
   * 主循环用这个结果决定代码块显示“处理中”还是“已完成”的视觉状态。
   */
  public isRunning(requestKey: string): boolean {
    return this.runningRequests.has(requestKey);
  }

  /**
   * 标记 requestKey 的执行阶段已经结束。
   *
   * 结束不等于已经回填；调用方通常会随后调用 saveToolResult 或 saveRawResult 写入结果。
   */
  public markSettled(requestKey: string): void {
    this.runningRequests.delete(requestKey);
  }

  /**
   * 保存已经可以直接写回输入框的原始内容。
   *
   * 适用于初始化工具这类需要返回长提示正文的特殊路径，不再额外包一层 MCP result JSON。
   */
  public saveRawResult(requestKey: string, content: string): void {
    this.bufferedResults.set(requestKey, {
      content,
      kind: "raw",
    });
  }

  /**
   * 保存普通工具调用结果，并包装成模型可识别的 MCP result JSON 代码块。
   *
   * isError 为 true 时写入 error 字段，否则写入 output 字段。这里也负责周期性附加工具调用
   * 格式提醒，避免长对话中模型逐渐偏离协议。
   */
  public saveToolResult(
    requestKey: string,
    requestId: string,
    content: string,
    isError = false,
    toolName?: string
  ): void {
    this.toolCallCount++;
    let systemNote: string | undefined;
    if (this.toolCallCount > 0 && this.toolCallCount % 5 === 0) {
      systemNote = this.options.getToolProtocol() === "json" && i18n.resources.train
        ? i18n.resources.train
        : buildToolCallReminder(this.options.getToolProtocol(), i18n.lang);
    }

    this.bufferedResults.set(requestKey, {
      content,
      isError,
      kind: "tool",
      requestId,
      systemNote,
      toolName,
    });
  }

  /**
   * 清理此前为协议错误生成的反馈结果。
   *
   * 流式输出中，一个代码块可能先被判定为协议错误，随后又补全成有效工具调用。有效解析后要
   * 移除旧的错误反馈，避免同一个 requestKey 既执行工具又回填旧错误。
   */
  public clearProtocolFeedbackResult(requestKey: string): void {
    this.flushedRequests.delete(requestKey);
    this.bufferedResults.delete(requestKey);
  }

  /**
   * 从当前扫描轮次的 requestKey 中筛出尚未回填的一批。
   *
   * 返回值包含完成数量和总数。主循环只在 isComplete 为 true 时回填，确保同一轮出现的工具
   * 调用尽量合并成一次结果写入，而不是哪个先完成就先写哪个。
   */
  public getUnflushedBatch(requestKeys: readonly string[]): UnflushedRequestBatch {
    const ids = requestKeys.filter((key) => !this.flushedRequests.has(key));
    const completedCount = ids.filter((key) => this.isComplete(key)).length;

    return {
      ids,
      completedCount,
      totalCount: ids.length,
      hasRequests: ids.length > 0,
      isComplete: ids.length > 0 && completedCount === ids.length,
    };
  }

  /**
   * 按当前页面顺序组装一批已缓存结果。
   *
   * requestKeys 的顺序来自 ToolRequestTurn，因此和 AI 回复中工具调用出现的顺序一致。空字符串
   * 结果不会进入 output，但仍会让 hasAnyResult 为 true，供调用方标记对应请求已处理。
   */
  public buildBufferedResultBatch(requestKeys: readonly string[]): BufferedResultBatch {
    const orderedResults: string[] = [];
    let hasAnyResult = false;
    const toolRequestIdCounts = this.countToolRequestIds(requestKeys);
    const toolRequestIdOccurrences = new Map<string, number>();

    requestKeys.forEach((key) => {
      const bufferedResult = this.bufferedResults.get(key);
      if (!bufferedResult) {return;}
      hasAnyResult = true;

      const result = this.formatBufferedResult(
        bufferedResult,
        this.getDuplicateResultContext(bufferedResult, toolRequestIdCounts, toolRequestIdOccurrences)
      );
      if (result) {
        orderedResults.push(result);
      }
    });

    return {
      ids: [...requestKeys],
      output: orderedResults.join("\n\n"),
      outputCount: orderedResults.length,
      hasOutput: orderedResults.length > 0,
      hasAnyResult,
    };
  }

  /**
   * 标记一组 requestKey 已完成回填或无需回填。
   *
   * 这会删除对应缓存结果，并写入 flushedRequests。后续页面扫描再次看到这些 ID 时，主循环会
   * 跳过批处理，避免重复写回。
   */
  public markFlushed(requestKeys: readonly string[]): void {
    requestKeys.forEach((key) => {
      this.bufferedResults.delete(key);
      this.flushedRequests.add(key);
    });
  }

  /**
   * 判断某个 requestKey 是否已经具备回填条件。
   *
   * 完成条件必须同时满足：不再执行中，并且已经有结果缓存。这样可以区分“工具还在跑”和
   * “工具完成但结果为空字符串”的情况。
   */
  private isComplete(requestKey: string): boolean {
    return !this.runningRequests.has(requestKey) && this.bufferedResults.has(requestKey);
  }

  private countToolRequestIds(requestKeys: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    requestKeys.forEach((key) => {
      const bufferedResult = this.bufferedResults.get(key);
      if (bufferedResult?.kind !== "tool") {return;}
      counts.set(bufferedResult.requestId, (counts.get(bufferedResult.requestId) ?? 0) + 1);
    });
    return counts;
  }

  private getDuplicateResultContext(
    bufferedResult: BufferedResult,
    requestIdCounts: ReadonlyMap<string, number>,
    requestIdOccurrences: Map<string, number>
  ): DuplicateResultContext | undefined {
    if (bufferedResult.kind !== "tool") {return undefined;}

    const total = requestIdCounts.get(bufferedResult.requestId) ?? 0;
    if (total <= 1) {return undefined;}

    const occurrence = (requestIdOccurrences.get(bufferedResult.requestId) ?? 0) + 1;
    requestIdOccurrences.set(bufferedResult.requestId, occurrence);
    return {
      occurrence,
      total,
    };
  }

  private formatBufferedResult(
    bufferedResult: BufferedResult,
    duplicateContext?: DuplicateResultContext
  ): string {
    if (bufferedResult.kind === "raw") {
      return bufferedResult.content;
    }

    const content = duplicateContext
      ? addDuplicateRequestContext(bufferedResult.content, bufferedResult, duplicateContext)
      : bufferedResult.content;
    const responseJson: McpResponse = {
      mcp_action: "result",
      request_id: bufferedResult.requestId,
      status: bufferedResult.isError ? "error" : "success",
    };

    if (bufferedResult.isError) {
      responseJson.error = content;
    } else {
      responseJson.output = content;
    }
    if (bufferedResult.systemNote) {
      responseJson.system_note = bufferedResult.systemNote;
    }

    return formatToolResultCodeBlock(responseJson, this.options.getToolProtocol());
  }
}

/**
 * 一次 runMainLoop 扫描过程中的 requestKey 收集器。
 *
 * 它只保存本轮扫描看到的 ID，并保持页面出现顺序。生命周期很短，每次 runMainLoop 都会创建
 * 新实例；跨轮次的执行/回填状态由 ToolRequestRegistry 管理。
 */
export class ToolRequestTurn {
  /**
   * 当前扫描轮次内按页面顺序出现的 requestKey。
   *
   * 后续回填会按这个顺序合并结果，保证多工具调用结果顺序和 AI 原始请求顺序一致。
   */
  private readonly requestKeys: string[] = [];

  /**
   * 当前扫描轮次内的去重集合。
   *
   * 同一个 requestKey 可能因为重复代码块、协议错误反馈或 DOM 结构变化被看到多次；Set 用来
   * 保证 requestKeys 中只出现一次。
   */
  private readonly requestKeySet = new Set<string>();

  public constructor(private readonly registry: ToolRequestRegistry) {}

  /**
   * 记录本轮扫描看到的一个 requestKey。
   *
   * null 表示调用方明确没有要纳入本轮批处理的 requestKey；这种情况直接忽略。
   */
  public add(requestKey: string | null): void {
    if (!requestKey || this.requestKeySet.has(requestKey)) {return;}

    this.requestKeys.push(requestKey);
    this.requestKeySet.add(requestKey);
  }

  /**
   * 基于本轮扫描到的 ID，查询还没有回填的一批 request。
   *
   * 具体的已回填过滤和完成状态计算交给 registry，这个对象只提供本轮 ID 的有序列表。
   */
  public getUnflushedBatch(): UnflushedRequestBatch {
    return this.registry.getUnflushedBatch(this.requestKeys);
  }
}

function addDuplicateRequestContext(
  content: string,
  bufferedResult: Extract<BufferedResult, { kind: "tool" }>,
  duplicateContext: DuplicateResultContext
): string {
  const toolLabel = bufferedResult.toolName ? ` for tool "${bufferedResult.toolName}"` : "";
  const prefix = [
    `webcode note: duplicate request_id "${bufferedResult.requestId}" result`,
    `${duplicateContext.occurrence}/${duplicateContext.total}${toolLabel}.`,
  ].join(" ");

  return content ? `${prefix}\n\n${content}` : prefix;
}
