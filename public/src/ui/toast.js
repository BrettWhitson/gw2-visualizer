import { escapeHtml } from "../utils/dom.js";

const DEFAULT_DURATION_MS = 5000;
const MAX_VISIBLE_TOASTS = 3;

/**
 * Transient notifications (updates, offline, errors). Announced to screen readers via the container's
 * aria-live region. Identical messages already on screen are not repeated.
 */
export class ToastCenter {
  /** @param {HTMLElement} container  element with role="status" / aria-live="polite" */
  constructor(container) {
    this.container = container;
  }

  /**
   * @param {string} message
   * @param {{ tone?: 'info' | 'error' | 'success', durationMs?: number, action?: { label: string, onClick: () => void } }} [options]
   *   durationMs: 0 keeps the toast until dismissed.
   */
  show(
    message,
    { tone = "info", durationMs = DEFAULT_DURATION_MS, action } = {},
  ) {
    // A modal dialog sits in the top layer above everything else, so toasts must live inside it to be seen/clickable.
    const host = document.querySelector("dialog[open]") ?? document.body;
    if (this.container.parentElement !== host) host.append(this.container);
    if (
      [...this.container.children].some(
        (toast) => toast.dataset.message === message,
      )
    )
      return;
    while (this.container.children.length >= MAX_VISIBLE_TOASTS)
      this.container.firstElementChild.remove();

    const toast = document.createElement("div");
    toast.className = `toast toast-${tone}`;
    toast.dataset.message = message;
    toast.innerHTML =
      `<span>${escapeHtml(message)}</span>` +
      (action
        ? `<button type="button" class="toast-action">${escapeHtml(action.label)}</button>`
        : "") +
      '<button type="button" class="toast-close" aria-label="Dismiss">✕</button>';
    toast
      .querySelector(".toast-close")
      .addEventListener("click", () => toast.remove());
    if (action)
      toast.querySelector(".toast-action").addEventListener("click", () => {
        toast.remove();
        action.onClick();
      });
    this.container.append(toast);
    if (durationMs > 0) setTimeout(() => toast.remove(), durationMs);
  }
}
