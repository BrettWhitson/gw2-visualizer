import { ApiKeyStore } from "../core/api-key-store.js";
import { AccountClient, looksLikeApiKey } from "./account-client.js";
import {
  bestCraftingLevels,
  collectStacks,
  ownedItemCounts,
  walletCounts,
} from "../model/account-inventory.js";

/** The API answers an invalid key with 400, a deleted one with 401 / 403. */
const isRejection = (error) => [400, 401, 403].includes(error?.status);

/**
 * The connected GW2 account, shared by every page: the key, what it may read, the characters, and everything the
 * account holds. Loaded once per page; `refresh()` reloads it (the API itself caches account data for a few minutes).
 *
 * Dispatches "change" whenever `status` or the data changes. `status`: "none" (no key) | "connecting" | "ready" |
 * "error" (`error` says why; a rejected saved key is forgotten). A failed attempt to switch keys keeps the account
 * that was connected: `status` goes back to "ready" with `error` set.
 */
export class AccountSession extends EventTarget {
  status = "none";
  error = "";
  accountName = null;
  /** @type {string[]} */
  permissions = [];
  /** @type {object[] | null} raw /v2/characters entries */
  characters = null;
  /** @type {import('../model/account-inventory.js').Stack[]} */
  stacks = [];
  /** @type {Map<number, number>} item id → count held (bank, materials, shared, bags, TP pickup) */
  ownedItems = new Map();
  /** @type {Map<number, number>} currency id → amount */
  wallet = new Map();
  /** @type {Map<string, {rating: number, character: string}>} */
  craftingLevels = new Map();
  #loadToken = 0;

  constructor({
    keys = new ApiKeyStore(),
    createClient = (key) => new AccountClient(key),
  } = {}) {
    super();
    this.keys = keys;
    this.createClient = createClient;
  }

  get isReady() {
    return this.status === "ready";
  }

  has(permission) {
    return this.permissions.includes(permission);
  }

  /** Connect with the key saved in this browser or tab, if any. */
  restore() {
    const key = this.keys.get();
    if (!key) return Promise.resolve(false);
    return this.connect(key, {
      remember: this.keys.isRemembered(),
      saved: true,
    });
  }

  /** @returns {Promise<boolean>} whether the account loaded */
  async connect(rawKey, { remember = false, saved = false } = {}) {
    const key = rawKey.trim();
    const wasReady = this.status === "ready";
    if (!looksLikeApiKey(key)) {
      this.#fail(
        "That doesn't look like a GW2 API key: it should be 72 characters of letters, digits and hyphens.",
        { keepAccount: wasReady },
      );
      return false;
    }
    const token = ++this.#loadToken;
    this.#set({ status: "connecting", error: "" });
    const client = this.createClient(key);
    try {
      const [info, account] = await Promise.all([
        client.tokenInfo(),
        client.account(),
      ]);
      const permissions = info.permissions ?? [];
      const optional = (permission, load) =>
        permissions.includes(permission) ? load() : Promise.resolve(null);
      // Each part the key can read; one failing (the API has the odd hiccup) leaves the rest usable.
      const tolerant = (promise) => promise.catch(() => null);
      const [characters, bank, shared, materials, wallet, delivery] =
        await Promise.all([
          optional("characters", () => client.characters()),
          tolerant(optional("inventories", () => client.bank())),
          tolerant(optional("inventories", () => client.sharedInventory())),
          tolerant(optional("inventories", () => client.materials())),
          tolerant(optional("wallet", () => client.wallet())),
          tolerant(optional("tradingpost", () => client.delivery())),
        ]);
      if (token !== this.#loadToken) return false; // superseded by another connect / forget
      this.keys.set(key, { remember });
      this.key = key;
      this.accountName = account.name;
      this.permissions = permissions;
      this.characters = characters;
      this.stacks = collectStacks({
        bank,
        shared,
        materials,
        characters,
        delivery,
      });
      this.ownedItems = ownedItemCounts(this.stacks);
      this.wallet = walletCounts(wallet);
      this.craftingLevels = bestCraftingLevels(characters);
      this.#set({ status: "ready", error: "" });
      return true;
    } catch (error) {
      if (token !== this.#loadToken) return false;
      const rejected = isRejection(error);
      if (rejected && saved) this.keys.clear();
      this.#fail(
        rejected
          ? "The API rejected this key. It may have been deleted, or mistyped."
          : `Couldn't reach the Guild Wars 2 API (${error.message}). Try again in a moment.`,
        // The connected account stays, unless it's this very key that was rejected.
        { keepAccount: wasReady && !(rejected && saved) },
      );
      return false;
    }
  }

  refresh() {
    return this.key
      ? this.connect(this.key, {
          remember: this.keys.isRemembered(),
          saved: true,
        })
      : Promise.resolve(false);
  }

  /** Forget the key everywhere and drop the account's data. */
  forget() {
    this.keys.clear();
    this.#loadToken++;
    this.#clearData();
    this.#set({ status: "none", error: "" });
  }

  #fail(error, { keepAccount = false } = {}) {
    if (keepAccount) {
      this.#set({ status: "ready", error });
      return;
    }
    this.#clearData();
    this.#set({ status: "error", error });
  }

  #clearData() {
    this.key = null;
    this.accountName = null;
    this.permissions = [];
    this.characters = null;
    this.stacks = [];
    this.ownedItems = new Map();
    this.wallet = new Map();
    this.craftingLevels = new Map();
  }

  #set(fields) {
    Object.assign(this, fields);
    this.dispatchEvent(new Event("change"));
  }
}
