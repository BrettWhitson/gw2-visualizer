import {
  DEFAULT_SETTINGS,
  LEGACY_SETTING_KEYS,
  PRESET_KINDS,
  migrateLegacySettings,
} from "../config/settings-schema.js";

const STORAGE_KEY = "gw2ct.settings.v2";
const LEGACY_STORAGE_KEY = "gw2ct.settings";

/**
 * Persistent view settings backed by localStorage.
 * `values` is a plain object so hot paths (stylesheet, layout) can read it without getter overhead.
 * (Storage keys keep their original "gw2ct" prefix so existing users' settings carry over.)
 */
export class SettingsStore {
  #listeners = new Set();
  /** Keys changed for this visit only (setMany persist: false) → the value to save instead. */
  #visitOnly = new Map();

  constructor() {
    /** @type {typeof DEFAULT_SETTINGS} */
    this.values = { ...DEFAULT_SETTINGS, ...this.#readSaved() };
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    this.#visitOnly.delete(key);
    this.save();
    this.#changed([key]);
  }

  /**
   * Change several settings at once, with one notification.
   * @param {Partial<typeof DEFAULT_SETTINGS>} patch
   * @param {{ persist?: boolean }} [options]  persist: false keeps the change to this visit (not saved)
   */
  setMany(patch, { persist = true } = {}) {
    for (const key of Object.keys(patch)) {
      if (persist) this.#visitOnly.delete(key);
      else if (!this.#visitOnly.has(key))
        this.#visitOnly.set(key, this.values[key]);
    }
    Object.assign(this.values, patch);
    if (persist) this.save();
    this.#changed(Object.keys(patch));
  }

  /**
   * Hear about every change: `listener({ keys })` with the keys that changed; returns a function that unsubscribes.
   * The values are written before listeners run. A listener that throws is reported and doesn't stop the others.
   * @param {(change: { keys: string[] }) => void} listener
   */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(keys) {
    if (!keys.length) return;
    for (const listener of [...this.#listeners]) {
      try {
        listener({ keys });
      } catch (error) {
        console.error("Error in a settings listener:", error);
      }
    }
  }

  /** Apply a layout or style preset: its slice of the look goes back to defaults + the preset's values. */
  applyPreset(kind, presetName) {
    const { keys, presets } = PRESET_KINDS[kind];
    for (const key of keys) this.values[key] = DEFAULT_SETTINGS[key];
    const values = presets[presetName]?.values ?? {};
    Object.assign(this.values, values);
    for (const key of [...keys, ...Object.keys(values)])
      this.#visitOnly.delete(key);
    this.save();
    this.#changed([...new Set([...keys, ...Object.keys(values)])]);
  }

  /** Restore the given keys to their defaults. */
  reset(keys) {
    for (const key of keys) {
      this.values[key] = DEFAULT_SETTINGS[key];
      this.#visitOnly.delete(key);
    }
    this.save();
    this.#changed([...keys]);
  }

  isDefault(key) {
    return this.values[key] === DEFAULT_SETTINGS[key];
  }

  save() {
    try {
      const saved = { ...this.values };
      for (const [key, value] of this.#visitOnly) saved[key] = value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable (private mode) */
    }
  }

  #readSaved() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current)
        return this.#onlyKnownKeys(migrateLegacySettings(JSON.parse(current)));
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy)
        return this.#onlyKnownKeys(
          migrateLegacySettings(this.#renameLegacyKeys(JSON.parse(legacy))),
        );
    } catch {
      /* corrupt or unavailable storage → defaults */
    }
    return {};
  }

  #renameLegacyKeys(saved) {
    return Object.fromEntries(
      Object.entries(saved).map(([key, value]) => [
        LEGACY_SETTING_KEYS[key] ?? key,
        value,
      ]),
    );
  }

  #onlyKnownKeys(saved) {
    return Object.fromEntries(
      Object.entries(saved).filter(([key]) => key in DEFAULT_SETTINGS),
    );
  }
}
