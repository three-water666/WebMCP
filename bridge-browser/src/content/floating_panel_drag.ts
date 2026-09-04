const DEFAULT_VIEWPORT_MARGIN = 8;
const DRAG_THRESHOLD_PX = 4;

export interface FloatingPanelPosition {
  left: number;
  top: number;
}

export interface FloatingPanelSize {
  height: number;
  width: number;
}

interface DragState {
  hasMoved: boolean;
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
  private suppressNextClick = false;

  public constructor(private readonly host: HTMLElement) {
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("resize", this.scheduleClamp);
  }

  public bindHandle(handle: HTMLElement, allowButtonTarget = false): void {
    handle.onmousedown = (event) => this.startDrag(event, allowButtonTarget);
  }

  public consumeDragClick(): boolean {
    const shouldSuppress = this.suppressNextClick;
    this.suppressNextClick = false;
    return shouldSuppress;
  }

  public scheduleClamp = (): void => {
    if (!this.positioned || this.clampFrame !== null) {return;}
    this.clampFrame = requestAnimationFrame(() => {
      this.clampFrame = null;
      this.clampCurrentPosition();
    });
  };

  private startDrag(event: MouseEvent, allowButtonTarget: boolean): void {
    this.suppressNextClick = false;
    if (
      event.button !== 0 ||
      (!allowButtonTarget && (event.target as Element | null)?.closest?.("button"))
    ) {return;}
    const rect = this.host.getBoundingClientRect();
    this.dragState = {
      hasMoved: false,
      initialLeft: rect.left,
      initialTop: rect.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    event.preventDefault();
    event.stopPropagation();
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.dragState) {return;}
    const deltaX = event.clientX - this.dragState.pointerX;
    const deltaY = event.clientY - this.dragState.pointerY;
    if (!this.dragState.hasMoved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {return;}

    this.dragState.hasMoved = true;
    this.positioned = true;
    const rect = this.host.getBoundingClientRect();
    this.applyPosition({
      left: this.dragState.initialLeft + deltaX,
      top: this.dragState.initialTop + deltaY,
    }, rect);
    event.preventDefault();
  };

  private readonly handleMouseUp = (): void => {
    this.suppressNextClick = this.dragState?.hasMoved ?? false;
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
