/** Minimal promise-based key/value store on IndexedDB (one object store). */
export class IndexedDbStore {
  #databasePromise = null;

  constructor(databaseName, storeName = "kv") {
    this.databaseName = databaseName;
    this.storeName = storeName;
  }

  async get(key) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(this.storeName)
        .objectStore(this.storeName)
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  set(key, value) {
    return this.#write((store) => store.put(value, key));
  }

  delete(key) {
    return this.#write((store) => store.delete(key));
  }

  /** Delete every entry (Settings → Clear cached data). */
  clear() {
    return this.#write((store) => store.clear());
  }

  /**
   * Run `change` in a read-write transaction, settling when it commits. A transaction can also abort without an error
   * event reaching it (QuotaExceededError when committing, or the browser closing the database): that rejects too.
   */
  async #write(change) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      change(transaction.objectStore(this.storeName));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
  }

  #open() {
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(this.storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.#databasePromise;
  }
}
