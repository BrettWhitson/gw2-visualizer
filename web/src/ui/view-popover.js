import {
  PATH_MODES,
  PRESET_KINDS,
  Redraw,
  findMatchingPreset,
  getOptionDefinition,
} from "../config/settings-schema.js";
import { escapeHtml } from "../utils/dom.js";
import { OptionsPanel } from "./options-panel.js";

/**
 * The View popover (header "View" button, V): what the ribbon used to hold, in one place. The top rows are the
 * presets and what you're viewing (mode, depth, path); below them an options list with the everyday layout, style
 * and recipe settings. Everything else is one click away: All settings (Customize) and App settings.
 */

/** The settings in the popover's top rows (presets aside): what you're viewing. */
export const QUICK_KEYS = ["viewMode", "maxDepth", "pathMode"];

/** The everyday options, in the popover's list (the rest live in Customize and Settings). */
export const POPOVER_GROUPS = [
  {
    id: "vp-layout",
    title: "Layout",
    keys: ["direction", "physicsMode", "repelForce", "linkDistance"],
  },
  {
    id: "vp-style",
    title: "Style",
    keys: [
      "nodeColorMode",
      "edgeColorMode",
      "edgeRouting",
      "showLabels",
      "showQuantities",
      "showCostInLabel",
      "labelFadeZoom",
    ],
  },
  {
    id: "vp-recipes",
    title: "Recipes",
    keys: ["includeForgePromotions", "useOwned"],
  },
];

export class ViewPopover {
  #button;
  #element;
  #settings;
  #callbacks;

  /**
   * @param {{ button: HTMLElement, settings: import('../core/settings-store.js').SettingsStore,
   *           callbacks: { onOptionChange(key: string, value: unknown, redraw: string): void,
   *                        onReset(keys: string[]): void, onPreset(kind: string, name: string): void,
   *                        onStepDepth(step: number): void, onOpenCustomize(): void, onOpenSettings(): void } }} options
   */
  constructor({ button, settings, callbacks }) {
    this.#button = button;
    this.#settings = settings;
    this.#callbacks = callbacks;
    this.#element = document.createElement("div");
    this.#element.className = "view-popover";
    this.#element.hidden = true;
    this.#element.setAttribute("role", "dialog");
    this.#element.setAttribute("aria-label", "View options");
    this.#element.innerHTML = `
      <div class="vp-title">View options</div>
      <div class="vp-quick"></div>
      <div class="vp-options"></div>
      <div class="vp-foot">
        <button type="button" class="linklike" data-vp="customize">All settings →</button>
        <button type="button" class="linklike" data-vp="settings">App settings</button>
      </div>`;
    document.body.append(this.#element);

    /** The options list: an OptionsPanel, kept in sync by the page like Customize and Settings. */
    this.panel = new OptionsPanel(
      this.#element.querySelector(".vp-options"),
      settings,
      {
        groups: POPOVER_GROUPS.map(({ id, title, keys }) => ({
          id,
          title,
          options: keys.map(getOptionDefinition).filter(Boolean),
        })),
        compact: true,
        idPrefix: "vp",
      },
      {
        onOptionChange: callbacks.onOptionChange,
        onReset: callbacks.onReset,
      },
    );
    this.#bindEvents();
    // Presets, mode, depth and path change from elsewhere too (shortcuts, Customize): follow them while open.
    settings.onChange(() => {
      if (this.isOpen) this.#renderQuick();
    });
  }

  get isOpen() {
    return !this.#element.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.#renderQuick();
    this.panel.render();
    this.#element.hidden = false;
    const rect = this.#button.getBoundingClientRect();
    const width = this.#element.offsetWidth;
    this.#element.style.top = `${rect.bottom + 6}px`;
    this.#element.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
    this.#button.setAttribute("aria-expanded", "true");
    this.#element
      .querySelector("select, button, input")
      ?.focus({ preventScroll: true });
  }

  close({ restoreFocus = false } = {}) {
    if (!this.isOpen) return;
    this.#element.hidden = true;
    this.#button.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.#button.focus();
  }

  #bindEvents() {
    const element = this.#element;
    element.addEventListener("change", (event) => {
      const kind = event.target.dataset.preset;
      if (kind && event.target.value)
        this.#callbacks.onPreset(kind, event.target.value);
    });
    element.addEventListener("click", (event) => {
      const target = event.target.closest("[data-vp]");
      if (!target) return;
      const { vp, value } = target.dataset;
      if (vp === "customize" || vp === "settings") {
        this.close();
        if (vp === "customize") this.#callbacks.onOpenCustomize();
        else this.#callbacks.onOpenSettings();
      } else if (vp === "depth") this.#callbacks.onStepDepth(Number(value));
      else
        this.#callbacks.onOptionChange(
          vp,
          value,
          getOptionDefinition(vp)?.redraw ?? Redraw.fit,
        );
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close({ restoreFocus: true });
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        this.isOpen &&
        !element.contains(event.target) &&
        !this.#button.contains(event.target)
      )
        this.close();
    });
  }

  /** Presets, view mode, depth and path: the settings that aren't plain options. */
  #renderQuick() {
    const values = this.#settings.values;
    const segment = (key, choices) =>
      `<div class="vp-seg" role="group">${choices
        .map(
          ([value, label, title = ""]) =>
            `<button type="button" data-vp="${key}" data-value="${value}" class="${values[key] === value ? "on" : ""}" aria-pressed="${values[key] === value}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`,
        )
        .join("")}</div>`;
    const presetSelect = (kind) => {
      const active = findMatchingPreset(values, kind);
      return `<select data-preset="${kind}" aria-label="${PRESET_KINDS[kind].label} preset"><option value="" ${active ? "" : "selected"} hidden>Custom</option>${Object.entries(
        PRESET_KINDS[kind].presets,
      )
        .map(
          ([name, preset]) =>
            `<option value="${escapeHtml(name)}" title="${escapeHtml(preset.description)}" ${name === active ? "selected" : ""}>${escapeHtml(name)}</option>`,
        )
        .join("")}</select>`;
    };
    const depthDef = getOptionDefinition("maxDepth");
    const depth =
      values.maxDepth >= depthDef.max ? "All" : String(values.maxDepth);
    this.#element.querySelector(".vp-quick").innerHTML = `
      <div class="vp-row"><span>Presets</span><div class="vp-pair">${presetSelect("layout")}${presetSelect("style")}</div></div>
      <div class="vp-row"><span>Mode</span>${segment("viewMode", [
        ["tree", "Tree", "Every occurrence is its own node"],
        ["merged", "Merged", "Shared ingredients combined into one node"],
      ])}</div>
      <div class="vp-row"><span>Depth</span><div class="vp-step">
        <button type="button" data-vp="depth" data-value="-1" title="One level less ( [ )" aria-label="One level less" ${values.maxDepth <= depthDef.min ? "disabled" : ""}>−</button>
        <output>${depth}</output>
        <button type="button" data-vp="depth" data-value="1" title="One level more ( ] )" aria-label="One level more" ${values.maxDepth >= depthDef.max ? "disabled" : ""}>+</button></div></div>
      <div class="vp-row"><span>Path</span>${segment(
        "pathMode",
        Object.entries(PATH_MODES).map(([value, { label, hint }]) => [
          value,
          label,
          hint,
        ]),
      )}</div>`;
  }
}
