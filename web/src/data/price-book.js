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
 * A `null` quote means "fetched, but not tradeable". A batch that couldn't be fetched changes nothing: those ids keep
 * the quote they had (and its age), so they're asked for again rather than taken for untradeable.
 */
export class PriceBook {
  /** @type {Map<number, { buy: number, sell: number } | null>} */
  #quotes = new Map();
  /** @type {Map<number, number>} when each id was last fetched */
  #fetchedAt = new Map();
  /** @type {Map<number, Promise<void>>} fetches in flight, by id */
  #pending = new Map();
  /** @type {Set<number>} ids whose last fetch failed */
  #failed = new Set();
  #lastUpdatedAt = 0;
  #restored = null;
  #saveTimer = 0;
  /** clear() was called: the next save replaces the saved copy instead of merging with it */
  #cleared = false;
  /** The stored quotes as last read or written, so a save while the page goes away can merge without a read. */
  #storedQuotes = [];
  #onPageHide = null;

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
    if (store) {
      this.#onPageHide = () => {
        if (!this.#saveTimer) return;
        clearTimeout(this.#saveTimer);
        this.#saveTimer = 0;
        // No awaited read first: the page may be gone before it answers. Merge with what was last seen instead.
        this.#write(this.#cleared ? [] : this.#storedQuotes);
      };
      globalThis.addEventListener?.("pagehide", this.#onPageHide);
    }
  }

  /** Stop listening for the page going away (a book that's no longer used); a pending save is written now. */
  dispose() {
    if (!this.#onPageHide) return;
    this.#onPageHide();
    globalThis.removeEventListener?.("pagehide", this.#onPageHide);
    this.#onPageHide = null;
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
   * @returns {Promise<boolean>} true when prices for these ids arrived, from the API or restored from storage by this
   *   call (so costs should be recomputed)
   */
  async ensure(itemIds, { force = false } = {}) {
    itemIds = [...itemIds];
    const knownBefore = itemIds.filter((id) => this.#fetchedAt.has(id));
    await this.ready();
    const restored =
      knownBefore.length <
      itemIds.filter((id) => this.#fetchedAt.has(id)).length;
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
    if (!waits.size) return restored;
    await Promise.all(waits);
    return true;
  }

  #fetch(ids) {
    const failedIds = new Set();
    const request = this.api
      .getPrices(ids, { failedIds })
      .then((quotes) => {
        const fetchedAt = this.now();
        let answered = 0;
        for (const id of ids) {
          if (failedIds.has(id)) {
            this.#failed.add(id); // keep what we had: it's retried on the next request
            continue;
          }
          this.#failed.delete(id);
          this.#fetchedAt.set(id, fetchedAt);
          this.#quotes.set(id, null); // not in a response that came → not tradeable
          answered++;
        }
        for (const quote of quotes)
          this.#quotes.set(quote.id, { buy: quote.buy, sell: quote.sell });
        if (!answered) return;
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

  /** Whether the last attempt to fetch this id's price failed (a network or server error, not "untradeable"). */
  fetchFailed(itemId) {
    return this.#failed.has(itemId);
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
    this.#failed.clear();
    this.#lastUpdatedAt = 0;
    this.#cleared = true;
    this.#scheduleSave();
  }

  async #restore() {
    try {
      const saved = await this.store?.get(STORE_KEY);
      if (saved?.version !== STORE_VERSION) return;
      this.#storedQuotes = saved.quotes;
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

  /**
   * Save the quotes, merged with the saved copy so another tab's newer prices aren't overwritten: the newest fetch of
   * each id wins. After clear(), the saved copy is replaced instead.
   */
  async #save() {
    let stored = [];
    if (!this.#cleared)
      try {
        const saved = await this.store.get(STORE_KEY);
        if (saved?.version === STORE_VERSION) stored = saved.quotes;
      } catch {
        /* unavailable or corrupt: save ours alone */
      }
    await this.#write(stored);
  }

  /**
   * Write ours merged with `stored` (another tab's quotes win where newer), newest first, capped. Starts the write at
   * once (the page-hide path can't wait for anything).
   * @param {[number, number, number | null, number | null][]} stored
   */
  #write(stored) {
    this.#cleared = false;
    /** @type {Map<number, [number, number, number | null, number | null]>} id → saved entry */
    const merged = new Map(stored.map((entry) => [entry[0], entry]));
    for (const [id, fetchedAt] of this.#fetchedAt) {
      if (merged.get(id)?.[1] > fetchedAt) continue; // another tab has a newer one
      const quote = this.#quotes.get(id);
      merged.set(id, [id, fetchedAt, quote?.buy ?? null, quote?.sell ?? null]);
    }
    const quotes = [...merged.values()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SAVED_QUOTES);
    this.#storedQuotes = quotes;
    try {
      return Promise.resolve(
        this.store.set(STORE_KEY, { version: STORE_VERSION, quotes }),
      ).catch(() => {
        /* quota or private mode: works without it */
      });
    } catch {
      return Promise.resolve();
    }
  }
}
