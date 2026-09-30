import { PRICE_MAX_AGE_MS } from "../config/constants.js";

const STORE_KEY = "prices";
const STORE_VERSION = 1;
/** Saved quotes beyond this (the least recently fetched) are dropped. */
const MAX_SAVED_QUOTES = 30000;
const SAVE_DELAY_MS = 1000;

/**
 * Trading post prices, fetched lazily for whatever is on screen. Quotes older than `maxAge()` are refetched on the next
 * request, and concurrent requests for the same ids share one fetch. With a `store`, quotes are also kept in the
 * browser and restored on the next visit, so a page can open on saved prices (see core/data-preferences.js).
 * A `null` quote means "fetched, but not tradeable".
 */
export class PriceBook {
  /** @type {Map<number, { buy: number, sell: number } | null>} */
  #quotes = new Map();
  /** @type {Map<number, number>} when each id was last fetched */
  #fetchedAt = new Map();
  /** @type {Map<number, Promise<void>>} fetches in flight, by id */
  #pending = new Map();
  #lastUpdatedAt = 0;
  #restored = null;
  #saveTimer = 0;

  /**
   * @param {{ store?: { get(key: string): Promise<any>, set(key: string, value: any): Promise<void> },
   *           maxAge?: () => number, now?: () => number }} [options]
   *   maxAge: how old a quote may be before it's refetched (Infinity: only when refreshed)
   */
  constructor(
    apiClient,
    { store = null, maxAge = () => PRICE_MAX_AGE_MS, now = Date.now } = {},
  ) {
    this.api = apiClient;
    this.store = store;
    this.maxAge = maxAge;
    this.now = now;
    // A save waiting on its debounce would be lost when the page goes away: write it now.
    if (store)
      globalThis.addEventListener?.("pagehide", () => {
        if (!this.#saveTimer) return;
        clearTimeout(this.#saveTimer);
        this.#saveTimer = 0;
        this.#save();
      });
  }

  /** Number of items with a known price. */
  get size() {
    let count = 0;
    for (const quote of this.#quotes.values()) if (quote) count++;
    return count;
  }

  /** When prices last arrived (ms since epoch), or 0. */
  get lastUpdatedAt() {
    return this.#lastUpdatedAt;
  }

  /** When the oldest of these prices was fetched (ms since epoch), or null if none are known. */
  oldestFetchedAt(itemIds) {
    let oldest = Infinity;
    for (const id of itemIds) {
      const at = this.#fetchedAt.get(id);
      if (at != null && at < oldest) oldest = at;
    }
    return oldest === Infinity ? null : oldest;
  }

  /** Saved prices are loaded (safe to call repeatedly). */
  ready() {
    this.#restored ??= this.#restore();
    return this.#restored;
  }

  /**
   * Fetch any ids that are unknown or stale, and wait for ids already being fetched.
   * @param {{ force?: boolean }} [options]  force: refetch even fresh quotes (a Refresh)
   * @returns {Promise<boolean>} true when new prices arrived (so costs should be recomputed)
   */
  async ensure(itemIds, { force = false } = {}) {
    await this.ready();
    const now = this.now(),
      maxAge = this.maxAge(),
      waits = new Set(),
      missing = [];
    for (const id of itemIds) {
      const pending = this.#pending.get(id);
      if (pending) waits.add(pending);
      else if (
        force ||
        !(now - (this.#fetchedAt.get(id) ?? -Infinity) < maxAge)
      )
        missing.push(id);
    }
    if (missing.length) waits.add(this.#fetch(missing));
    if (!waits.size) return false;
    await Promise.all(waits);
    return true;
  }

  #fetch(ids) {
    const request = this.api
      .getPrices(ids)
      .then((quotes) => {
        const fetchedAt = this.now();
        for (const id of ids) {
          this.#fetchedAt.set(id, fetchedAt);
          this.#quotes.set(id, null); // not in the response → not tradeable
        }
        for (const quote of quotes)
          this.#quotes.set(quote.id, { buy: quote.buy, sell: quote.sell });
        this.#lastUpdatedAt = fetchedAt;
        this.#scheduleSave();
      })
      .finally(() => {
        for (const id of ids)
          if (this.#pending.get(id) === request) this.#pending.delete(id);
      });
    for (const id of ids) this.#pending.set(id, request);
    return request;
  }

  /** Whether a price lookup has been attempted for this id. */
  has(itemId) {
    return this.#quotes.has(itemId);
  }

  getQuote(itemId) {
    return this.#quotes.get(itemId) ?? null;
  }

  /**
   * Unit price in copper for the chosen basis, falling back to the other side of the book when one is empty.
   * @param {'sell' | 'buy' | 'off'} basis
   */
  getUnitPrice(itemId, basis) {
    const quote = this.#quotes.get(itemId);
    if (!quote || basis === "off") return null;
    return (
      (basis === "buy" ? quote.buy || quote.sell : quote.sell || quote.buy) ||
      null
    );
  }

  /**
   * Forget every quote, saved ones included, so the next request refetches (a new game build, or cleared caches).
   * To refetch some prices while keeping the rest, use ensure(ids, { force: true }).
   */
  clear() {
    this.#restored = Promise.resolve(); // nothing to restore any more
    this.#quotes.clear();
    this.#fetchedAt.clear();
    this.#lastUpdatedAt = 0;
    this.#scheduleSave();
  }

  async #restore() {
    try {
      const saved = await this.store?.get(STORE_KEY);
      if (saved?.version !== STORE_VERSION) return;
      for (const [id, fetchedAt, buy, sell] of saved.quotes) {
        if (this.#fetchedAt.has(id)) continue; // fetched while restoring: newer
        this.#fetchedAt.set(id, fetchedAt);
        this.#quotes.set(id, buy == null ? null : { buy, sell });
        if (fetchedAt > this.#lastUpdatedAt) this.#lastUpdatedAt = fetchedAt;
      }
    } catch {
      /* unavailable or corrupt: start empty */
    }
  }

  #scheduleSave() {
    if (!this.store) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = 0;
      this.#save();
    }, SAVE_DELAY_MS);
  }

  async #save() {
    const quotes = [...this.#fetchedAt]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SAVED_QUOTES)
      .map(([id, fetchedAt]) => {
        const quote = this.#quotes.get(id);
        return [id, fetchedAt, quote?.buy ?? null, quote?.sell ?? null];
      });
    try {
      await this.store.set(STORE_KEY, { version: STORE_VERSION, quotes });
    } catch {
      /* quota or private mode: works without it */
    }
  }
}
