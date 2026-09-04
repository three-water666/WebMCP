/** Runs a synchronous page interaction without permanently stealing the user's current focus. */
export function preserveActiveElement<T>(action: () => T): T {
  const previous = getDeepActiveElement();
  try {
    return action();
  } finally {
    restoreActiveElement(previous);
  }
}

function getDeepActiveElement(): HTMLElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return isFocusableElement(active) ? active : null;
}

function restoreActiveElement(element: HTMLElement | null): void {
  if (!element || element.isConnected === false || getDeepActiveElement() === element) {return;}

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function isFocusableElement(element: Element | null): element is HTMLElement {
  return element !== null && "focus" in element && typeof element.focus === "function";
}
