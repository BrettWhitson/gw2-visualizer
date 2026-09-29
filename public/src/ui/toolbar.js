import {
  DEFAULT_SETTINGS,
  PATH_MODES,
  PRESET_KINDS,
  Redraw,
  findMatchingPreset,
  formatOptionValue,
  getOptionDefinition,
} from "../config/settings-schema.js";
import { escapeHtml, querySelectorAll } from "../utils/dom.js";
import { bindRangeSteppers, syncStepButtons } from "./range-stepper.js";

/** Debounce for slider commits: style-only changes feel live, re-layouts wait for the drag to settle. */
const COMMIT_DELAY_MS = { [Redraw.restyle]: 16, default: 140 };

/**
 * The ribbon under the search bar. Every row is a `.rctl`: a label plus one control bound with `data-setting="<key>"`
 * (segmented buttons, a select, checkbox pills, or a range slider flanked by − / + step buttons and an `<output>`).
 * Ranges, labels and redraw levels come from the settings schema, so the ribbon and Customize always agree.
 *
 *  - − / + nudge a slider by one step; hold to repeat.
 *  - Double-clicking a row resets it to its default (a preset row resets to Standard). Pills are excluded.
 *  - `data-preset-select="layout|style"` selects apply a preset of that kind and show "Custom" when nothing matches.
 *  - Each section's caption has ↺ (reset the section) and ⌄ (its popout of further options; see RibbonPopout).
 */
export class Toolbar {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/settings-store.js').SettingsStore} settings
   * @param {{ onSettingChange(key: string, value: unknown, redraw: string): void,
   *           onPreset(kind: string, name: string): void, onSectionReset(sectionId: string): void,
   *           onSectionToggle(sectionId: string, button: HTMLElement): void }} callbacks
   */
  constructor(root, settings, callbacks) {
    this.root = root;
    this.settings = settings;
    this.callbacks = callbacks;
    this.presetSelects = querySelectorAll("[data-preset-select]", root);
    this.#fillChoices();
    this.#configureControls();
    this.#bindEvents();
  }

  /** Reflect current settings in every control. */
  sync() {
    const values = this.settings.values;
    for (const group of querySelectorAll(".seg[data-setting]", this.root)) {
      for (const button of group.querySelectorAll("button")) {
        const isOn =
          button.dataset.value === String(values[group.dataset.setting]);
        button.classList.toggle("on", isOn);
        button.setAttribute("aria-pressed", String(isOn));
      }
    }
    for (const input of querySelectorAll(
      "input[data-setting], select[data-setting]",
      this.root,
    )) {
      const value = values[input.dataset.setting];
      if (input.type === "checkbox") input.checked = !!value;
      else if (document.activeElement !== input) input.value = String(value);
      if (input.type === "range") this.#updateRangeRow(input, value);
    }
    for (const select of this.presetSelects) this.#syncPreset(select);

    // Force-directed layouts have no direction, so the arrows can't do anything there.
    const isDirectionless = values.layoutEngine === "force";
    for (const button of querySelectorAll(
      '.seg[data-setting="direction"] button',
      this.root,
    ))
      button.disabled = isDirectionless;
    const pathSelect = this.root.querySelector("[data-path-select]");
    if (pathSelect) pathSelect.title = PATH_MODES[values.pathMode]?.hint ?? "";
  }

  setCollapsed(isCollapsed) {
    this.root.hidden = isCollapsed;
  }

  /** A preset select shows the preset its slice of the settings matches, or "Custom". */
  #syncPreset(select) {
    const kind = select.dataset.presetSelect;
    const active = findMatchingPreset(this.settings.values, kind);
    select.value = active ?? "";
    select.title = active
      ? PRESET_KINDS[kind].presets[active].description
      : `Custom ${kind} (changed in Customize)`;
  }

  /** Options that come from the schema rather than the HTML. */
  #fillChoices() {
    for (const select of this.presetSelects) {
      const { presets } = PRESET_KINDS[select.dataset.presetSelect];
      select.innerHTML =
        '<option value="" hidden>Custom</option>' +
        Object.entries(presets)
          .map(
            ([name, preset]) =>
              `<option value="${escapeHtml(name)}" title="${escapeHtml(preset.description)}">${escapeHtml(name)}</option>`,
          )
          .join("");
    }
    const pathSelect = this.root.querySelector("[data-path-select]");
    if (pathSelect) {
      pathSelect.innerHTML = Object.entries(PATH_MODES)
        .map(
          ([mode, { label, hint }]) =>
            `<option value="${mode}" title="${escapeHtml(hint)}">${escapeHtml(label)}</option>`,
        )
        .join("");
    }
  }

  /** Slider bounds come from the schema; every resettable row's tooltip names its default. */
  #configureControls() {
    for (const input of querySelectorAll(
      "input[type=range][data-setting]",
      this.root,
    )) {
      const option = getOptionDefinition(input.dataset.setting);
      if (option)
        Object.assign(input, {
          min: option.min,
          max: option.max,
          step: option.step,
        });
    }
    for (const row of querySelectorAll(".rctl", this.root)) {
      const preset = row.querySelector("[data-preset-select]");
      if (preset) {
        row.title = `${PRESET_KINDS[preset.dataset.presetSelect].label} preset\nDouble-click to reset (Standard)`;
        continue;
      }
      const key = this.#settingKeyOf(row);
      const option = getOptionDefinition(key);
      if (!option || row.querySelector(".pill")) continue;
      const existing = row.querySelector("[title]")?.title;
      row.title = `${existing ? `${existing}\n` : ""}Double-click to reset (default: ${this.#describeDefault(row, key, option)})`;
    }
  }

  #settingKeyOf(row) {
    return row.querySelector("[data-setting]")?.dataset.setting;
  }

  #describeDefault(row, key, option) {
    const value = DEFAULT_SETTINGS[key];
    if (option.type === "range") return formatOptionValue(option, value);
    const choice = row.querySelector(
      `option[value="${value}"], button[data-value="${value}"]`,
    );
    return (
      choice?.getAttribute("aria-label") ||
      choice?.textContent.trim() ||
      String(value)
    );
  }

  /** Brief highlight so a double-click reset is noticeable. */
  #flash(row) {
    row.classList.remove("was-reset");
    void row.offsetWidth; // restart the animation
    row.classList.add("was-reset");
  }

  /** Readout text, plus −/+ disabled at the ends of the range. */
  #updateRangeRow(input, value) {
    const key = input.dataset.setting;
    const row = input.closest(".rctl");
    const output = row?.querySelector("output");
    if (output)
      output.textContent = formatOptionValue(getOptionDefinition(key), value);
    if (row) syncStepButtons(row, input);
  }

  #bindEvents() {
    let commitTimer = 0;
    const emit = (key, value) =>
      this.callbacks.onSettingChange(
        key,
        value,
        getOptionDefinition(key)?.redraw ?? Redraw.fit,
      );
    const commitSoon = (input) => {
      const key = input.dataset.setting;
      clearTimeout(commitTimer);
      const delay =
        COMMIT_DELAY_MS[getOptionDefinition(key)?.redraw] ??
        COMMIT_DELAY_MS.default;
      commitTimer = setTimeout(() => emit(key, Number(input.value)), delay);
    };
    bindRangeSteppers(this.root, ".rctl.num", commitSoon);

    this.root.addEventListener("click", (event) => {
      if (event.target.closest(".step")) return; // handled by bindRangeSteppers
      // Section caption: ↺ resets the section, ⌄ opens its popout of further options.
      const reset = event.target.closest("[data-section-reset]");
      if (reset) {
        this.#flash(reset.closest(".rgroup"));
        this.callbacks.onSectionReset(reset.dataset.sectionReset);
        return;
      }
      const toggle = event.target.closest("[data-section-toggle]");
      if (toggle) {
        this.callbacks.onSectionToggle(toggle.dataset.sectionToggle, toggle);
        return;
      }
      const segmentButton = event.target.closest(".seg[data-setting] button");
      if (segmentButton)
        emit(
          segmentButton.parentElement.dataset.setting,
          segmentButton.dataset.value,
        );
    });
    this.root.addEventListener("input", (event) => {
      const input = event.target.closest("input[type=range][data-setting]");
      if (!input) return;
      this.#updateRangeRow(input, input.value);
      commitSoon(input);
    });
    this.root.addEventListener("dblclick", (event) => {
      if (event.target.closest(".step, .pill")) return; // steppers and pills keep their own meaning
      const row = event.target.closest(".rctl");
      if (!row) return;
      const preset = row.querySelector("[data-preset-select]");
      if (preset) {
        this.#flash(row);
        this.callbacks.onPreset(preset.dataset.presetSelect, "Standard");
        return;
      }
      const key = this.#settingKeyOf(row);
      if (!key || !(key in DEFAULT_SETTINGS)) return;
      clearTimeout(commitTimer); // a pending slider commit must not overwrite the reset
      this.#flash(row);
      if (this.settings.values[key] !== DEFAULT_SETTINGS[key])
        emit(key, DEFAULT_SETTINGS[key]);
    });
    this.root.addEventListener("change", (event) => {
      const preset = event.target.closest("[data-preset-select]");
      if (preset) {
        if (preset.value)
          this.callbacks.onPreset(preset.dataset.presetSelect, preset.value);
        return;
      }
      const input = event.target.closest(
        "select[data-setting], input[type=checkbox][data-setting]",
      );
      if (!input) return;
      emit(
        input.dataset.setting,
        input.type === "checkbox" ? input.checked : input.value,
      );
    });
  }
}
