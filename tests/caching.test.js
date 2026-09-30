import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DataUpdates,
  getDataUpdates,
  maxAgeFor,
  setDataUpdates,
} from "../public/src/core/data-preferences.js";
import { formatAge } from "../public/src/utils/format.js";
import { PriceBook } from "../public/src/data/price-book.js";
import { OrderBooks } from "../public/src/data/order-books.js";
import { AccountSession } from "../public/src/data/account-session.js";

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
