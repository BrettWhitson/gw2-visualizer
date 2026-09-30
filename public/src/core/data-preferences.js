const STORAGE_KEY = "gw2ct.dataUpdates";

/**
 * When account data and Trading Post prices are fetched again. "manual" (the default): what was saved is used until
 * you press Refresh, so pages open without waiting on the API. "auto": saved data shows at once and anything older
 * than a few minutes is refreshed in the background.
 */
export const DataUpdates = Object.freeze({ manual: "manual", auto: "auto" });

export function getDataUpdates(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(STORAGE_KEY) === DataUpdates.auto
      ? DataUpdates.auto
      : DataUpdates.manual;
  } catch {
    return DataUpdates.manual; // storage blocked
  }
}

export function setDataUpdates(mode, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode: this page only */
  }
}

/** How old saved data may be before it's refetched without being asked: never, in manual mode. */
export const maxAgeFor = (autoMaxAgeMs, storage = globalThis.localStorage) =>
  getDataUpdates(storage) === DataUpdates.auto ? autoMaxAgeMs : Infinity;
