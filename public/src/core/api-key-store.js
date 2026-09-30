const STORAGE_KEY = "gw2ct.apiKey";

/**
 * The user's GW2 API key. "Remember" keeps it in localStorage; otherwise it's kept in sessionStorage, so it survives
 * moving between this site's pages but is gone when the tab closes. It never leaves the browser except as
 * `access_token` on requests to the GW2 API.
 */
export class ApiKeyStore {
  constructor(
    storage = globalThis.localStorage,
    sessionStorage = globalThis.sessionStorage,
  ) {
    this.storage = storage;
    this.sessionStorage = sessionStorage;
  }

  get() {
    return read(this.sessionStorage) ?? read(this.storage);
  }

  /** Whether the key is kept across visits. */
  isRemembered() {
    return !!read(this.storage);
  }

  set(key, { remember }) {
    write(remember ? this.storage : this.sessionStorage, key);
    write(remember ? this.sessionStorage : this.storage, null);
  }

  clear() {
    write(this.storage, null);
    write(this.sessionStorage, null);
  }
}

function read(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null; // storage blocked
  }
}

function write(storage, value) {
  try {
    if (value) storage?.setItem(STORAGE_KEY, value);
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: nothing to keep */
  }
}
