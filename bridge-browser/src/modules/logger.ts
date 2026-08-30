import { BRANDING } from '@webcode/shared';

import { i18n } from './i18n';
import {
  getFilterLabel,
  LOG_TYPE_META,
  STANDARD_LOG_TYPES,
  type LoggerFilterType,
  type LoggerLogType,
} from './logger_metadata';
import {
  LOGGER_MIN_HEIGHT,
  LOGGER_MIN_WIDTH,
  LOGGER_STYLE_TEXT,
} from './logger_styles';

export const Logger = {
  el: null as HTMLDivElement | null,
  panelEl: null as HTMLDivElement | null,
  contentEl: null as HTMLDivElement | null,
  filterButtons: new Map<LoggerFilterType, HTMLButtonElement>(),
  activeTypes: new Set<LoggerLogType>(["summary"]),
  isMinimized: false,
  soundEnabled: false,

  init() {
    if (this.el) {return;}

    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      zIndex: "2147483647",
      display: "none",
    });

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = LOGGER_STYLE_TEXT;

    const panel = document.createElement("div");
    panel.className = "logger";
    this.panelEl = panel;

    const header = document.createElement("div");
    header.className = "header";

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = `${BRANDING.bridgeName} Process Log`;

    const dragHandle = document.createElement("span");
    dragHandle.className = "drag-handle";
    dragHandle.title = i18n.lang === "zh" ? "拖动日志窗口" : "Drag log window";
    dragHandle.setAttribute("aria-hidden", "true");

    const actions = document.createElement("div");
    actions.className = "actions";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "icon-btn clear";
    clearBtn.title = i18n.lang === "zh" ? "清空日志" : "Clear logs";
    clearBtn.setAttribute("aria-label", clearBtn.title);
    clearBtn.textContent = "🗑️";
    clearBtn.onclick = () => {
      if (this.contentEl) {this.contentEl.innerHTML = "";}
    };

    const minimizeBtn = document.createElement("button");
    minimizeBtn.type = "button";
    minimizeBtn.className = "icon-btn minimize";
    minimizeBtn.title = i18n.lang === "zh" ? "缩小" : "Minimize";
    minimizeBtn.setAttribute("aria-label", minimizeBtn.title);
    minimizeBtn.textContent = "−";
    minimizeBtn.onclick = () => this.setMinimized(true);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "icon-btn restore";
    restoreBtn.title = i18n.lang === "zh" ? "放大" : "Restore";
    restoreBtn.setAttribute("aria-label", restoreBtn.title);
    restoreBtn.textContent = "□";
    restoreBtn.onclick = () => this.setMinimized(false);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "icon-btn close";
    closeBtn.title = i18n.lang === "zh" ? "关闭日志" : "Close logs";
    closeBtn.setAttribute("aria-label", closeBtn.title);
    closeBtn.textContent = "×";
    closeBtn.onclick = () => this.close();

    actions.appendChild(clearBtn);
    actions.appendChild(minimizeBtn);
    actions.appendChild(restoreBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(dragHandle);
    header.appendChild(actions);

    const filters = document.createElement("div");
    filters.className = "filters";
    this.filterButtons.clear();
    filters.appendChild(this.createFilterButton("summary"));
    filters.appendChild(this.createFilterSeparator());
    filters.appendChild(this.createFilterButton("all"));
    STANDARD_LOG_TYPES.forEach((type) => filters.appendChild(this.createFilterButton(type)));

    this.contentEl = document.createElement("div");
    this.contentEl.className = "content";

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "resize-handle";
    resizeHandle.title = i18n.lang === "zh" ? "拖动调整大小" : "Resize log window";

    panel.appendChild(header);
    panel.appendChild(filters);
    panel.appendChild(this.contentEl);
    panel.appendChild(resizeHandle);
    shadow.appendChild(style);
    shadow.appendChild(panel);
    document.body.appendChild(host);

    this.el = host;
    this.refreshFilterButtons();
    this.makeDraggable(header);
    this.makeResizable(resizeHandle);
  },

  createFilterButton(filter: LoggerFilterType): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter";
    button.textContent = getFilterLabel(filter);
    button.onclick = () => this.setFilter(filter);
    this.filterButtons.set(filter, button);
    return button;
  },

  createFilterSeparator(): HTMLSpanElement {
    const separator = document.createElement("span");
    separator.className = "filter-separator";
    separator.textContent = "|";
    return separator;
  },

  setFilter(filter: LoggerFilterType) {
    if (filter === "all") {
      const allStandardTypesActive = STANDARD_LOG_TYPES.every((type) => this.activeTypes.has(type));
      STANDARD_LOG_TYPES.forEach((type) => {
        if (allStandardTypesActive) {
          this.activeTypes.delete(type);
        } else {
          this.activeTypes.add(type);
        }
      });
    } else if (this.activeTypes.has(filter)) {
      this.activeTypes.delete(filter);
    } else {
      this.activeTypes.add(filter);
    }

    this.refreshFilterButtons();
    this.applyFilters();
  },

  refreshFilterButtons() {
    this.filterButtons.forEach((button, filter) => {
      const isActive = filter === "all"
        ? STANDARD_LOG_TYPES.every((type) => this.activeTypes.has(type))
        : this.activeTypes.has(filter);
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  },

  applyFilters() {
    if (!this.contentEl) {return;}

    this.contentEl.querySelectorAll<HTMLDivElement>(".line").forEach((line) => {
      const type = line.dataset.logType as LoggerLogType | undefined;
      line.hidden = type ? !this.activeTypes.has(type) : false;
    });
  },

  setMinimized(minimized: boolean) {
    this.isMinimized = minimized;
    if (this.panelEl) {
      this.panelEl.classList.toggle("minimized", minimized);
    }

    if (!minimized && this.el) {
      requestAnimationFrame(() => {
        if (!this.el) {return;}
        const rect = this.el.getBoundingClientRect();
        const currentLeft = parseFloat(this.el.style.left) || rect.left;
        const clampedLeft = Math.max(0, Math.min(currentLeft, window.innerWidth - rect.width));
        if (clampedLeft !== currentLeft) {
          this.el.style.left = clampedLeft + "px";
          this.el.style.right = "auto";
        }
      });
    }
  },

  makeDraggable(headerEl: HTMLElement) {
    let isDragging = false,
      startX: number,
      startY: number,
      iLeft: number,
      iTop: number;
    headerEl.onmousedown = (e) => {
      if (!this.el) {return;}
      if ((e.target as HTMLElement).closest("button")) {return;}
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const r = this.el.getBoundingClientRect();
      iLeft = r.left;
      iTop = r.top;
    };
    window.onmousemove = (e) => {
      if (isDragging && this.el) {
        const rect = this.el.getBoundingClientRect();
        let left = iLeft + e.clientX - startX;
        let top = iTop + e.clientY - startY;
        left = Math.max(0, Math.min(left, window.innerWidth - rect.width));
        top = Math.max(0, Math.min(top, window.innerHeight - 32));
        this.el.style.left = left + "px";
        this.el.style.top = top + "px";
        this.el.style.right = "auto";
      }
    };
    window.onmouseup = () => (isDragging = false);
  },

  makeResizable(handleEl: HTMLElement) {
    let isResizing = false,
      startX: number,
      startY: number,
      startWidth: number,
      startHeight: number;

    handleEl.onmousedown = (e) => {
      if (!this.el || !this.panelEl || this.isMinimized) {return;}
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const hostRect = this.el.getBoundingClientRect();
      const panelRect = this.panelEl.getBoundingClientRect();
      startWidth = panelRect.width;
      startHeight = panelRect.height;
      this.el.style.left = hostRect.left + "px";
      this.el.style.top = hostRect.top + "px";
      this.el.style.right = "auto";
    };

    window.addEventListener("mousemove", (e) => {
      if (!isResizing || !this.panelEl) {return;}
      const width = Math.max(LOGGER_MIN_WIDTH, startWidth + e.clientX - startX);
      const height = Math.max(LOGGER_MIN_HEIGHT, startHeight + e.clientY - startY);
      this.panelEl.style.width = width + "px";
      this.panelEl.style.height = height + "px";
    });

    window.addEventListener("mouseup", () => {
      isResizing = false;
    });
  },

  toggle(show: boolean) {
    if (!this.el && show) {this.init();}
    if (this.el) {this.el.style.display = show ? "block" : "none";}
  },

  close() {
    this.toggle(false);
    this.syncVisibility(false);
  },

  syncVisibility(show: boolean) {
    try {
      chrome.runtime.sendMessage({ type: "SET_LOG_VISIBLE", show }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Logger may be reused outside an extension context during local testing.
    }
  },

  setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
  },

  playLogSound(type: LoggerLogType) {
    if (!this.soundEnabled || !isStandardLogType(type)) {return;}

    try {
      chrome.runtime.sendMessage({ type: "PLAY_LOG_SOUND", logType: type }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Logger may be reused outside an extension context during local testing.
    }
  },

  log(msg: string, type: LoggerLogType = "info") {
    this.playLogSound(type);
    if (!this.el || this.el.style.display === "none") {return;}
    const line = document.createElement("div");
    line.className = "line";
    line.dataset.logType = type;
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    const meta = LOG_TYPE_META[type];
    const timeEl = document.createElement("span");
    timeEl.className = "time";
    timeEl.textContent = `[${time}]`;

    const msgEl = document.createElement("span");
    msgEl.style.color = meta.color;
    msgEl.textContent = msg;

    line.appendChild(timeEl);
    line.append(` ${meta.icon} `);
    line.appendChild(msgEl);
    line.hidden = !this.activeTypes.has(type);

    if (this.contentEl) {
      this.contentEl.appendChild(line);
      if (!line.hidden) {
        this.contentEl.scrollTop = this.contentEl.scrollHeight;
      }
    }
  },
};

function isStandardLogType(type: LoggerLogType): type is typeof STANDARD_LOG_TYPES[number] {
  return STANDARD_LOG_TYPES.includes(type as typeof STANDARD_LOG_TYPES[number]);
}
