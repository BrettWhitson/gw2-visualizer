import { PRICE_MAX_AGE_MS } from "../config/constants.js";

const STORE_KEY = "orderBooks";
const STORE_VERSION = 1;
/** Buy orders kept per item: enough to price selling this many (the planner counts up to 1000). */
const UNITS_KEPT = 1000;
/** Saved books beyond this (the least recently fetched) are dropped. */
const MAX_SAVED_BOOKS = 5000;
/** With a finite maxAge(), saved books older than this many maxAges are dropped: they'd be refetched anyway. */
const SAVED_AGE_LIMIT = 10;

/**
 * Buy orders (highest first) per item, from the Trading Post order book, fetched for the ids asked about and, with a
 * `store`, kept in the browser like PriceBook's quotes. Only the top of each book is kept: enough to price selling up
 * up to UNITS_KEPT units. A batch that couldn't be fetched changes nothing: those ids keep the book they had (and its
 * age), so they're asked for again rather than taken for "nobody's buying".
 */
export class OrderBooks {
  /** @type {Map<number, { fetchedAt: number, buys: { unitPrice: number, quantity: number }[] }>} */
  #books = new Map();
  /** @type {Set<number>} ids whose last fetch failed */
  #failed = new Set();
  #restored = null;

  /**
   * @param {{ getBuyOrders(ids: number[], options?: { failedIds?: Set<number> }):
   *           Promise<Map<number, { unitPrice: number, quantity: number }[]>> }} api
   * @param {{ store?: object, maxAge?: () => number, now?: () => number }} [options]
   */
  constructor(
    api,
    { store = null, maxAge = () => PRICE_MAX_AGE_MS, now = Date.now } = {},
  ) {
    this.api = api;
    this.store = store;
    this.maxAge = maxAge;
    this.now = now;
  }

  /** Buy orders for each id (an empty list when nobody's buying), fetching those unknown or stale. */
  async get(itemIds, { force = false } = {}) {
    this.#restored ??= this.#restore();
    await this.#restored;
    const now = this.now(),
      maxAge = this.maxAge();
    const missing = itemIds.filter(
      (id) =>
        force ||
        !(now - (this.#books.get(id)?.fetchedAt ?? -Infinity) < maxAge),
    );
    if (missing.length) {
      const failedIds = new Set();
      const fetched = await this.api.getBuyOrders(missing, { failedIds });
      const fetchedAt = this.now();
      let answered = 0;
      for (const id of missing) {
        if (failedIds.has(id)) {
          this.#failed.add(id); // keep what we had: it's retried on the next request
          continue;
        }
        this.#failed.delete(id);
        this.#books.set(id, { fetchedAt, buys: trim(fetched.get(id) ?? []) });
        answered++;
      }
      if (answered) this.#save();
    }
    return new Map(itemIds.map((id) => [id, this.#books.get(id)?.buys ?? []]));
  }

  /** Whether the last attempt to fetch this id's book failed (a network or server error, not an empty book). */
  fetchFailed(itemId) {
    return this.#failed.has(itemId);
  }

  async #restore() {
    try {
      const saved = await this.store?.get(STORE_KEY);
      if (saved?.version !== STORE_VERSION) return;
      for (const [id, fetchedAt, buys] of saved.books)
        this.#books.set(id, { fetchedAt, buys });
    } catch {
      /* unavailable or corrupt: start empty */
    }
  }

  /** Save the newest MAX_SAVED_BOOKS books, leaving out any too old to be used again. */
  async #save() {
    if (!this.store) return;
    const maxAge = this.maxAge();
    const oldest = Number.isFinite(maxAge)
      ? this.now() - SAVED_AGE_LIMIT * maxAge
      : -Infinity;
    const books = [...this.#books]
      .filter(([, book]) => book.fetchedAt >= oldest)
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, MAX_SAVED_BOOKS)
      .map(([id, book]) => [id, book.fetchedAt, book.buys]);
    try {
      await this.store.set(STORE_KEY, { version: STORE_VERSION, books });
    } catch {
      /* quota or private mode: works without it */
    }
  }
}

/** The top of a book: orders until UNITS_KEPT units are covered. */
function trim(buys) {
  const kept = [];
  let units = 0;
  for (const order of buys) {
    if (units >= UNITS_KEPT) break;
    kept.push(order);
    units += order.quantity;
  }
  return kept;
}
