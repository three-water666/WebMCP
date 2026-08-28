import { type SiteSelectors } from "./config";
import { isElementVisible } from "./dom_helpers";

export interface LatestResponseCodeBlocks {
  messageIndex: number;
  messageElement: Element;
  codeElements: Element[];
}

interface ScrollMetrics {
  distanceToBottom: number;
  range: number;
  thumbRatio: number;
}

// History detection relies on large scroll range, small scrollbar thumb, and absolute distance from the live bottom.
// Scroll percentage is intentionally avoided: long virtualized chats can be past 80% while still far from the bottom.
const HISTORY_SCROLL_MIN_RANGE_PX = 800;
const HISTORY_SCROLL_MIN_DISTANCE_TO_BOTTOM_PX = 600;
const HISTORY_SCROLL_MAX_THUMB_RATIO = 0.65;
const MIN_SCROLL_CONTAINER_HEIGHT_PX = 300;

export function getInputAreaBySelector(
  inputSelector: string
): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(inputSelector));
  if (candidates.length === 0) {return null;}

  return candidates.find((candidate) => isActiveInput(candidate))
    ?? candidates.find((candidate) => isElementVisible(candidate))
    ?? candidates[0]
    ?? null;
}

export function getInputAreaElement(domSelectors: SiteSelectors): HTMLElement | null {
  return getInputAreaBySelector(domSelectors.inputArea);
}

export function getInputAreaCandidates(domSelectors: SiteSelectors): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(domSelectors.inputArea));
}

export function focusInputArea(domSelectors: SiteSelectors): void {
  getInputAreaElement(domSelectors)?.focus();
}

export function getSendButton(domSelectors: SiteSelectors): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(domSelectors.sendButton);
}

export function getStopButton(domSelectors: SiteSelectors): HTMLElement | null {
  return domSelectors.stopButton
    ? document.querySelector<HTMLElement>(domSelectors.stopButton)
    : null;
}

export function hasStopButton(domSelectors: SiteSelectors): boolean {
  return Boolean(getStopButton(domSelectors));
}

export function isStopButtonVisible(domSelectors: SiteSelectors): boolean {
  const stopBtn = getStopButton(domSelectors);
  return Boolean(stopBtn && isElementVisible(stopBtn));
}

function isActiveInput(inputEl: HTMLElement): boolean {
  const activeEl = document.activeElement;
  return activeEl === inputEl || Boolean(activeEl) && inputEl.contains(activeEl);
}

export function isSendButtonActuallyStopButton(
  domSelectors: SiteSelectors,
  button: HTMLButtonElement
): boolean {
  return Boolean(domSelectors.stopButton && getStopButton(domSelectors) === button);
}

export function getMessageBlockElements<T extends Element = Element>(
  domSelectors: Pick<SiteSelectors, "messageBlocks">
): T[] {
  return Array.from(document.querySelectorAll<T>(domSelectors.messageBlocks));
}

export function getLatestResponseCodeBlocks(
  domSelectors: SiteSelectors
): LatestResponseCodeBlocks | null {
  const messages = getMessageBlockElements(domSelectors);
  if (messages.length === 0) { return null; }

  const messageIndex = messages.length - 1;
  const lastMessage = messages[messageIndex];
  const codeElements = Array.from(lastMessage.querySelectorAll(domSelectors.codeBlocks));

  return {
    messageIndex,
    messageElement: lastMessage,
    codeElements,
  };
}

export function isLikelyViewingVirtualizedHistory(domSelectors: SiteSelectors): boolean {
  if (domSelectors.virtualizedMessages !== true) {return false;}

  const scrollElement = getPrimaryScrollElement(domSelectors);
  if (!scrollElement) {return false;}

  const metrics = getScrollMetrics(scrollElement);
  if (!metrics) {return false;}

  return metrics.range > HISTORY_SCROLL_MIN_RANGE_PX &&
    metrics.thumbRatio < HISTORY_SCROLL_MAX_THUMB_RATIO &&
    metrics.distanceToBottom > HISTORY_SCROLL_MIN_DISTANCE_TO_BOTTOM_PX;
}

function getPrimaryScrollElement(domSelectors: SiteSelectors): HTMLElement | null {
  const candidates = collectScrollCandidates(domSelectors);
  let best: HTMLElement | null = null;
  let bestScore = -1;

  candidates.forEach((candidate) => {
    const metrics = getScrollMetrics(candidate);
    if (!metrics || !isUsableScrollContainer(candidate, metrics)) {return;}

    // Prefer containers that both own the main scroll range and occupy a substantial viewport area.
    const score = metrics.range + candidate.clientHeight;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

function collectScrollCandidates(domSelectors: SiteSelectors): Set<HTMLElement> {
  const candidates = new Set<HTMLElement>();
  const scrollingElement = document.scrollingElement;
  if (scrollingElement instanceof HTMLElement) {
    candidates.add(scrollingElement);
  }

  const messages = getMessageBlockElements<HTMLElement>(domSelectors);
  addAncestorScrollCandidates(messages[0], candidates);
  addAncestorScrollCandidates(messages[messages.length - 1], candidates);
  addAncestorScrollCandidates(getInputAreaElement(domSelectors), candidates);

  return candidates;
}

function addAncestorScrollCandidates(
  element: HTMLElement | undefined | null,
  candidates: Set<HTMLElement>
): void {
  let current = element?.parentElement ?? null;
  while (current) {
    if (isScrollStyleCandidate(current)) {
      candidates.add(current);
    }
    current = current.parentElement;
  }
}

function isScrollStyleCandidate(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return false;
  }

  if (element === document.scrollingElement) {
    return true;
  }

  const style = window.getComputedStyle(element);
  return isScrollableOverflow(style.overflowY) || isScrollableOverflow(style.overflow);
}

function isScrollableOverflow(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "auto" || normalized === "scroll" || normalized === "overlay";
}

function isUsableScrollContainer(element: HTMLElement, metrics: ScrollMetrics): boolean {
  if (metrics.range <= 0) {return false;}
  if (element.clientHeight < MIN_SCROLL_CONTAINER_HEIGHT_PX) {return false;}
  return element === document.scrollingElement || isElementVisible(element);
}

function getScrollMetrics(element: HTMLElement): ScrollMetrics | null {
  const scrollHeight = element.scrollHeight;
  const clientHeight = element.clientHeight;
  if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
    return null;
  }

  const range = scrollHeight - clientHeight;
  const distanceToBottom = scrollHeight - element.scrollTop - clientHeight;

  return {
    distanceToBottom,
    range,
    thumbRatio: clientHeight / scrollHeight,
  };
}
