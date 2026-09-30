import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DataUpdates,
  getDataUpdates,
  maxAgeFor,
  setDataUpdates,
} from "../web/src/core/data-preferences.js";
import { formatAge } from "../web/src/utils/format.js";
import { PriceBook } from "../web/src/data/price-book.js";
import { OrderBooks } from "../web/src/data/order-books.js";
import { AccountSession } from "../web/src/data/account-session.js";

const KEY =
  "564F181A-F0FC-114A-A55D-3C1DCD45F3767AF3848F-AB29-4EBF-9594-F91E6A75E015";
const MINUTE = 60 * 1000;

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** IndexedDbStore stand-in that clones like IndexedDB does. */
function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (key) => structuredClone(map.get(key)),
    set: async (key, value) => void map.set(key, structuredClone(value)),
    delete: async (key) => void map.delete(key),
  };
}

// setImmediate: the price test mocks setTimeout.
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("data updates are manual unless chosen otherwise", () => {
  const storage = memoryStorage();
  assert.equal(getDataUpdates(storage), DataUpdates.manual);
  assert.equal(
    maxAgeFor(5 * MINUTE, storage),
    Infinity,
    "manual: saved data never goes stale",
  );
  setDataUpdates(DataUpdates.auto, storage);
  assert.equal(maxAgeFor(5 * MINUTE, storage), 5 * MINUTE);
  assert.equal(getDataUpdates(null), DataUpdates.manual, "no storage");
});

test("ages read naturally", () => {
  assert.equal(formatAge(20 * 1000), "just now");
  assert.equal(formatAge(12 * MINUTE), "12 min ago");
  assert.equal(formatAge(3 * 60 * MINUTE), "3 h ago");
  assert.equal(formatAge(3 * 24 * 60 * MINUTE), "3 days ago");
});

test("prices are saved, restored on the next visit, and refetched only when stale or forced", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = memoryStore();
  let now = 1_000_000;
  const calls = [];
  const api = {
    getPrices: async (ids) => {
      calls.push([...ids]);
      return ids
        .filter((id) => id !== 3)
        .map((id) => ({ id, buy: id * 10, sell: id * 11 }));
    },
  };
  const first = new PriceBook(api, {
    store,
    maxAge: () => 5 * MINUTE,
    now: () => now,
  });
  await first.ensure([1, 2, 3]);
  t.mock.timers.tick(1000); // the debounced save
  await tick();
  assert.ok(store.map.has("prices"));

  now += 60 * MINUTE;
  const manual = new PriceBook(api, {
    store,
    maxAge: () => Infinity,
    now: () => now,
  });
  assert.equal(
    await manual.ensure([1, 2, 3]),
    false,
    "manual: saved prices are used as they are",
  );
  assert.equal(manual.getQuote(2).buy, 20);
  assert.equal(manual.getQuote(3), null, "untradeable is remembered too");
  assert.equal(manual.oldestFetchedAt([1, 2]), 1_000_000);
  assert.equal(calls.length, 1);

  const auto = new PriceBook(api, {
    store,
    maxAge: () => 5 * MINUTE,
    now: () => now,
  });
  await auto.ensure([1]);
  assert.equal(calls.length, 2, "auto: an hour-old price is refetched");
  await manual.ensure([1], { force: true });
  assert.equal(calls.length, 3, "Refresh forces a fetch");
});

test("order books keep just the top and follow the same freshness rules", async () => {
  const store = memoryStore();
  let now = 0;
  let calls = 0;
  const api = {
    getBuyOrders: async (ids) => {
      calls++;
      return new Map(
        ids.map((id) => [
          id,
          [
            { unitPrice: 100, quantity: 900 },
            { unitPrice: 90, quantity: 500 },
            { unitPrice: 80, quantity: 500 },
          ],
        ]),
      );
    },
  };
  const books = new OrderBooks(api, {
    store,
    maxAge: () => Infinity,
    now: () => now,
  });
  const first = await books.get([7]);
  assert.deepEqual(
    first.get(7).map((o) => o.unitPrice),
    [100, 90],
    "enough orders to price 1000 units",
  );
  now += 1e9;
  const again = new OrderBooks(api, {
    store,
    maxAge: () => Infinity,
    now: () => now,
  });
  await again.get([7]);
  assert.equal(calls, 1, "restored from the store");
  await again.get([7], { force: true });
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------- account snapshots

function sessionSetup({ remembered = true, maxAge = () => Infinity } = {}) {
  let saved = remembered ? KEY : null;
  let tabKey = remembered ? null : KEY;
  const keys = {
    get: () => tabKey ?? saved,
    isRemembered: () => !!saved,
    set: (key, { remember }) => {
      saved = remember ? key : null;
      tabKey = remember ? null : key;
    },
    clear: () => (saved = tabKey = null),
  };
  const calls = [];
  const client = {
    tokenInfo: async () => (
      calls.push("tokenInfo"),
      { permissions: ["account", "inventories"] }
    ),
    account: async () => (calls.push("account"), { name: "Test.1234" }),
    bank: async () => (calls.push("bank"), [{ id: 19721, count: 250 }]),
    sharedInventory: async () => [],
    materials: async () => [],
  };
  const cache = memoryStore();
  const tabStorage = memoryStorage();
  let now = 1_000_000;
  const make = () =>
    new AccountSession({
      keys,
      createClient: () => client,
      cache,
      tabStorage,
      maxAge,
      now: () => now,
    });
  return { make, calls, cache, tabStorage, advance: (ms) => (now += ms) };
}

/** Snapshots are written after hashing the key, which takes a few turns: wait for a condition. */
async function until(condition, turns = 500) {
  for (let turn = 0; turn < turns && !condition(); turn++) await tick();
  assert.ok(condition(), "timed out waiting");
}

test("a remembered account opens from its saved snapshot, without the API", async () => {
  const setup = sessionSetup();
  const first = setup.make();
  await first.restore(); // nothing saved yet: from the API
  assert.equal(first.ownedItems.get(19721), 250);
  await until(() => setup.cache.map.has("accountSnapshot"));
  assert.equal(
    JSON.stringify(setup.cache.map.get("accountSnapshot")).includes(KEY),
    false,
    "the key itself is never saved with the data",
  );

  setup.calls.length = 0;
  setup.advance(3 * 60 * MINUTE);
  const second = setup.make();
  assert.equal(await second.restore(), true);
  assert.equal(second.status, "ready");
  assert.equal(second.ownedItems.get(19721), 250);
  assert.equal(second.fetchedAt, 1_000_000);
  assert.deepEqual(setup.calls, [], "manual updates: no requests at all");
});

test("stale snapshots refresh in the background in auto mode", async () => {
  const setup = sessionSetup({ maxAge: () => 5 * MINUTE });
  await setup.make().restore();
  await until(() => setup.cache.map.has("accountSnapshot"));
  setup.calls.length = 0;
  setup.advance(10 * MINUTE);
  const session = setup.make();
  const statuses = [];
  session.addEventListener("change", () => statuses.push(session.status));
  await session.restore();
  assert.equal(session.status, "ready", "shown at once from the snapshot");
  await until(() => setup.calls.includes("bank") && !session.refreshing);
  assert.equal(
    statuses.includes("connecting"),
    false,
    "without blanking the page",
  );
  assert.equal(
    session.fetchedAt,
    1_000_000 + 10 * MINUTE,
    "now showing the fresh data",
  );
});

test("a key kept only for the tab keeps its snapshot in the tab; forgetting deletes it", async () => {
  const setup = sessionSetup({ remembered: false });
  const session = setup.make();
  await session.restore();
  await until(() => setup.tabStorage.map.has("gw2ct.accountSnapshot"));
  assert.equal(
    setup.cache.map.has("accountSnapshot"),
    false,
    "nothing on disk",
  );
  session.forget();
  assert.equal(setup.tabStorage.map.has("gw2ct.accountSnapshot"), false);
});

test("another key's snapshot is never shown", async () => {
  const setup = sessionSetup();
  await setup.make().restore();
  await until(() => setup.cache.map.has("accountSnapshot"));
  setup.cache.map.get("accountSnapshot").fingerprint = "someone-else";
  setup.calls.length = 0;
  await setup.make().restore();
  assert.ok(setup.calls.includes("tokenInfo"), "loaded from the API instead");
});

test("forgetting while a snapshot is being written leaves nothing saved", async () => {
  const setup = sessionSetup();
  const session = setup.make();
  await session.restore(); // loads, then starts writing (hashing the key first)
  session.forget(); // before the write lands
  for (let turn = 0; turn < 200; turn++) await tick();
  assert.equal(setup.cache.map.has("accountSnapshot"), false);
});

test("a saved key the API rejects takes its snapshot with it", async () => {
  const setup = sessionSetup({ maxAge: () => 0 });
  await setup.make().restore();
  await until(() => setup.cache.map.has("accountSnapshot"));
  const session = setup.make();
  session.createClient = () => ({
    tokenInfo: async () => {
      throw Object.assign(new Error("HTTP 401"), { status: 401 });
    },
    account: async () => ({ name: "Test.1234" }),
  });
  await session.restore(); // shows the snapshot, then the background refresh is rejected
  await until(() => !setup.cache.map.has("accountSnapshot"));
  assert.equal(session.status, "error");
});

test("a partly failed load is retried on the next visit, even with manual updates", async () => {
  const setup = sessionSetup();
  const first = setup.make();
  first.createClient = () => ({
    tokenInfo: async () => ({ permissions: ["account", "inventories"] }),
    account: async () => ({ name: "Test.1234" }),
    bank: async () => {
      throw new Error("timeout");
    },
    sharedInventory: async () => [],
    materials: async () => [],
  });
  await first.restore();
  await until(() => setup.cache.map.get("accountSnapshot")?.partial === true);
  setup.calls.length = 0;
  const second = setup.make();
  await second.restore();
  await until(() => setup.calls.includes("bank"));
  await until(() => second.ownedItems.get(19721) === 250);
});

test("clearing prices isn't undone by the saved copy", async () => {
  const store = memoryStore();
  await store.set("prices", { version: 1, quotes: [[1, 0, 10, 11]] });
  const api = {
    getPrices: async (ids) => ids.map((id) => ({ id, buy: 99, sell: 99 })),
  };
  const book = new PriceBook(api, { store, maxAge: () => Infinity });
  book.clear(); // before anything was restored
  await book.ensure([1]);
  assert.equal(book.getQuote(1).buy, 99, "fetched fresh, not the saved 10");
});

// ---------------------------------------------------------------- failed fetches, merging, pruning

/** Price API stand-in: ids in `failing` are in a batch that failed; ids in `untradeable` are left out of the answer. */
function flakyPriceApi({ untradeable = [] } = {}) {
  const api = {
    failing: new Set(),
    price: 10,
    getPrices: async (ids, { failedIds } = {}) => {
      const answered = [];
      for (const id of ids)
        if (api.failing.has(id)) failedIds?.add(id);
        else if (!untradeable.includes(id))
          answered.push({ id, buy: api.price, sell: api.price + 1 });
      return answered;
    },
  };
  return api;
}

test("a price batch that fails keeps the previous quote, and isn't saved as untradeable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = memoryStore();
  let now = 1000;
  const api = flakyPriceApi({ untradeable: [3] });
  const book = new PriceBook(api, {
    store,
    maxAge: () => Infinity,
    now: () => now,
  });
  await book.ensure([1, 2, 3]);
  now = 2000;
  api.price = 20;
  api.failing = new Set([2]);
  await book.ensure([1, 2, 3], { force: true });
  assert.equal(book.getQuote(1).buy, 20, "the batch that came is used");
  assert.equal(book.getQuote(2).buy, 10, "the failed one keeps its quote");
  assert.equal(book.oldestFetchedAt([2]), 1000, "…and its age");
  assert.equal(book.fetchFailed(2), true);
  assert.equal(book.getQuote(3), null, "absent from an answer: untradeable");
  assert.equal(book.fetchFailed(3), false);
  t.mock.timers.tick(1000);
  await until(() => store.map.get("prices")?.quotes.length === 3);
  const saved = new Map(
    store.map.get("prices").quotes.map((entry) => [entry[0], entry]),
  );
  assert.deepEqual(saved.get(2), [2, 1000, 10, 11], "saved as it was");
  assert.deepEqual(saved.get(3), [3, 2000, null, null]);
});

test("a price never fetched that fails is asked for again, even with manual updates", async () => {
  const api = flakyPriceApi();
  api.failing = new Set([5]);
  const book = new PriceBook(api, { maxAge: () => Infinity });
  await book.ensure([5]);
  assert.equal(book.has(5), false, "not taken for untradeable");
  api.failing.clear();
  await book.ensure([5]);
  assert.equal(book.getQuote(5).buy, 10);
  assert.equal(book.fetchFailed(5), false);
});

test("saving prices keeps another tab's newer quotes; clearing replaces them", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = memoryStore();
  let now = 1000;
  const api = flakyPriceApi();
  const options = { store, maxAge: () => Infinity, now: () => now };
  const tabA = new PriceBook(api, options);
  await tabA.ensure([1, 2]);
  t.mock.timers.tick(1000);
  await until(() => store.map.has("prices"));

  const tabB = new PriceBook(api, options);
  now = 2000;
  api.price = 20;
  await tabB.ensure([1], { force: true });
  t.mock.timers.tick(1000);
  await until(() =>
    store.map.get("prices").quotes.some(([id, at]) => id === 1 && at === 2000),
  );

  now = 3000;
  api.price = 30;
  await tabA.ensure([2], { force: true }); // tabA still holds its own older quote for 1
  t.mock.timers.tick(1000);
  await until(() =>
    store.map.get("prices").quotes.some(([id, at]) => id === 2 && at === 3000),
  );
  const saved = new Map(
    store.map.get("prices").quotes.map((entry) => [entry[0], entry]),
  );
  assert.deepEqual(saved.get(1), [1, 2000, 20, 21], "tab B's newer quote");
  assert.deepEqual(saved.get(2), [2, 3000, 30, 31]);

  tabA.clear();
  t.mock.timers.tick(1000);
  await until(() => store.map.get("prices").quotes.length === 0);
});

test("a save when the page goes away starts writing at once, merged with what was stored", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = memoryStore();
  await store.set("prices", { version: 1, quotes: [[9, 500, 7, 8]] });
  let writes = 0;
  const set = store.set.bind(store);
  store.set = (key, value) => {
    writes++;
    return set(key, value);
  };
  let pageHide;
  const had = globalThis.addEventListener;
  globalThis.addEventListener = (type, listener) => {
    if (type === "pagehide") pageHide = listener;
  };
  t.after(() => (globalThis.addEventListener = had));
  const book = new PriceBook(flakyPriceApi(), {
    store,
    maxAge: () => Infinity,
    now: () => 1000,
  });
  await book.ensure([1]); // restores the stored copy, then fetches 1; the save waits on its debounce
  assert.equal(writes, 0);
  pageHide();
  assert.equal(writes, 1, "written without waiting for anything");
  const saved = new Map(
    store.map.get("prices").quotes.map((entry) => [entry[0], entry]),
  );
  assert.ok(saved.has(1) && saved.has(9));
});

test("a disposed price book stops listening for the page going away", (t) => {
  const listeners = new Set();
  const had = {
    add: globalThis.addEventListener,
    remove: globalThis.removeEventListener,
  };
  globalThis.addEventListener = (type, listener) => listeners.add(listener);
  globalThis.removeEventListener = (type, listener) =>
    listeners.delete(listener);
  t.after(() => {
    globalThis.addEventListener = had.add;
    globalThis.removeEventListener = had.remove;
  });
  const book = new PriceBook(flakyPriceApi(), { store: memoryStore() });
  assert.equal(listeners.size, 1);
  book.dispose();
  book.dispose();
  assert.equal(listeners.size, 0);
});

test("an order book batch that fails keeps the previous book", async () => {
  let failing = false;
  let calls = 0;
  const api = {
    getBuyOrders: async (ids, { failedIds } = {}) => {
      calls++;
      if (failing) {
        for (const id of ids) failedIds?.add(id);
        return new Map();
      }
      return new Map(
        ids
          .filter((id) => id !== 9)
          .map((id) => [id, [{ unitPrice: 5, quantity: 1 }]]),
      );
    },
  };
  const books = new OrderBooks(api, {
    store: memoryStore(),
    maxAge: () => Infinity,
  });
  await books.get([7, 9]);
  failing = true;
  const again = await books.get([7, 8], { force: true });
  assert.deepEqual(again.get(7), [{ unitPrice: 5, quantity: 1 }], "kept");
  assert.deepEqual(again.get(8), [], "unknown: nothing to show yet");
  assert.equal(books.fetchFailed(8), true);
  failing = false;
  await books.get([8]);
  assert.equal(calls, 3, "a failed id is asked for again, even in manual mode");
  assert.equal(books.fetchFailed(8), false);
  assert.deepEqual(
    (await books.get([9])).get(9),
    [],
    "absent from an answer: nobody's buying",
  );
  assert.equal(calls, 3, "…and that is remembered");
});

test("saved order books are capped, newest first, and old ones dropped", async () => {
  const store = memoryStore();
  let now = 0;
  const api = {
    getBuyOrders: async (ids) =>
      new Map(ids.map((id) => [id, [{ unitPrice: 1, quantity: 1 }]])),
  };
  const manual = new OrderBooks(api, {
    store,
    maxAge: () => Infinity,
    now: () => now,
  });
  await manual.get([-1]);
  now = 1;
  await manual.get(Array.from({ length: 5000 }, (_, i) => i));
  await tick();
  const savedIds = new Set(store.map.get("orderBooks").books.map(([id]) => id));
  assert.equal(savedIds.size, 5000);
  assert.equal(savedIds.has(-1), false, "the oldest is dropped");

  const autoStore = memoryStore();
  const auto = new OrderBooks(api, {
    store: autoStore,
    maxAge: () => 5 * MINUTE,
    now: () => now,
  });
  await auto.get([1]);
  now += 60 * MINUTE;
  await auto.get([2]);
  await tick();
  assert.deepEqual(
    autoStore.map.get("orderBooks").books.map(([id]) => id),
    [2],
    "an hour old at a 5-minute max age: not worth keeping",
  );
});

// ---------------------------------------------------------------- account session robustness

test("characters failing to load leave the rest usable, and are retried", async () => {
  const setup = sessionSetup();
  let charactersFail = true;
  const client = {
    tokenInfo: async () => ({ permissions: ["account", "characters"] }),
    account: async () => ({ name: "Test.1234" }),
    characters: async () => {
      if (charactersFail) throw new Error("timeout");
      return [
        { name: "Hero", crafting: [{ discipline: "Chef", rating: 400 }] },
      ];
    },
  };
  const first = setup.make();
  first.createClient = () => client;
  assert.equal(await first.restore(), true);
  assert.equal(first.status, "ready");
  assert.equal(first.characters, null);
  assert.equal(first.charactersUnavailable, true, "unknown, not 'none'");
  await until(() => setup.cache.map.get("accountSnapshot")?.partial === true);

  charactersFail = false;
  const second = setup.make();
  second.createClient = () => client;
  await second.restore();
  await until(() => second.craftingLevels.get("Chef")?.rating === 400);
  assert.equal(second.charactersUnavailable, false);
});

test("a saved key that couldn't reach the API is kept, so a retry works", async () => {
  const setup = sessionSetup();
  let down = true;
  const session = setup.make();
  session.createClient = () => ({
    tokenInfo: async () => {
      if (down) throw new Error("HTTP 503");
      return { permissions: ["account"] };
    },
    account: async () => ({ name: "Test.1234" }),
  });
  assert.equal(await session.restore(), false);
  assert.equal(session.status, "error");
  assert.equal(session.key, KEY, "still known");
  down = false;
  assert.equal(await session.refresh(), true);
  assert.equal(session.status, "ready");
});

test("a saved key the API rejects isn't kept for a retry", async () => {
  const setup = sessionSetup();
  const session = setup.make();
  session.createClient = () => ({
    tokenInfo: async () => {
      throw Object.assign(new Error("HTTP 401"), { status: 401 });
    },
    account: async () => ({ name: "Test.1234" }),
  });
  await session.restore();
  assert.equal(session.status, "error");
  assert.equal(session.key, null);
  assert.equal(await session.refresh(), false);
});

test("a tab snapshot too big for sessionStorage is kept without the characters", async () => {
  const setup = sessionSetup({ remembered: false });
  const setItem = setup.tabStorage.setItem;
  setup.tabStorage.setItem = (key, value) => {
    if (value.length > 400) throw new Error("QuotaExceededError");
    setItem(key, value);
  };
  const session = setup.make();
  session.createClient = () => ({
    tokenInfo: async () => ({ permissions: ["account", "characters"] }),
    account: async () => ({ name: "Test.1234" }),
    characters: async () => [{ name: "Hero", filler: "x".repeat(500) }],
  });
  await session.restore();
  assert.equal(session.characters.length, 1, "this page still has them");
  await until(() => setup.tabStorage.map.has("gw2ct.accountSnapshot"));
  const saved = JSON.parse(setup.tabStorage.map.get("gw2ct.accountSnapshot"));
  assert.equal(saved.raw.characters, null);
  assert.equal(saved.partial, true, "so the next page fetches them again");
});
