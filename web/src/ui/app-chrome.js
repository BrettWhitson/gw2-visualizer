import { querySelectorAll } from "../utils/dom.js";

/** Status bar at the bottom of the window. */
export class StatusBar {
  constructor(messageElement, countsElement, busyElement = null) {
    this.messageElement = messageElement;
    this.countsElement = countsElement;
    this.busyElement = busyElement;
  }

  /** "Updating prices…" indicator. */
  setBusy(isBusy) {
    if (this.busyElement) this.busyElement.hidden = !isBusy;
  }

  setMessage(text) {
    this.messageElement.textContent = text;
  }

  setCounts(nodeCount, edgeCount) {
    this.countsElement.textContent = `${nodeCount} nodes · ${edgeCount} edges`;
  }
}

/** Full-screen progress overlay shown while game data loads. */
export class LoadingOverlay {
  constructor(overlayElement, messageElement, barElement) {
    Object.assign(this, { overlayElement, messageElement, barElement });
    this.progressElement = barElement.parentElement; // role="progressbar"
    this.retryButton = overlayElement.querySelector(
      '[data-command="retry-load"]',
    );
  }

  setRetryVisible(isVisible) {
    if (this.retryButton) this.retryButton.hidden = !isVisible;
  }

  show() {
    this.overlayElement.hidden = false;
  }

  hide() {
    this.overlayElement.hidden = true;
  }

  /** @param {number} fraction 0…1 */
  setProgress(message, fraction) {
    this.show();
    this.messageElement.textContent = message;
    const percent = Math.round(fraction * 100);
    this.barElement.style.width = `${percent}%`;
    this.progressElement.setAttribute("aria-valuenow", String(percent));
  }
}

const PANEL_WIDTH = { min: 280, max: 720, keyboardStep: 24 };

/**
 * Side panel with tabs (Details / Shopping list / Customize), collapsed from a handle on its own edge and resized
 * by dragging that edge (or with arrow keys on it: the WAI-ARIA window-splitter pattern).
 */
export class SidePanel {
  /**
   * @param {HTMLElement} panelElement
   * @param {{ layout: HTMLElement, handle: HTMLElement, resizer: HTMLElement,
   *           onResize: (width: number, isFinal: boolean) => void }} edge
   */
  constructor(panelElement, { layout, handle, resizer, onResize }) {
    this.panelElement = panelElement;
    Object.assign(this, { layout, handle, resizer, onResize });
    this.#bindResizer();
    panelElement.addEventListener("click", (event) => {
      const tab = event.target.closest(".tabs button[data-tab]");
      if (tab) this.showTab(tab.dataset.tab);
    });
    // WAI-ARIA tabs pattern: arrow keys move between tabs.
    panelElement.querySelector(".tabs").addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tabs = querySelectorAll(".tabs button[data-tab]", panelElement);
      const current = tabs.findIndex(
        (tab) => tab.getAttribute("aria-selected") === "true",
      );
      const next =
        tabs[
          (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length
        ];
      this.showTab(next.dataset.tab);
      next.focus();
    });
  }

  setOpen(isOpen) {
    this.layout.classList.toggle("panel-collapsed", !isOpen);
    this.handle.setAttribute("aria-expanded", String(isOpen));
    const action = isOpen ? "Hide the side panel" : "Show the side panel";
    this.handle.title = `${action} (P)`;
    this.handle.querySelector(".sr-only").textContent = action;
  }

  /** @param {number} width px (clamped) */
  setWidth(width) {
    const clamped = Math.round(
      Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)),
    );
    this.layout.style.setProperty("--sidebar-w", `${clamped}px`);
    this.resizer.setAttribute("aria-valuenow", String(clamped));
    this.resizer.setAttribute("aria-valuemin", String(PANEL_WIDTH.min));
    this.resizer.setAttribute("aria-valuemax", String(PANEL_WIDTH.max));
    return clamped;
  }

  #bindResizer() {
    const resizer = this.resizer;
    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizer.setPointerCapture(event.pointerId);
      resizer.classList.add("dragging");
      const right = this.layout.getBoundingClientRect().right;
      const move = (moveEvent) =>
        this.onResize(this.setWidth(right - moveEvent.clientX), false);
      const end = (endEvent) => {
        resizer.removeEventListener("pointermove", move);
        resizer.classList.remove("dragging");
        this.onResize(this.setWidth(right - endEvent.clientX), true);
      };
      resizer.addEventListener("pointermove", move);
      resizer.addEventListener("pointerup", end, { once: true });
      resizer.addEventListener("pointercancel", end, { once: true });
    });
    resizer.addEventListener("keydown", (event) => {
      const current = Number(resizer.getAttribute("aria-valuenow"));
      const next =
        event.key === "ArrowLeft"
          ? current + PANEL_WIDTH.keyboardStep
          : event.key === "ArrowRight"
            ? current - PANEL_WIDTH.keyboardStep
            : event.key === "Home"
              ? PANEL_WIDTH.min
              : event.key === "End"
                ? PANEL_WIDTH.max
                : null;
      if (next == null) return;
      event.preventDefault();
      this.onResize(this.setWidth(next), true);
    });
  }

  showTab(name) {
    for (const button of querySelectorAll(".tabs button", this.panelElement)) {
      const isActive = button.dataset.tab === name;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    }
    for (const section of querySelectorAll(".tab", this.panelElement))
      section.classList.toggle("active", section.id === `tab-${name}`);
  }
}
