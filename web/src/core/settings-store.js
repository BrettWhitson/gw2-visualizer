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
  constructor() {
    /** @type {typeof DEFAULT_SETTINGS} */
    this.values = { ...DEFAULT_SETTINGS, ...this.#readSaved() };
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    this.save();
  }

  /** Apply a layout or style preset: its slice of the look goes back to defaults + the preset's values. */
  applyPreset(kind, presetName) {
    const { keys, presets } = PRESET_KINDS[kind];
    for (const key of keys) this.values[key] = DEFAULT_SETTINGS[key];
    Object.assign(this.values, presets[presetName]?.values);
    this.save();
  }

  /** Restore the given keys to their defaults. */
  reset(keys) {
    for (const key of keys) this.values[key] = DEFAULT_SETTINGS[key];
    this.save();
  }

  isDefault(key) {
    return this.values[key] === DEFAULT_SETTINGS[key];
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
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
