import { VIEW_OPTION_GROUPS } from "../config/settings-schema.js";
import { OptionsPanel } from "./options-panel.js";
import { RIBBON_SECTIONS } from "./ribbon-sections.js";

/**
 * The middle layer of customization: a panel that drops down under a ribbon section with that section's options
 * (e.g. every force, or all node / edge / canvas styling), without opening the full Customize panel.
 *
 * One popout at a time. It closes on Esc, on a click outside, or from its own × / toggle button, and hands focus
 * back to the button that opened it. It behaves like an OptionsPanel, so the app keeps it in sync with the rest.
 */
export class RibbonPopout {
  /** @type {OptionsPanel | null} */
  #panel = null;
  #sectionId = null;
  /** @type {HTMLElement | null} */
  #opener = null;

  /**
   * @param {HTMLElement} element  the popout container (hidden until opened)
   * @param {import('../core/settings-store.js').SettingsStore} settings
   * @param {{ onOptionChange(key: string, value: unknown, redraw: string): void, onReset(keys: string[]): void,
   *           onOpenInCustomize(groupId: string): void }} callbacks
   */
  constructor(element, settings, callbacks) {
    this.element = element;
    this.settings = settings;
    this.callbacks = callbacks;
    element.addEventListener("click", (event) => {
      if (event.target.closest("[data-popout-close]")) this.close();
      const more = event.target.closest("[data-open-customize]");
      if (more) {
        const groupId = more.dataset.openCustomize;
        this.close({ restoreFocus: false });
        callbacks.onOpenInCustomize(groupId);
      }
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        this.isOpen &&
        !element.contains(event.target) &&
        !event.target.closest?.("[data-section-toggle]")
      )
        this.close({ restoreFocus: false });
    });
  }

  get isOpen() {
    return !this.element.hidden;
  }

  /** Open (or close, if it's already showing) the popout for a section, anchored under its ribbon group. */
  toggle(sectionId, opener) {
    if (this.isOpen && this.#sectionId === sectionId) {
      this.close();
      return;
    }
    this.open(sectionId, opener);
  }

  open(sectionId, opener) {
    const section = RIBBON_SECTIONS[sectionId];
    const groups = VIEW_OPTION_GROUPS.filter((group) =>
      section.groups.includes(group.id),
    );
    if (!groups.length) return;
    this.#setOpenerState(false);
    this.#sectionId = sectionId;
    this.#opener = opener;
    this.element.innerHTML = `
      <div class="popout-head">
        <h3 id="popoutTitle">${section.title}</h3>
        <button type="button" class="linklike" data-open-customize="${groups[0].id}">All options in Customize</button>
        <button type="button" class="popout-close" data-popout-close aria-label="Close ${section.title} options">&#10005;</button>
      </div>
      <div class="popout-body"></div>`;
    this.element.setAttribute("aria-labelledby", "popoutTitle");
    this.#panel = new OptionsPanel(
      this.element.querySelector(".popout-body"),
      this.settings,
      { groups, compact: true, idPrefix: `pop-${sectionId}` },
      this.callbacks,
    );
    this.#panel.render();
    this.element.hidden = false;
    this.#position(opener.closest(".rgroup"));
    this.#setOpenerState(true);
    this.element
      .querySelector("input, select, button:not(.popout-close):not(.linklike)")
      ?.focus({ preventScroll: true });
  }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.element.innerHTML = "";
    this.#panel = null;
    this.#setOpenerState(false);
    if (restoreFocus) this.#opener?.focus();
    this.#sectionId = null;
  }

  // OptionsPanel-like interface, so the app can keep it in sync with setting changes made elsewhere.
  render() {
    this.#panel?.render();
  }
  syncValues() {
    this.#panel?.syncValues();
  }
  refreshStatus() {
    this.#panel?.refreshStatus();
  }

  #setOpenerState(isOpen) {
    this.#opener?.setAttribute("aria-expanded", String(isOpen));
    this.#opener?.closest(".rgroup")?.classList.toggle("popout-open", isOpen);
  }

  /** Under the section, left-aligned with it, kept inside the window. */
  #position(group) {
    const wrap = this.element.offsetParent ?? document.body;
    const wrapBox = wrap.getBoundingClientRect();
    const groupBox = group.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const left = Math.max(
      8,
      Math.min(groupBox.left - wrapBox.left, wrapBox.width - width - 8),
    );
    this.element.style.left = `${left}px`;
    this.element.style.top = `${groupBox.bottom - wrapBox.top + 4}px`;
  }
}
