import { WIKI_API_URL, WIKI_SOURCES_MAX_AGE_MS } from "../config/constants.js";
import { sleep } from "../utils/async.js";

/** Pause between wiki requests from this browser (the wiki is a shared, volunteer-run resource). */
const REQUEST_SPACING_MS = 400;
const MAX_ROWS_PER_QUERY = 50;
const CACHE_KEY_PREFIX = "wikiSources:";

/**
 * Where an item comes from beyond recipes and the trading post (vendors and containers), looked up on demand from the
 * Guild Wars 2 Wiki's Semantic MediaWiki API when someone opens the item's details.
 *
 * Etiquette: one request at a time with a pause, `maxlag=5` (back off when the wiki is busy), results cached in
 * IndexedDB for a week so repeat views never hit the wiki, and a failed lookup is not retried for the rest of the
 * session. Requests are plain anonymous GETs: the wiki's CORS setup rejects preflighted requests, so the
 * `Api-User-Agent` header can't be sent. Lookups go by game id (`Has game id`), so items sharing a name resolve
 * correctly.
 *
 * @typedef {{ vendor: string, location: string | null, quantity: number, costs: { value: string, currency: string }[] }} VendorOffer
 * @typedef {{ vendors: VendorOffer[], historicalVendorCount: number, containers: string[], fetchedAt: number }} ItemSources
 */
export class WikiSources {
  /** @type {Map<number, ItemSources | null>} null = the lookup failed this session (don't retry) */
  #known = new Map();
  /** @type {Map<number, Promise<ItemSources | null>>} */
  #pending = new Map();
  #queue = Promise.resolve();

  /** @param {{ cache: import('./indexed-db-store.js').IndexedDbStore }} deps */
  constructor({ cache }) {
    this.cache = cache;
  }

  /** Sources already known for this item (no request): undefined = not looked up yet, null = unavailable. */
  peek(itemId) {
    return this.#known.get(itemId);
  }

  /**
   * Sources for an item: from memory, then IndexedDB, then the wiki. Resolves null when the wiki can't be reached.
   * @returns {Promise<ItemSources | null>}
   */
  load(itemId) {
    if (this.#known.has(itemId))
      return Promise.resolve(this.#known.get(itemId));
    if (!this.#pending.has(itemId)) {
      const request = this.#loadUncached(itemId).finally(() =>
        this.#pending.delete(itemId),
      );
      this.#pending.set(itemId, request);
    }
    return this.#pending.get(itemId);
  }

  async #loadUncached(itemId) {
    try {
      const cached = await this.cache.get(CACHE_KEY_PREFIX + itemId);
      if (cached && Date.now() - cached.fetchedAt < WIKI_SOURCES_MAX_AGE_MS) {
        this.#known.set(itemId, cached);
        return cached;
      }
    } catch {
      /* no cache → ask the wiki */
    }
    try {
      const sources = await this.#enqueue(() => this.#fetchSources(itemId));
      this.#known.set(itemId, sources);
      this.cache.set(CACHE_KEY_PREFIX + itemId, sources).catch(() => {});
      return sources;
    } catch (error) {
      console.warn(`Wiki sources for item ${itemId} unavailable`, error);
      this.#known.set(itemId, null); // remembered, so re-renders don't retry (and hammer the wiki)
      return null;
    }
  }

  /** Run wiki requests one after another, spaced out. */
  #enqueue(task) {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => {}).then(() => sleep(REQUEST_SPACING_MS));
    return run;
  }

  async #fetchSources(itemId) {
    const vendorRows = await this.#ask(
      `[[Sells item.Has game id::${itemId}]]|?Has vendor|?Has item cost|?Has item quantity|?Located in|limit=${MAX_ROWS_PER_QUERY}`,
    );
    await sleep(REQUEST_SPACING_MS);
    const containerRows = await this.#ask(
      `[[Contains item.Has game id::${itemId}]]|limit=${MAX_ROWS_PER_QUERY}`,
    );

    const vendors = [];
    let historicalVendorCount = 0;
    for (const row of Object.values(vendorRows)) {
      const vendor =
        row.printouts["Has vendor"]?.[0]?.fulltext ?? pageOf(row.fulltext);
      if (vendor.endsWith("/historical")) {
        historicalVendorCount++;
        continue;
      }
      vendors.push({
        vendor,
        location: row.printouts["Located in"]?.[0]?.fulltext ?? null,
        quantity: row.printouts["Has item quantity"]?.[0] ?? 1,
        costs: (row.printouts["Has item cost"] ?? []).map((cost) => ({
          value: cost["Has item value"]?.item?.[0] ?? "?",
          currency: cost["Has item currency"]?.item?.[0] ?? "?",
        })),
      });
    }
    const containers = [
      ...new Set(
        Object.values(containerRows).map((row) => pageOf(row.fulltext)),
      ),
    ].sort((a, b) => a.localeCompare(b));
    return {
      vendors,
      historicalVendorCount,
      containers,
      fetchedAt: Date.now(),
    };
  }

  /** One Semantic MediaWiki `ask` query; retries once when the wiki reports lag. */
  async #ask(query, attempt = 0) {
    const url = `${WIKI_API_URL}?${new URLSearchParams({
      action: "ask",
      query,
      format: "json",
      formatversion: "2",
      maxlag: "5",
      origin: "*", // anonymous CORS
    })}`;
    const response = await fetch(url);
    const body = await response.json();
    if (body.error?.code === "maxlag" && attempt < 1) {
      await sleep((Number(response.headers.get("Retry-After")) || 5) * 1000);
      return this.#ask(query, attempt + 1);
    }
    if (body.error) throw new Error(body.error.info || body.error.code);
    return body.query?.results ?? {};
  }
}

/** "Bag of Mystic Coins (fine)#contains1" → "Bag of Mystic Coins (fine)". */
function pageOf(subjectName) {
  return subjectName.split("#")[0];
}
