const STORAGE_KEY = "gw2ct.apiKey";

/**
 * The user's GW2 API key. Remembered in localStorage only when asked; otherwise it lives for this page only.
 * It never leaves the browser except as `access_token` on requests to the GW2 API.
 */
export class ApiKeyStore {
  #sessionKey = null;

  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  get() {
    if (this.#sessionKey) return this.#sessionKey;
    try {
      return this.storage?.getItem(STORAGE_KEY) || null;
    } catch {
      return null; // storage blocked
    }
  }

  set(key, { remember }) {
    this.#sessionKey = key;
    try {
      if (remember) this.storage?.setItem(STORAGE_KEY, key);
      else this.storage?.removeItem(STORAGE_KEY);
    } catch {
      /* private mode: the session copy still works */
    }
  }

  clear() {
    this.#sessionKey = null;
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      /* nothing stored */
    }
  }
}
