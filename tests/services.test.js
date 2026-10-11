import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceBook } from "../web/src/data/price-book.js";
import { RecentItems } from "../web/src/core/recent-items.js";
import { ApiKeyStore } from "../web/src/core/api-key-store.js";
import {
  CUSTOMIZE_GROUPS,
  SETTINGS_GROUPS,
  PRESET_KINDS,
} from "../web/src/config/settings-schema.js";

/** API stand-in that counts price requests and answers after a tick. */
function createFakePriceApi(prices) {
  const calls = [];
  return {
    calls,
    getPrices: async (ids) => {
      calls.push([...ids]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ids
        .filter((id) => id in prices)
        .map((id) => ({ id, buy: prices[id], sell: prices[id] + 1 }));
    },
  };
}

test("PriceBook shares in-flight fetches and caches quotes", async () => {
  const api = createFakePriceApi({ 1: 10, 2: 20 });
  const book = new PriceBook(api);
  const [first, second] = await Promise.all([
    book.ensure([1, 2, 3]),
    book.ensure([1, 2]),
  ]);
  assert.equal(
    api.calls.length,
    1,
    "the second request waited for the first instead of refetching",
  );
  assert.equal(first && second, true, "both callers learn that prices arrived");
  assert.equal(book.getUnitPrice(2, "sell"), 21);
  assert.equal(
    book.getQuote(3),
    null,
    "missing from the response → not tradeable",
  );
  assert.equal(book.size, 2);
  assert.equal(
    await book.ensure([1, 2, 3]),
    false,
    "fresh quotes are not refetched",
  );
  book.clear();
  assert.equal(await book.ensure([1]), true, "clear() forces a refetch");
  assert.equal(api.calls.length, 2);
});

test("RecentItems keeps the latest unique items first", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const recent = new RecentItems(storage);
  [1, 2, 3, 2].forEach((id) => recent.add(id));
  assert.deepEqual(recent.itemIds, [2, 3, 1]);
  for (let id = 10; id < 20; id++) recent.add(id);
  assert.equal(recent.itemIds.length, 8);
  assert.deepEqual(
    new RecentItems(storage).itemIds,
    recent.itemIds,
    "persisted",
  );
});

test("Customize and Settings panels split the options, and presets only touch Customize", () => {
  const customizeKeys = new Set(
    CUSTOMIZE_GROUPS.flatMap((g) => g.options.map((o) => o.key)),
  );
  const settingsKeys = SETTINGS_GROUPS.flatMap((g) =>
    g.options.map((o) => o.key),
  );
  assert.ok(
    settingsKeys.every((key) => !customizeKeys.has(key)),
    "no option appears in both panels",
  );
  const layoutKeys = PRESET_KINDS.layout.keys,
    styleKeys = PRESET_KINDS.style.keys;
  assert.ok(
    layoutKeys.includes("direction") && styleKeys.includes("nodeShape"),
  );
  assert.ok(
    layoutKeys.every(
      (key) => customizeKeys.has(key) && !styleKeys.includes(key),
    ),
    "the kinds don't overlap",
  );
  assert.ok(styleKeys.every((key) => customizeKeys.has(key)));
  assert.ok(
    !styleKeys.includes("hideRawMaterials"),
    "filters are not part of a preset",
  );
});

test("every setting stays reachable without the ribbon: the View popover, Customize or Settings", async () => {
  const { DEFAULT_SETTINGS, VIEW_OPTION_GROUPS, getOptionDefinition } =
    await import("../web/src/config/settings-schema.js");
  const { POPOVER_GROUPS, QUICK_KEYS } =
    await import("../web/src/ui/view-popover.js");
  // Kept by the app itself, not chosen in a panel.
  const internal = new Set(["settingsRevision", "sidebarOpen", "sidebarWidth"]);
  const inPanels = new Set(
    VIEW_OPTION_GROUPS.flatMap((group) => group.options.map((o) => o.key)),
  );
  for (const key of Object.keys(DEFAULT_SETTINGS))
    assert.ok(
      internal.has(key) || inPanels.has(key) || QUICK_KEYS.includes(key),
      `${key} can be changed somewhere`,
    );
  for (const key of [...QUICK_KEYS, ...POPOVER_GROUPS.flatMap((g) => g.keys)])
    assert.ok(getOptionDefinition(key), `the popover's ${key} is defined`);
  for (const key of POPOVER_GROUPS.flatMap((g) => g.keys))
    assert.ok(inPanels.has(key), `${key} is also under All settings`);
});

test("the API key is remembered only when asked, and forgotten completely", () => {
  const memoryStorage = () => {
    const store = new Map();
    return {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    };
  };
  const local = memoryStorage();
  let tab = memoryStorage();
  const keys = new ApiKeyStore(local, tab);

  keys.set("tab-only", { remember: false });
  assert.equal(
    new ApiKeyStore(local, tab).get(),
    "tab-only",
    "other pages in the tab see it",
  );
  assert.equal(keys.isRemembered(), false);
  tab = memoryStorage(); // the tab closes
  assert.equal(
    new ApiKeyStore(local, tab).get(),
    null,
    "not kept across visits",
  );

  const keys2 = new ApiKeyStore(local, tab);
  keys2.set("kept", { remember: true });
  assert.equal(new ApiKeyStore(local, memoryStorage()).get(), "kept");
  assert.equal(keys2.isRemembered(), true);
  keys2.set("now-tab-only", { remember: false });
  assert.equal(
    new ApiKeyStore(local, memoryStorage()).get(),
    null,
    "un-remembering removes the saved copy",
  );
  keys2.clear();
  assert.equal(keys2.get(), null);
});
