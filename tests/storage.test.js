import { test } from "node:test";
import assert from "node:assert/strict";
import { IndexedDbStore } from "../public/src/data/indexed-db-store.js";
import { ApiKeyStore } from "../public/src/core/api-key-store.js";
import { AccountSession } from "../public/src/data/account-session.js";
import { runWithConcurrency } from "../public/src/utils/async.js";

const KEY_A =
  "564F181A-F0FC-114A-A55D-3C1DCD45F3767AF3848F-AB29-4EBF-9594-F91E6A75E015";
const KEY_B =
  "564F181A-F0FC-114A-A55D-3C1DCD45F3767AF3848F-AB29-4EBF-9594-F91E6A75E016";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function memoryStorage({ failWrites = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("QuotaExceededError");
      map.set(key, String(value));
    },
    removeItem: (key) => map.delete(key),
  };
}

// ---------------------------------------------------------------- IndexedDbStore

/** Just enough of IndexedDB for IndexedDbStore: every read-write transaction aborts (with `error`, maybe null). */
function abortingIndexedDb(error) {
  const db = {
    transaction() {
      const transaction = { error: null };
      const abortSoon = () =>
        setImmediate(() => {
          transaction.error = error;
          transaction.onabort?.();
        });
      transaction.objectStore = () => ({
        put: abortSoon,
        delete: abortSoon,
        clear: abortSoon,
      });
      return transaction;
    },
  };
  return {
    open() {
      const request = { result: db };
      setImmediate(() => request.onsuccess());
      return request;
    },
  };
}

test("an aborted IndexedDB write rejects instead of hanging", async (t) => {
  const had = globalThis.indexedDB;
  t.after(() => {
    globalThis.indexedDB = had;
  });
  const quota = new Error("QuotaExceededError");
  globalThis.indexedDB = abortingIndexedDb(quota);
  const store = new IndexedDbStore("test");
  await assert.rejects(store.set("k", 1), quota);
  await assert.rejects(store.delete("k"), quota);
  await assert.rejects(store.clear(), quota);

  globalThis.indexedDB = abortingIndexedDb(null); // aborted without an error
  await assert.rejects(new IndexedDbStore("test").set("k", 1), /aborted/);
});

// ---------------------------------------------------------------- ApiKeyStore

test("only the tab's own key counts as remembered when tabs hold different keys", () => {
  const local = memoryStorage();
  const tabA = new ApiKeyStore(local, memoryStorage());
  const tabB = new ApiKeyStore(local, memoryStorage());
  tabB.set(KEY_B, { remember: false });
  tabA.set(KEY_A, { remember: true });
  assert.equal(tabA.isRemembered(), true);
  assert.equal(tabB.get(), KEY_B);
  assert.equal(tabB.isRemembered(), false, "another tab's key is saved");
  assert.equal(tabB.isRemembered(KEY_A), true);
});

test("a key that can't be remembered is kept for the tab", () => {
  const local = memoryStorage({ failWrites: true });
  const tab = memoryStorage();
  const keys = new ApiKeyStore(local, tab);
  assert.equal(keys.set(KEY_A, { remember: false }), true);
  assert.equal(keys.set(KEY_A, { remember: true }), false);
  assert.equal(keys.get(), KEY_A, "not lost");
  assert.equal(keys.isRemembered(), false);
  assert.equal(new ApiKeyStore(local, memoryStorage()).get(), null);
});

test("refreshing a tab-only key doesn't touch another tab's remembered key", async () => {
  const local = memoryStorage();
  const keysA = new ApiKeyStore(local, memoryStorage());
  const keysB = new ApiKeyStore(local, memoryStorage());
  keysB.set(KEY_B, { remember: false });
  keysA.set(KEY_A, { remember: true }); // later, in the other tab
  const cache = new Map();
  const tabStorage = memoryStorage();
  const session = new AccountSession({
    keys: keysB,
    createClient: () => ({
      tokenInfo: async () => ({ permissions: ["account"] }),
      account: async () => ({ name: "Tab.1234" }),
    }),
    cache: {
      get: async (key) => cache.get(key),
      set: async (key, value) => void cache.set(key, value),
      delete: async (key) => void cache.delete(key),
    },
    tabStorage,
    maxAge: () => Infinity,
  });
  assert.equal(await session.restore(), true);
  assert.equal(await session.refresh(), true);
  for (let turn = 0; turn < 50; turn++) await tick();
  assert.equal(local.getItem("gw2ct.apiKey"), KEY_A, "tab A's key stays");
  assert.equal(keysB.get(), KEY_B);
  assert.equal(
    cache.has("accountSnapshot"),
    false,
    "tab B's data isn't saved to disk",
  );
  assert.ok(tabStorage.map.has("gw2ct.accountSnapshot"));
});

// ---------------------------------------------------------------- runWithConcurrency

test("after a task fails, no further tasks are started", async () => {
  let started = 0;
  const tasks = Array.from({ length: 10 }, (_, i) => async () => {
    started++;
    await new Promise((resolve) => setTimeout(resolve, i === 0 ? 1 : 10));
    if (i === 0) throw new Error("boom");
  });
  await assert.rejects(runWithConcurrency(tasks, 2), /boom/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(started, 2, "only the two already running");
});
