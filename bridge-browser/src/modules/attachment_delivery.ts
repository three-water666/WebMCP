import type {
  ToolResultAttachment,
  ToolResultAttachmentFailure,
  ToolResultAttachmentGroup,
} from "./tool_result";

export interface PreparedAttachmentGroup {
  files: File[];
  group: ToolResultAttachmentGroup;
}

export interface PreparedAttachmentGroups {
  failures: ToolResultAttachmentFailure[];
  preparedGroups: PreparedAttachmentGroup[];
}

export function prepareAttachmentGroups(
  groups: readonly ToolResultAttachmentGroup[]
): PreparedAttachmentGroups {
  const failures: ToolResultAttachmentFailure[] = [];
  const preparedGroups: PreparedAttachmentGroup[] = [];
  groups.forEach((group) => {
    try {
      preparedGroups.push({
        files: group.attachments.map(createAttachmentFile),
        group,
      });
    } catch (error) {
      failures.push(toAttachmentFailure(group, buildAttachmentFailureReason(
        group,
        `WebCode could not prepare the attachment: ${getErrorMessage(error)}.`
      )));
    }
  });
  return { failures, preparedGroups };
}

export function createTextAttachmentFile(text: string, filenamePrefix: string): File {
  const filename = `${filenamePrefix}-${Date.now()}.txt`;
  return new File([text], filename, { type: "text/plain" });
}

export function isPasteEventAcknowledged(notCanceled: boolean, defaultPrevented: boolean): boolean {
  return defaultPrevented || !notCanceled;
}

export function toAttachmentFailure(
  group: ToolResultAttachmentGroup,
  reason: string
): ToolResultAttachmentFailure {
  return {
    outputIndex: group.outputIndex,
    reason,
    requestId: group.requestId,
  };
}

export function buildAttachmentFailureReason(
  group: ToolResultAttachmentGroup,
  detail: string
): string {
  const toolName = group.toolName ?? "The attachment-producing tool";
  const attachments = group.attachments
    .map((attachment) => `"${attachment.name}" (${attachment.mimeType})`)
    .join(", ");
  return `${toolName} completed locally, but browser attachment delivery could not be confirmed for ` +
    `${attachments}: ${detail} Do not assume the attachment is available in this conversation.`;
}

function createAttachmentFile(attachment: ToolResultAttachment): File {
  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength !== attachment.size) {
    throw new Error(`Decoded attachment size mismatch for ${attachment.name}.`);
  }
  return new File([bytes], attachment.name, { type: attachment.mimeType });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
