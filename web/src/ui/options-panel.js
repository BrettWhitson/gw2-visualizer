import {
  DEFAULT_SETTINGS,
  Redraw,
  formatOptionValue,
  getOptionDefinition,
} from "../config/settings-schema.js";
import { escapeHtml } from "../utils/dom.js";
import { bindRangeSteppers, syncStepButtons } from "./range-stepper.js";

/**
 * A panel of setting controls built from option groups (see settings-schema.js). Used for:
 *  - Customize (side panel): the look (presets are picked from the ribbon);
 *  - Settings (dialog): behaviour;
 *  - the ribbon's section popouts (compact: no filter / reset-all header).
 * Groups render as collapsible sections. Changed options are marked and can be reset individually (↺ or
 * double-click a slider), per section, or all at once. A filter box narrows the list by name.
 */
export class OptionsPanel {
  #openGroups;
  #filterText = "";
  #groups;
  #compact;
  #idPrefix;
  /** Which options were visible at the last render (a change means the panel must re-render). */
  #visibleSignature = "";

  /**
   * @param {HTMLElement} element
   * @param {import('../core/settings-store.js').SettingsStore} settings
   * @param {{ groups: typeof import('../config/settings-schema.js').VIEW_OPTION_GROUPS, initiallyOpen?: string[],
   *           compact?: boolean, idPrefix?: string }} config
   *   initiallyOpen: group ids expanded at first (default: all); idPrefix: keeps control ids unique when two panels
   *   show the same option
   * @param {{ onOptionChange(key: string, value: unknown, redraw: string): void, onReset(keys: string[]): void }} callbacks
   */
  constructor(
    element,
    settings,
    { groups, initiallyOpen, compact = false, idPrefix = "opt" },
    callbacks,
  ) {
    this.element = element;
    this.settings = settings;
    this.callbacks = callbacks;
    this.#groups = groups;
    this.#compact = compact;
    this.#idPrefix = idPrefix;
    this.#openGroups = new Set(
      initiallyOpen ?? groups.map((group) => group.id),
    );
    this.#bindEvents();
  }

  get #allOptions() {
    return this.#groups.flatMap((group) => group.options);
  }

  /** Full re-render (needed when option visibility or modified state may have changed). */
  render() {
    const values = this.settings.values;
    const changedCount = this.#allOptions.filter(
      (o) => !this.#isDefault(o.key),
    ).length;
    const filterValue = escapeHtml(this.#filterText);

    const head = this.#compact
      ? ""
      : `
      <div class="cz-head">
        <input type="search" class="cz-filter" placeholder="Filter options…" aria-label="Filter options" value="${filterValue}">
        <button type="button" class="cz-reset-all" data-reset-all ${changedCount ? "" : "disabled"}
                title="Reset every option here to its default">Reset all${changedCount ? ` (${changedCount})` : ""}</button>
      </div>`;
    this.element.innerHTML = `${head}
      ${this.#groups.map((group) => this.#groupHtml(group, values)).join("")}`;
    this.#visibleSignature = this.#visibilitySignature();
    this.#applyFilter();
  }

  /** Open one section and scroll it into view (e.g. "More in Customize" from a ribbon popout). */
  revealGroup(groupId) {
    this.#openGroups.add(groupId);
    this.render();
    this.element
      .querySelector(`.cz-group[data-group="${groupId}"]`)
      ?.scrollIntoView({ block: "start" });
  }

  #visibilitySignature() {
    const values = this.settings.values;
    return this.#allOptions
      .filter((option) => !option.visibleWhen || option.visibleWhen(values))
      .map((option) => option.key)
      .join();
  }

  /**
   * Update control values in place (cheap; keeps focus and slider drags intact). If a change elsewhere (e.g. the
   * ribbon) showed or hid options, re-render instead so they appear / disappear.
   */
  syncValues() {
    if (this.#visibilitySignature() !== this.#visibleSignature) {
      this.render();
      return;
    }
    for (const input of this.element.querySelectorAll("[data-setting]")) {
      const key = input.dataset.setting;
      const value = this.settings.values[key];
      if (input.type === "checkbox") input.checked = !!value;
      else if (document.activeElement !== input) input.value = value;
      if (input.type === "range") this.#updateRangeRow(input, value);
      input
        .closest(".opt")
        ?.classList.toggle("modified", !this.#isDefault(key));
    }
  }

  /** Update the "changed" counts in place (safe during slider drags). */
  refreshStatus() {
    const changedCount = this.#allOptions.filter(
      (o) => !this.#isDefault(o.key),
    ).length;
    const resetAll = this.element.querySelector("[data-reset-all]");
    if (resetAll) {
      resetAll.disabled = !changedCount;
      resetAll.textContent = `Reset all${changedCount ? ` (${changedCount})` : ""}`;
    }
    for (const group of this.#groups) {
      const summary = this.element.querySelector(
        `.cz-group[data-group="${group.id}"] summary`,
      );
      if (summary) summary.innerHTML = this.#summaryHtml(group);
    }
  }

  #summaryHtml(group) {
    const changed = group.options.filter((o) => !this.#isDefault(o.key)).length;
    return `<span>${escapeHtml(group.title)}</span>${changed ? `<span class="cz-changed">${changed} changed</span>` : ""}
          ${changed ? `<button type="button" class="cz-reset-group" data-reset-group="${group.id}">Reset</button>` : ""}`;
  }

  #isDefault(key) {
    return this.settings.values[key] === DEFAULT_SETTINGS[key];
  }

  #groupHtml(group, values) {
    const visibleOptions = group.options.filter(
      (option) => !option.visibleWhen || option.visibleWhen(values),
    );
    const rows = visibleOptions
      .map((option) => {
        const modified = !this.#isDefault(option.key);
        const defaultText = this.#describeValue(
          option,
          DEFAULT_SETTINGS[option.key],
        );
        return `<div class="opt${option.type === "checkbox" ? " chk" : ""}${modified ? " modified" : ""}" data-option="${option.key}"
                   data-label="${escapeHtml(option.label.toLowerCase())}">
          <label for="${this.#idPrefix}-${option.key}"${option.hint ? ` title="${escapeHtml(option.hint)}"` : ""}>${escapeHtml(option.label)}</label>
          ${this.#controlHtml(option, values[option.key])}
          <button type="button" class="opt-reset" data-reset="${option.key}" title="Reset to default (${escapeHtml(defaultText)})" aria-label="Reset ${escapeHtml(option.label)}">&#8634;</button>
        </div>`;
      })
      .join("");
    return `<details class="cz-group" data-group="${group.id}"${this.#openGroups.has(group.id) ? " open" : ""}>
        <summary>${this.#summaryHtml(group)}</summary>
        <div class="opts">${rows}</div>
      </details>`;
  }

  /** Readout + −/+ availability for a slider row. */
  #updateRangeRow(input, value) {
    const row = input.closest(".rng");
    row.querySelector("output").textContent = formatOptionValue(
      getOptionDefinition(input.dataset.setting),
      value,
    );
    syncStepButtons(row, input);
  }

  #describeValue(option, value) {
    if (option.type === "range") return formatOptionValue(option, value);
    if (option.type === "checkbox") return value ? "on" : "off";
    if (option.type === "select")
      return (
        option.choices.find(([choice]) => choice === String(value))?.[1] ??
        String(value)
      );
    return String(value);
  }

  #controlHtml(option, value) {
    const id = `${this.#idPrefix}-${option.key}`;
    switch (option.type) {
      case "select":
        return `<select id="${id}" data-setting="${option.key}">${option.choices
          .map(
            ([choice, label]) =>
              `<option value="${escapeHtml(choice)}"${String(value) === choice ? " selected" : ""}>${escapeHtml(label)}</option>`,
          )
          .join("")}</select>`;
      case "range":
        return `<span class="rng" title="Double-click to reset">
          <button type="button" class="step" data-step="-1" aria-label="Decrease ${escapeHtml(option.label)}"${Number(value) <= option.min ? " disabled" : ""}>&minus;</button>
          <input id="${id}" type="range" data-setting="${option.key}" min="${option.min}" max="${option.max}" step="${option.step}" value="${value}">
          <button type="button" class="step" data-step="1" aria-label="Increase ${escapeHtml(option.label)}"${Number(value) >= option.max ? " disabled" : ""}>+</button>
          <output for="${id}">${formatOptionValue(option, value)}</output></span>`;
      case "color":
        return `<input id="${id}" type="color" data-setting="${option.key}" value="${escapeHtml(value)}">`;
      default:
        return `<input id="${id}" type="checkbox" data-setting="${option.key}"${value ? " checked" : ""}>`;
    }
  }

  /** Hide options whose label doesn't match the filter; open every section while filtering. */
  #applyFilter() {
    const needle = this.#filterText.trim().toLowerCase();
    for (const group of this.element.querySelectorAll(".cz-group")) {
      let matches = 0;
      for (const row of group.querySelectorAll(".opt")) {
        const isMatch =
          !needle ||
          row.dataset.label.includes(needle) ||
          group.dataset.group.includes(needle);
        row.hidden = !isMatch;
        if (isMatch) matches++;
      }
      group.hidden = matches === 0;
      group.open = needle ? true : this.#openGroups.has(group.dataset.group);
    }
  }

  #bindEvents() {
    let sliderTimer = 0;
    const commitSoon = (input) => {
      const option = getOptionDefinition(input.dataset.setting);
      const value = Number(input.value);
      this.#updateRangeRow(input, value);
      clearTimeout(sliderTimer);
      sliderTimer = setTimeout(
        () => this.callbacks.onOptionChange(option.key, value, option.redraw),
        option.redraw === Redraw.restyle ? 16 : 140,
      );
    };
    bindRangeSteppers(this.element, ".rng", commitSoon);
    this.element.addEventListener("click", (event) => {
      const resetOne = event.target.closest("[data-reset]");
      if (resetOne) {
        this.callbacks.onReset([resetOne.dataset.reset]);
        return;
      }
      const resetGroup = event.target.closest("[data-reset-group]");
      if (resetGroup) {
        event.preventDefault(); // it sits inside <summary>; don't toggle the section
        const group = this.#groups.find(
          (g) => g.id === resetGroup.dataset.resetGroup,
        );
        this.callbacks.onReset(group.options.map((o) => o.key));
        return;
      }
      if (event.target.closest("[data-reset-all]"))
        this.callbacks.onReset(this.#allOptions.map((o) => o.key));
    });
    // Double-click a slider to reset it (same gesture as the ribbon).
    this.element.addEventListener("dblclick", (event) => {
      if (event.target.closest(".step")) return; // fast −/+ presses aren't a reset
      const input = event.target
        .closest(".rng")
        ?.querySelector("input[data-setting]");
      if (!input || this.#isDefault(input.dataset.setting)) return;
      clearTimeout(sliderTimer);
      this.callbacks.onReset([input.dataset.setting]);
    });
    this.element.addEventListener(
      "toggle",
      (event) => {
        const group = event.target.closest?.(".cz-group");
        if (!group || this.#filterText.trim()) return;
        if (group.open) this.#openGroups.add(group.dataset.group);
        else this.#openGroups.delete(group.dataset.group);
      },
      true,
    );
    this.element.addEventListener("input", (event) => {
      if (event.target.matches(".cz-filter")) {
        this.#filterText = event.target.value;
        this.#applyFilter();
        return;
      }
      const input = event.target.closest("[data-setting]");
      if (!input || (input.type !== "range" && input.type !== "color")) return;
      const option = getOptionDefinition(input.dataset.setting);
      if (input.type === "color") {
        this.callbacks.onOptionChange(option.key, input.value, option.redraw);
        return;
      }
      commitSoon(input);
    });
    // Selects and checkboxes commit on change and may show/hide dependent options.
    this.element.addEventListener("change", (event) => {
      const input = event.target.closest("[data-setting]");
      if (!input || input.type === "range" || input.type === "color") return;
      const option = getOptionDefinition(input.dataset.setting);
      this.callbacks.onOptionChange(
        option.key,
        input.type === "checkbox" ? input.checked : input.value,
        option.redraw,
      );
      this.render();
    });
  }
}
