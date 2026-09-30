import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceBook } from "../public/src/data/price-book.js";
import { RecentItems } from "../public/src/core/recent-items.js";
import { ApiKeyStore } from "../public/src/core/api-key-store.js";
import {
  CUSTOMIZE_GROUPS,
  SETTINGS_GROUPS,
  PRESET_KINDS,
} from "../public/src/config/settings-schema.js";

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

test("every ribbon control belongs to a section, so its section reset covers it", async () => {
  const { readFileSync } = await import("node:fs");
  const { RIBBON_SECTIONS, sectionResetKeys } =
    await import("../public/src/ui/ribbon-sections.js");
  const { VIEW_OPTION_GROUPS } =
    await import("../public/src/config/settings-schema.js");
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const ribbon = html.slice(
    html.indexOf('<nav id="toolbar"'),
    html.indexOf("</nav>"),
  );
  const controls = [...ribbon.matchAll(/data-setting="(\w+)"/g)].map(
    (m) => m[1],
  );
  const groupIds = new Set(VIEW_OPTION_GROUPS.map((group) => group.id));
  for (const [id, section] of Object.entries(RIBBON_SECTIONS))
    for (const group of section.groups)
      assert.ok(groupIds.has(group), `${id}: unknown group ${group}`);
  const covered = new Set(
    Object.keys(RIBBON_SECTIONS).flatMap((id) =>
      sectionResetKeys(id, VIEW_OPTION_GROUPS),
    ),
  );
  for (const key of controls)
    assert.ok(
      covered.has(key),
      `ribbon control ${key} is reset by some section`,
    );
  // Each section's ⌄ opens exactly the section it names.
  for (const [, section] of ribbon.matchAll(/data-section-toggle="(\w+)"/g))
    assert.ok(
      RIBBON_SECTIONS[section]?.groups.length,
      `${section} has a popout`,
    );
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
