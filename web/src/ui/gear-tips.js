/**
 * A Svelte action for the armory's gear tooltips, on the element holding the gear: every `[data-tip]` inside it shows
 * the tooltip `tooltips.get(anchor.dataset.tip)` (HTML).
 *
 * Hover or focus shows a tooltip (text only: its links read as plain text); click, tap or Enter pins it as a non-modal
 * dialog whose links work. Pinned from the keyboard, focus moves into it; Escape (or tabbing out) closes it and
 * returns focus to the button. A click elsewhere dismisses it. New tooltips (a redraw) hide the one showing.
 *
 * @param {HTMLElement} content
 * @param {Map<string, string>} tooltips
 */
export function gearTips(content, tooltips) {
  const tip = document.createElement("div");
  tip.className = "gear-tip";
  tip.id = "gearTip";
  tip.hidden = true;
  document.body.append(tip);

  /** @type {HTMLElement | null} */ let pinned = null;
  /** The anchor whose hover/focus tooltip is showing (it points at the tip with aria-describedby). */
  /** @type {HTMLElement | null} */ let described = null;

  const anchorOf = (event) => event.target.closest?.("[data-tip]");

  function show(anchor, { pin = false, focus = false } = {}) {
    tip.innerHTML = tooltips.get(anchor.dataset.tip) ?? "";
    if (pin) {
      pinned = anchor;
      anchor.classList.add("pinned");
      if (anchor.hasAttribute("aria-expanded"))
        anchor.setAttribute("aria-expanded", "true");
      tip.setAttribute("role", "dialog");
      tip.setAttribute(
        "aria-label",
        anchor.getAttribute("aria-label") || anchor.textContent.trim(),
      );
      tip.tabIndex = -1;
    } else {
      // A tooltip can't hold interactive content: its links read as text until it's pinned.
      for (const link of tip.querySelectorAll("a")) {
        const text = document.createElement("span");
        text.className = link.className;
        text.textContent = link.textContent;
        link.replaceWith(text);
      }
      tip.setAttribute("role", "tooltip");
      tip.removeAttribute("aria-label");
      tip.removeAttribute("tabindex");
      anchor.setAttribute("aria-describedby", tip.id);
      described = anchor;
    }
    tip.hidden = false;
    place(anchor);
    if (focus) (tip.querySelector("a[href]") ?? tip).focus();
  }

  function hide() {
    tip.hidden = true;
    described?.removeAttribute("aria-describedby");
    described = null;
    if (pinned?.hasAttribute("aria-expanded"))
      pinned.setAttribute("aria-expanded", "false");
    pinned?.classList.remove("pinned");
    pinned = null;
  }

  /** Escape or tabbing out: close, and hand focus back to the button if it was inside the tip. */
  function close() {
    const anchor = pinned;
    const focusWasInTip = tip.contains(document.activeElement);
    hide();
    if (anchor && focusWasInTip) anchor.focus();
  }

  /** Beside the anchor when there's room, otherwise below (or above) it; always inside the viewport. */
  function place(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth,
      height = tip.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth,
      viewportHeight = window.innerHeight;
    const gap = 10,
      pad = 8;
    let x, y;
    if (rect.right + gap + width <= viewportWidth - pad) {
      x = rect.right + gap;
      y = rect.top;
    } else if (rect.left - gap - width >= pad) {
      x = rect.left - gap - width;
      y = rect.top;
    } else {
      x = Math.min(Math.max(pad, rect.left), viewportWidth - width - pad);
      y = rect.bottom + gap;
      if (y + height > viewportHeight - pad) y = rect.top - gap - height;
    }
    y = Math.min(
      Math.max(pad, y),
      Math.max(pad, viewportHeight - height - pad),
    );
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  const listeners = [
    [
      content,
      "mouseover",
      (event) => {
        const anchor = anchorOf(event);
        if (anchor && !pinned) show(anchor);
      },
    ],
    [
      content,
      "mouseout",
      (event) => {
        const anchor = anchorOf(event);
        if (!pinned && anchor && !anchor.contains(event.relatedTarget)) hide();
      },
    ],
    [
      content,
      "focusin",
      (event) => {
        const anchor = anchorOf(event);
        if (anchor && !pinned) show(anchor);
      },
    ],
    [
      content,
      "focusout",
      () => {
        if (!pinned) hide();
      },
    ],
    [
      document,
      "click",
      (event) => {
        const anchor = anchorOf(event);
        if (anchor && content.contains(anchor)) {
          const wasPinned = pinned === anchor;
          hide();
          if (wasPinned) return;
          // A click without a pointer (detail 0) is Enter or Space on the button.
          show(anchor, { pin: true, focus: event.detail === 0 });
        } else if (pinned && !tip.contains(event.target)) hide();
      },
    ],
    [
      document,
      "keydown",
      (event) => {
        if (event.key === "Escape" && !tip.hidden) close();
        else if (event.key === "Tab" && tip.contains(event.target)) {
          const links = [...tip.querySelectorAll("a[href]")];
          const leaving = event.shiftKey
            ? event.target === tip || event.target === links[0]
            : !links.length || event.target === links.at(-1);
          if (leaving) {
            event.preventDefault();
            close();
          }
        }
      },
    ],
    [
      tip,
      "focusout",
      (event) => {
        const to = event.relatedTarget;
        if (pinned && to && !tip.contains(to) && to !== pinned) hide();
      },
    ],
    [
      window,
      "scroll",
      () => {
        if (pinned) place(pinned);
        else hide();
      },
      { passive: true },
    ],
  ];
  for (const [target, type, listener, options] of listeners)
    target.addEventListener(type, listener, options);

  return {
    /** @param {Map<string, string>} next  the redrawn gear's tooltips */
    update(next) {
      tooltips = next;
      hide();
    },
    destroy() {
      for (const [target, type, listener] of listeners)
        target.removeEventListener(type, listener);
      tip.remove();
    },
  };
}
