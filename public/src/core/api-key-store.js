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

  /**
   * Whether `key` (by default this tab's key) is the one kept across visits. Not merely "a key is saved": with several
   * tabs open, another tab may have remembered a different key while this one keeps its own for the tab.
   */
  isRemembered(key = this.get()) {
    const saved = read(this.storage);
    return !!saved && saved === key;
  }

  /**
   * Keep the key (for the tab, or across visits when `remember`). The other copy is removed only once the key is
   * safely written; if remembering it fails, it's kept for the tab instead.
   * @returns {boolean} whether it was kept where asked
   */
  set(key, { remember }) {
    const target = remember ? this.storage : this.sessionStorage,
      other = remember ? this.sessionStorage : this.storage;
    if (write(target, key)) {
      write(other, null);
      return true;
    }
    if (remember) write(this.sessionStorage, key);
    return false;
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

/** @returns {boolean} whether it was written */
function write(storage, value) {
  if (!storage) return false;
  try {
    if (value) storage.setItem(STORAGE_KEY, value);
    else storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false; // private mode or quota: nothing to keep
  }
}
