const DEFAULT_VIEWPORT_MARGIN = 8;

export interface FloatingPanelPosition {
  left: number;
  top: number;
}

export interface FloatingPanelSize {
  height: number;
  width: number;
}

interface DragState {
  initialLeft: number;
  initialTop: number;
  pointerX: number;
  pointerY: number;
}

export function clampFloatingPanelPosition(
  position: FloatingPanelPosition,
  panel: FloatingPanelSize,
  viewport: FloatingPanelSize,
  margin = DEFAULT_VIEWPORT_MARGIN
): FloatingPanelPosition {
  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const maxTop = Math.max(margin, viewport.height - panel.height - margin);
  return {
    left: Math.max(margin, Math.min(position.left, maxLeft)),
    top: Math.max(margin, Math.min(position.top, maxTop)),
  };
}

export class FloatingPanelDragController {
  private clampFrame: number | null = null;
  private dragState: DragState | null = null;
  private positioned = false;

  public constructor(private readonly host: HTMLElement) {
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("resize", this.scheduleClamp);
  }

  public bindHandle(handle: HTMLElement): void {
    handle.onmousedown = (event) => this.startDrag(event);
  }

  public scheduleClamp = (): void => {
    if (!this.positioned || this.clampFrame !== null) {return;}
    this.clampFrame = requestAnimationFrame(() => {
      this.clampFrame = null;
      this.clampCurrentPosition();
    });
  };

  private startDrag(event: MouseEvent): void {
    if (event.button !== 0 || (event.target as Element | null)?.closest?.("button")) {return;}
    const rect = this.host.getBoundingClientRect();
    this.dragState = {
      initialLeft: rect.left,
      initialTop: rect.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    this.positioned = true;
    this.applyPosition({ left: rect.left, top: rect.top }, rect);
    event.preventDefault();
    event.stopPropagation();
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.dragState) {return;}
    const rect = this.host.getBoundingClientRect();
    this.applyPosition({
      left: this.dragState.initialLeft + event.clientX - this.dragState.pointerX,
      top: this.dragState.initialTop + event.clientY - this.dragState.pointerY,
    }, rect);
    event.preventDefault();
  };

  private readonly handleMouseUp = (): void => {
    this.dragState = null;
  };

  private clampCurrentPosition(): void {
    if (this.host.style.display === "none") {return;}
    const rect = this.host.getBoundingClientRect();
    this.applyPosition({ left: rect.left, top: rect.top }, rect);
  }

  private applyPosition(position: FloatingPanelPosition, panel: FloatingPanelSize): void {
    const clamped = clampFloatingPanelPosition(position, panel, {
      height: window.innerHeight,
      width: window.innerWidth,
    });
    const bottom = window.innerHeight - clamped.top - panel.height;
    this.host.style.left = `${clamped.left}px`;
    this.host.style.top = "auto";
    this.host.style.right = "auto";
    this.host.style.bottom = `${bottom}px`;
  }
}
