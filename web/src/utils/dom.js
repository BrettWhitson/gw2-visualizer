/** Small DOM helpers. */

export const querySelector = (selector, root = document) =>
  root.querySelector(selector);
export const querySelectorAll = (selector, root = document) => [
  ...root.querySelectorAll(selector),
];

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for safe interpolation into HTML strings and attributes. */
export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

/** True when a keyboard event originates from a form field (so global shortcuts should be ignored). */
export const isTypingTarget = (target) =>
  !!target?.matches?.("input, select, textarea");

export const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/** Make role="button" rows keyboard-operable like real buttons. */
export function activateOnEnterOrSpace(event, handler) {
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.matches('[role="button"]')
  ) {
    event.preventDefault();
    handler(event);
  }
}

/** Copy to the clipboard and report the outcome (the Clipboard API needs a secure context). */
export function copyText(text, successMessage, notify) {
  if (!navigator.clipboard) {
    notify("Copying needs HTTPS. Select and copy manually instead.");
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => notify(successMessage),
    () => notify("Copy failed: clipboard permission denied."),
  );
}

export function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}
