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

  async set(key, value) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async delete(key) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /** Delete every entry (Settings → Clear cached data). */
  async clear() {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
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
