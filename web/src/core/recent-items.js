const STORAGE_KEY = "gw2ct.recent";
const MAX_RECENT_ITEMS = 8;

/** Recently opened root items (most recent first), kept in localStorage for the search box and the start screen. */
export class RecentItems {
  /** @type {number[]} */
  #itemIds = [];

  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved))
        this.#itemIds = saved
          .filter(Number.isInteger)
          .slice(0, MAX_RECENT_ITEMS);
    } catch {
      /* corrupt or unavailable storage → empty */
    }
  }

  /** @returns {number[]} */
  get itemIds() {
    return [...this.#itemIds];
  }

  add(itemId) {
    this.#itemIds = [
      itemId,
      ...this.#itemIds.filter((id) => id !== itemId),
    ].slice(0, MAX_RECENT_ITEMS);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.#itemIds));
    } catch {
      /* private mode */
    }
  }
}
