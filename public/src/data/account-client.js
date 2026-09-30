import { Gw2ApiClient } from "./gw2-api-client.js";
import { referencedIds } from "../model/character-armory.js";

/** API key permissions the character view reads; `account` is always granted. */
export const CHARACTER_SCOPES = ["characters", "builds"];

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

  /** Every character with equipment, templates and builds (whatever the key's scopes allow). */
  characters() {
    return this.#get("/characters?ids=all");
  }
}

/**
 * Item, stat, skin, dye and specialization definitions for the armory, fetched once per id and kept for the page's
 * lifetime. These are public endpoints: the API key is never sent with them.
 */
export class CharacterCatalogs {
  #specializationsLoaded = null;

  constructor(api = new Gw2ApiClient()) {
    this.api = api;
    this.items = new Map();
    this.itemstats = new Map();
    this.skins = new Map();
    this.colors = new Map();
    this.specializations = new Map();
  }

  /** Everything `buildArmory` needs for this character. Ids the API doesn't know are left out. */
  async loadFor(character) {
    const first = referencedIds(character);
    await Promise.all([
      this.#fill(this.items, "/items", first.items),
      this.#fill(this.skins, "/skins", first.skins),
      this.#fill(this.colors, "/colors", first.colors),
      this.loadSpecializations(),
    ]);
    // Fixed-stat gear names its stats on the item, so those ids are only known once the items are in.
    await this.#fill(
      this.itemstats,
      "/itemstats",
      referencedIds(character, this.items).itemstats,
    );
    return this;
  }

  async #fill(cache, path, ids) {
    const missing = [...ids].filter((id) => !cache.has(id));
    if (!missing.length) return;
    const entries = await this.api.fetchByIds(path, missing, {
      ignoreErrors: true,
    });
    for (const entry of entries) cache.set(entry.id, entry);
  }

  /** All ~70 specializations in one request: also gives every profession's icon for core builds. */
  loadSpecializations() {
    this.#specializationsLoaded ??= this.api
      .fetchJson("/specializations?ids=all")
      .then((entries) => {
        for (const entry of entries) this.specializations.set(entry.id, entry);
      })
      .catch(() => {
        this.#specializationsLoaded = null; // not critical: retry with the next character
      });
    return this.#specializationsLoaded;
  }
}
