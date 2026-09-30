import { Gw2ApiClient } from "./gw2-api-client.js";
import { referencedIds } from "../model/character-armory.js";

/** API key permissions the character view reads; `account` is always granted. */
export const CHARACTER_SCOPES = ["characters", "builds"];
/** Permissions the account inventory reads (bank, materials, shared slots, bags, wallet, Trading Post pickup). */
export const INVENTORY_SCOPES = [
  "inventories",
  "characters",
  "wallet",
  "tradingpost",
];

/** GW2 keys are two hyphenated GUIDs run together (72 characters). */
const API_KEY_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{20}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
export const looksLikeApiKey = (key) => API_KEY_PATTERN.test(key.trim());

/**
 * Authenticated endpoints for one API key. The API has no CORS preflight support, so the key can't go in an
 * Authorization header from a browser; it's sent as `access_token`, only ever to the GW2 API.
 */
export class AccountClient {
  constructor(apiKey, api = new Gw2ApiClient()) {
    this.apiKey = apiKey.trim();
    this.api = api;
  }

  #get(path) {
    const separator = path.includes("?") ? "&" : "?";
    return this.api.fetchJson(
      `${path}${separator}access_token=${encodeURIComponent(this.apiKey)}`,
      { retries: 2 },
    );
  }

  /** `{name, permissions}`; rejects with `status` 401/403 for a revoked or malformed key. */
  tokenInfo() {
    return this.#get("/tokeninfo");
  }

  /** `{name, …}`: the account the key belongs to (the `account` permission every key has). */
  account() {
    return this.#get("/account");
  }

  /** Every character with equipment, templates, builds and bags (whatever the key's scopes allow). */
  characters() {
    return this.#get("/characters?ids=all");
  }

  bank() {
    return this.#get("/account/bank");
  }

  /** Shared inventory slots. */
  sharedInventory() {
    return this.#get("/account/inventory");
  }

  materials() {
    return this.#get("/account/materials");
  }

  wallet() {
    return this.#get("/account/wallet");
  }

  /** `{coins, items}` waiting to be picked up from the Trading Post. */
  delivery() {
    return this.#get("/commerce/delivery");
  }
}

const CATALOG_KINDS = [
  "items",
  "itemstats",
  "skins",
  "colors",
  "specializations",
];
const CATALOG_CACHE_KEY = "characterCatalogs";
const CATALOG_CACHE_VERSION = 1;
/** Stored definitions are dropped this long after they were first saved, so game updates come through. */
export const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Item, stat, skin, dye and specialization definitions for the armory, fetched once per id. These are public
 * endpoints: the API key is never sent with them. With a `store` (IndexedDbStore), what was fetched is kept in the
 * browser for CATALOG_MAX_AGE_MS, so a later visit only asks for ids it hasn't seen.
 */
export class CharacterCatalogs {
  #specializationsLoaded = null;
  #restored = null;
  #savedAt = null;

  /** @param {{ store?: { get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }, maxAgeMs?: number, now?: () => number }} [options] */
  constructor(
    api = new Gw2ApiClient(),
    { store = null, maxAgeMs = CATALOG_MAX_AGE_MS, now = Date.now } = {},
  ) {
    this.api = api;
    this.store = store;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    for (const kind of CATALOG_KINDS) this[kind] = new Map();
  }

  /** Everything `buildArmory` needs for this character. Ids the API doesn't know are left out. */
  async loadFor(character) {
    await this.#restore();
    const first = referencedIds(character);
    const counts = await Promise.all([
      this.#fill(this.items, "/items", first.items),
      this.#fill(this.skins, "/skins", first.skins),
      this.#fill(this.colors, "/colors", first.colors),
      this.loadSpecializations().then(() => 0),
    ]);
    // Fixed-stat gear names its stats on the item, so those ids are only known once the items are in.
    counts.push(
      await this.#fill(
        this.itemstats,
        "/itemstats",
        referencedIds(character, this.items).itemstats,
      ),
    );
    if (counts.some(Boolean)) await this.#save();
    return this;
  }

  /** @returns {Promise<number>} how many definitions were added */
  async #fill(cache, path, ids) {
    const missing = [...ids].filter((id) => !cache.has(id));
    if (!missing.length) return 0;
    const entries = await this.api.fetchByIds(path, missing, {
      ignoreErrors: true,
    });
    for (const entry of entries) cache.set(entry.id, entry);
    return entries.length;
  }

  /** All ~70 specializations in one request: also gives every profession's icon for core builds. */
  loadSpecializations() {
    this.#specializationsLoaded ??= this.#restore()
      .then(() =>
        this.specializations.size
          ? null
          : this.api.fetchJson("/specializations?ids=all").then((entries) => {
              for (const entry of entries)
                this.specializations.set(entry.id, entry);
              return this.#save();
            }),
      )
      .catch(() => {
        this.#specializationsLoaded = null; // not critical: retry with the next character
      });
    return this.#specializationsLoaded;
  }

  /** Load what an earlier visit saved, unless it's too old; storage problems just mean fetching again. */
  #restore() {
    this.#restored ??= (async () => {
      try {
        const saved = await this.store?.get(CATALOG_CACHE_KEY);
        if (
          saved?.version !== CATALOG_CACHE_VERSION ||
          !(this.now() - saved.savedAt < this.maxAgeMs)
        )
          return;
        this.#savedAt = saved.savedAt;
        for (const kind of CATALOG_KINDS)
          for (const entry of saved[kind] ?? [])
            this[kind].set(entry.id, entry);
      } catch {
        /* unavailable or corrupt: start empty */
      }
    })();
    return this.#restored;
  }

  async #save() {
    if (!this.store) return;
    this.#savedAt ??= this.now();
    const value = { version: CATALOG_CACHE_VERSION, savedAt: this.#savedAt };
    for (const kind of CATALOG_KINDS) value[kind] = [...this[kind].values()];
    try {
      await this.store.set(CATALOG_CACHE_KEY, value);
    } catch {
      /* quota or private mode: works without it */
    }
  }
}
