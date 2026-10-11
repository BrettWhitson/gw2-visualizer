/** @type {WeakMap<import('../core/settings-store.js').SettingsStore, { values: object }>} */
const mirrors = new WeakMap();

/**
 * A SettingsStore's values as Svelte state, so components read `settings.values.direction` and update on their own
 * when any setting changes. The store stays the source of truth (saving, presets, migrations); this only follows it,
 * one mirror per store. `values` is replaced on each change, never edited in place: write through the store.
 * @param {import('../core/settings-store.js').SettingsStore} store
 * @returns {{ readonly values: typeof store.values }}
 */
export function reactiveSettings(store) {
  let mirror = mirrors.get(store);
  if (!mirror) {
    const state = $state({ values: { ...store.values } });
    store.onChange(() => (state.values = { ...store.values }));
    mirror = {
      get values() {
        return state.values;
      },
    };
    mirrors.set(store, mirror);
  }
  return mirror;
}
