import { PRICE_MAX_AGE_MS } from "../config/constants.js";

const STORE_KEY = "orderBooks";
const STORE_VERSION = 1;
/** Buy orders kept per item: enough to price selling this many (the planner counts up to 1000). */
const UNITS_KEPT = 1000;

/**
 * Buy orders (highest first) per item, from the Trading Post order book, fetched for the ids asked about and, with a
 * `store`, kept in the browser like PriceBook's quotes. Only the top of each book is kept: enough to price selling up
 * to UNITS_KEPT units.
 */
export class OrderBooks {
  /** @type {Map<number, { fetchedAt: number, buys: { unitPrice: number, quantity: number }[] }>} */
  #books = new Map();
  #restored = null;

  /**
   * @param {{ getBuyOrders(ids: number[]): Promise<Map<number, { unitPrice: number, quantity: number }[]>> }} api
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
      const fetched = await this.api.getBuyOrders(missing);
      const fetchedAt = this.now();
      for (const id of missing)
        this.#books.set(id, { fetchedAt, buys: trim(fetched.get(id) ?? []) });
      this.#save();
    }
    return new Map(itemIds.map((id) => [id, this.#books.get(id)?.buys ?? []]));
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

  async #save() {
    if (!this.store) return;
    try {
      await this.store.set(STORE_KEY, {
        version: STORE_VERSION,
        books: [...this.#books].map(([id, book]) => [
          id,
          book.fetchedAt,
          book.buys,
        ]),
      });
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
