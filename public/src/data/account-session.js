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

/** Saved account data this old is refreshed without being asked (in "auto" mode; see core/data-preferences.js). */
export const ACCOUNT_MAX_AGE_MS = 5 * 60 * 1000;
const SNAPSHOT_KEY = "accountSnapshot";
const TAB_SNAPSHOT_KEY = "gw2ct.accountSnapshot";
const SNAPSHOT_VERSION = 1;

/** A hash of the key identifies whose data a snapshot is, without storing the key with it. */
async function fingerprint(key) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null; // not a secure context: no saved snapshots
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The connected GW2 account, shared by every page: the key, what it may read, the characters, and everything the
 * account holds. `refresh()` reloads it (the API itself caches account data for a few minutes).
 *
 * With a `cache`, what was loaded is saved as a snapshot (the raw responses and when they were fetched, tied to a hash
 * of the key, never the key itself): in IndexedDB when the key is remembered, otherwise in the tab's sessionStorage,
 * gone when the tab closes. A page then opens on the snapshot at once; one older than `maxAge()` is refreshed in the
 * background (`refreshing` is true meanwhile, and the page keeps working). Forgetting the key deletes it.
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
  /** When the data shown was fetched (ms since epoch), or null. */
  fetchedAt = null;
  /** A background refresh is running (the data shown is still usable). */
  refreshing = false;
  #loadToken = 0;

  /**
   * @param {{ keys?: ApiKeyStore, createClient?: (key: string) => AccountClient,
   *           cache?: { get(key: string): Promise<any>, set(key: string, value: any): Promise<void>,
   *                     delete?(key: string): Promise<void> } | null,
   *           tabStorage?: Storage | null, maxAge?: () => number, now?: () => number }} [options]
   */
  constructor({
    keys = new ApiKeyStore(),
    createClient = (key) => new AccountClient(key),
    cache = null,
    tabStorage = globalThis.sessionStorage ?? null,
    maxAge = () => ACCOUNT_MAX_AGE_MS,
    now = Date.now,
  } = {}) {
    super();
    this.keys = keys;
    this.createClient = createClient;
    this.cache = cache;
    this.tabStorage = tabStorage;
    this.maxAge = maxAge;
    this.now = now;
  }

  get isReady() {
    return this.status === "ready";
  }

  has(permission) {
    return this.permissions.includes(permission);
  }

  /**
   * Connect with the key saved in this browser or tab, if any: from its saved snapshot when there is one (refreshed
   * in the background when older than maxAge()), otherwise from the API.
   */
  async restore() {
    const key = this.keys.get();
    if (!key) return false;
    const remember = this.keys.isRemembered();
    const token = ++this.#loadToken;
    const snapshot = await this.#readSnapshot(key, remember);
    if (token !== this.#loadToken) return false;
    if (!snapshot) return this.connect(key, { remember, saved: true });
    this.key = key;
    this.#apply(snapshot);
    this.#set({ status: "ready", error: "" });
    if (!(this.now() - snapshot.savedAt < this.maxAge())) this.refresh();
    return true;
  }

  /**
   * @param {{ remember?: boolean, saved?: boolean, background?: boolean }} [options]
   *   saved: the key came from storage (forgotten if the API rejects it); background: keep showing the current data
   *   while loading (a refresh) instead of going through "connecting"
   * @returns {Promise<boolean>} whether the account loaded
   */
  async connect(
    rawKey,
    { remember = false, saved = false, background = false } = {},
  ) {
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
    if (background && wasReady) this.#set({ refreshing: true, error: "" });
    else this.#set({ status: "connecting", error: "" });
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
      const snapshot = {
        version: SNAPSHOT_VERSION,
        savedAt: this.now(),
        accountName: account.name,
        permissions,
        raw: { characters, bank, shared, materials, wallet, delivery },
      };
      this.#apply(snapshot);
      this.#set({ status: "ready", error: "", refreshing: false });
      this.#writeSnapshot(key, remember, snapshot);
      return true;
    } catch (error) {
      if (token !== this.#loadToken) return false;
      this.refreshing = false;
      const rejected = isRejection(error);
      if (rejected && saved) {
        this.keys.clear();
        this.#deleteSnapshots();
      }
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

  /** Load the account again, keeping the current data on screen meanwhile. */
  refresh() {
    return this.key
      ? this.connect(this.key, {
          remember: this.keys.isRemembered(),
          saved: true,
          background: true,
        })
      : Promise.resolve(false);
  }

  /** Forget the key everywhere and drop the account's data, saved snapshots included. */
  forget() {
    this.keys.clear();
    this.#deleteSnapshots();
    this.#loadToken++;
    this.#clearData();
    this.#set({ status: "none", error: "", refreshing: false });
  }

  /** Derived views of a snapshot's raw responses. */
  #apply({ savedAt, accountName, permissions, raw }) {
    this.accountName = accountName;
    this.permissions = permissions;
    this.characters = raw.characters;
    this.stacks = collectStacks(raw);
    this.ownedItems = ownedItemCounts(this.stacks);
    this.wallet = walletCounts(raw.wallet);
    this.craftingLevels = bestCraftingLevels(raw.characters);
    this.fetchedAt = savedAt;
  }

  async #readSnapshot(key, remember) {
    if (!this.cache) return null;
    try {
      const id = await fingerprint(key);
      if (!id) return null;
      let snapshot = remember
        ? await this.cache.get(SNAPSHOT_KEY)
        : JSON.parse(this.tabStorage?.getItem(TAB_SNAPSHOT_KEY) ?? "null");
      if (snapshot?.version !== SNAPSHOT_VERSION || snapshot.fingerprint !== id)
        snapshot = null;
      return snapshot;
    } catch {
      return null; // unavailable or corrupt: load from the API
    }
  }

  /** Saved where the key is: on disk only for a remembered key; the other copy is removed. */
  async #writeSnapshot(key, remember, snapshot) {
    if (!this.cache) return;
    try {
      const id = await fingerprint(key);
      if (!id) return;
      const value = { ...snapshot, fingerprint: id };
      if (remember) {
        await this.cache.set(SNAPSHOT_KEY, value);
        this.tabStorage?.removeItem(TAB_SNAPSHOT_KEY);
      } else {
        await this.cache.delete?.(SNAPSHOT_KEY);
        this.tabStorage?.setItem(TAB_SNAPSHOT_KEY, JSON.stringify(value));
      }
    } catch {
      /* quota or private mode: the next page loads from the API */
    }
  }

  #deleteSnapshots() {
    try {
      this.tabStorage?.removeItem(TAB_SNAPSHOT_KEY);
    } catch {
      /* storage blocked */
    }
    this.cache?.delete?.(SNAPSHOT_KEY)?.catch?.(() => {});
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
    this.fetchedAt = null;
  }

  #set(fields) {
    Object.assign(this, fields);
    this.dispatchEvent(new Event("change"));
  }
}
