import { PRICE_MAX_AGE_MS } from "../config/constants.js";

/**
 * Trading post prices, fetched lazily for whatever is on screen. Quotes older than PRICE_MAX_AGE_MS are refetched on
 * the next request, and concurrent requests for the same ids share one fetch.
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

  constructor(apiClient) {
    this.api = apiClient;
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

  /**
   * Fetch any ids that are unknown or stale, and wait for ids already being fetched.
   * @returns {Promise<boolean>} true when new prices arrived (so costs should be recomputed)
   */
  async ensure(itemIds) {
    const now = Date.now(),
      waits = new Set(),
      missing = [];
    for (const id of itemIds) {
      const pending = this.#pending.get(id);
      if (pending) waits.add(pending);
      else if (
        !(now - (this.#fetchedAt.get(id) ?? -Infinity) < PRICE_MAX_AGE_MS)
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
        const fetchedAt = Date.now();
        for (const id of ids) {
          this.#fetchedAt.set(id, fetchedAt);
          if (!this.#quotes.has(id)) this.#quotes.set(id, null); // not in the response → not tradeable
        }
        for (const quote of quotes)
          this.#quotes.set(quote.id, { buy: quote.buy, sell: quote.sell });
        this.#lastUpdatedAt = fetchedAt;
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

  /** Forget every quote so the next request refetches (keeps showing nothing stale in the meantime). */
  clear() {
    this.#quotes.clear();
    this.#fetchedAt.clear();
    this.#lastUpdatedAt = 0;
  }
}
