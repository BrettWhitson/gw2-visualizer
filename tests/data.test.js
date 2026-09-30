import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ItemSearchIndex,
  decodeItemChatLink,
} from "../web/src/data/item-search-index.js";
import {
  Gw2ApiClient,
  MAX_RETRY_AFTER_MS,
  normalizeRecipe,
  normalizeItem,
  withSchemaVersion,
} from "../web/src/data/gw2-api-client.js";
import { GW2_API_SCHEMA_VERSION } from "../web/src/config/constants.js";
import { GameData } from "../web/src/data/game-data.js";
import { PriceBook } from "../web/src/data/price-book.js";
import { createFakeGameData } from "./helpers/fixtures.js";

test("decodes item chat links", () => {
  assert.equal(decodeItemChatLink("[&AgGu4gEA]"), 123566);
  assert.equal(decodeItemChatLink("see [&AgEBTQAA] here"), 19713);
  assert.equal(decodeItemChatLink("[&BAAAAA==]"), null, "non-item link");
  assert.equal(decodeItemChatLink("no link"), null);
});

test("search ranks exact > prefix > word > substring, craftable first", () => {
  const gameData = createFakeGameData();
  const index = new ItemSearchIndex(gameData);
  index.rebuild();
  assert.deepEqual(index.search("test blade"), [2]);
  assert.equal(
    index.search("test")[0],
    1,
    "craftable Exotic sword outranks lower rarities",
  );
  assert.deepEqual(index.search("4"), [4], "numeric id");
  assert.deepEqual(index.search("  "), []);
  assert.ok(index.search("ore").includes(5));
});

test("normalizes API recipes including guild ingredients and named wiki ingredients", () => {
  const recipe = normalizeRecipe(
    {
      id: 9,
      type: "Refinement",
      output_item_id: 5,
      output_item_count: 2,
      disciplines: ["Chef"],
      min_rating: 25,
      ingredients: [
        { type: "Item", id: 1, count: 3 },
        { type: "Named", name: "Charm (ingredient)", count: 1 },
      ],
      guild_ingredients: [{ upgrade_id: 77, count: 4 }],
    },
    "api",
  );
  assert.equal(recipe.outputItemId, 5);
  assert.equal(recipe.outputCount, 2);
  assert.deepEqual(recipe.ingredients, [
    { type: "Item", id: 1, count: 3 },
    { type: "Named", id: "Charm (ingredient)", count: 1 },
    { type: "GuildUpgrade", id: 77, count: 4 },
  ]);
  assert.equal(
    normalizeItem({ id: 1, name: "X", chat_link: "[&x]" }).chatLink,
    "[&x]",
  );
});

test("PriceBook falls back to the other side of the book and reports untradeable items", async () => {
  const api = {
    getPrices: async () => [
      { id: 1, buy: 0, sell: 50 },
      { id: 2, buy: 10, sell: 12 },
    ],
  };
  const book = new PriceBook(api);
  assert.equal(await book.ensure([1, 2, 3]), true);
  assert.equal(await book.ensure([1, 2]), false, "nothing new to fetch");
  assert.equal(book.getUnitPrice(1, "buy"), 50, "no buy orders → sell price");
  assert.equal(book.getUnitPrice(2, "sell"), 12);
  assert.equal(book.getUnitPrice(3, "sell"), null);
  assert.equal(book.has(3), true, "looked up, not tradeable");
  assert.equal(book.getUnitPrice(2, "off"), null);
});

/** GameData.load with a fake API and cache — exercises caching, legacy migration and forge promotion rules. */
function createFakeDependencies({ cached = null } = {}) {
  const store = new Map(cached ? [["data", cached]] : []);
  const calls = { recipes: 0 };
  const api = {
    getBuildId: async () => 42,
    getAllRecipeIds: async () => [1],
    getRecipes: async () => {
      calls.recipes++;
      return [
        normalizeRecipe(
          {
            id: 1,
            output_item_id: 10,
            ingredients: [{ type: "Item", id: 11, count: 2 }],
          },
          "api",
        ),
      ];
    },
    getItems: async (ids) =>
      [...ids].map((id) =>
        normalizeItem({
          id,
          name: `Item ${id}`,
          type: id === 24351 ? "CraftingMaterial" : "Trophy",
          flags: [],
        }),
      ),
    getAllCurrencies: async () => [{ id: 1, name: "Coin", icon: "" }],
    getGuildUpgrades: async () => [],
  };
  const cache = {
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
  };
  return { api, cache, store, calls };
}

test("GameData downloads once, caches, and classifies Mystic Forge promotions", async () => {
  const { api, cache, store, calls } = createFakeDependencies();
  const gameData = new GameData({ apiClient: api, cache, snapshot: null });
  const summary = await gameData.load();
  assert.equal(calls.recipes, 1);
  assert.equal(summary.apiRecipeCount, 1);
  assert.ok(summary.forgeRecipeCount > 1000, "bundled wiki recipes loaded");
  assert.equal(store.get("data").schemaVersion, 2);
  assert.deepEqual(gameData.getRecipes(10)[0].ingredients, [
    { type: "Item", id: 11, count: 2 },
  ]);
  assert.deepEqual([...gameData.getConsumers(11)], [10]);

  // Vicious Claw's forge recipe consumes a Vicious Claw → a promotion, not a forge result.
  const viciousClaw = gameData.getRecipes(24351).find((r) => r.source === "mf");
  assert.equal(viciousClaw.isPromotion, true);

  await new GameData({ apiClient: api, cache, snapshot: null }).load();
  assert.equal(calls.recipes, 1, "second load served from cache");
});

test("GameData migrates the pre-refactor cache format instead of re-downloading", async () => {
  const legacy = {
    v: 1,
    build: 42,
    time: Date.now(),
    recipes: [
      {
        id: 1,
        source: "api",
        type: "Refinement",
        out: 10,
        outCount: 1,
        disc: ["Chef"],
        rating: 0,
        time: 0,
        flags: [],
        ing: [{ t: "Item", id: 11, n: 3 }],
      },
    ],
    items: [
      {
        id: 10,
        name: "Legacy",
        icon: "",
        rarity: "Fine",
        type: "Trophy",
        level: 0,
        chat: "[&a]",
        flags: [],
      },
    ],
    currencies: [],
    guild: [],
  };
  const { api, cache, calls } = createFakeDependencies({ cached: legacy });
  const gameData = new GameData({ apiClient: api, cache, snapshot: null });
  await gameData.load();
  assert.equal(calls.recipes, 0);
  assert.equal(gameData.getRecipes(10)[0].ingredients[0].count, 3);
  assert.equal(gameData.items.get(10).chatLink, "[&a]");
});

test("every API request pins the response schema version", () => {
  const pinned = encodeURIComponent(GW2_API_SCHEMA_VERSION);
  assert.equal(
    withSchemaVersion("https://api.guildwars2.com/v2/items?ids=1,2"),
    `https://api.guildwars2.com/v2/items?ids=1,2&v=${pinned}`,
  );
  assert.equal(
    withSchemaVersion("https://api.guildwars2.com/v2/build"),
    `https://api.guildwars2.com/v2/build?v=${pinned}`,
  );
  assert.equal(
    withSchemaVersion("https://x/y?v=latest"),
    "https://x/y?v=latest",
    "an explicit version is kept",
  );
});

test("the published snapshot is preferred; returning visitors never call the GW2 API", async () => {
  const { api, cache, calls } = createFakeDependencies();
  let buildChecks = 0;
  api.getBuildId = async () => {
    buildChecks++;
    return 43;
  };
  const snapshotData = {
    schemaVersion: 2,
    buildId: 43,
    cachedAt: Date.now(),
    recipes: [],
    items: [
      normalizeItem({ id: 10, name: "Item 10", type: "Trophy", flags: [] }),
    ],
    currencies: [],
    guildUpgrades: [],
  };
  let metaChecks = 0;
  const snapshot = {
    fetchData: async () => snapshotData,
    fetchMeta: async () => {
      metaChecks++;
      return {
        schemaVersion: 2,
        buildId: 43,
        generatedAt: snapshotData.cachedAt,
      };
    },
  };
  await new GameData({ apiClient: api, cache, snapshot }).load();
  assert.equal(calls.recipes, 0, "no API download when a snapshot exists");

  const updates = [];
  await new GameData({ apiClient: api, cache, snapshot }).load({
    onUpdateAvailable: (build) => updates.push(build),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(metaChecks, 1, "the update check reads the snapshot's metadata");
  assert.equal(buildChecks, 0, "not the GW2 API");
  assert.deepEqual(updates, [], "same build: nothing to offer");
});

test("price batches run 16 at a time; other lookups 8", async (t) => {
  let inFlight = 0,
    peak = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight--;
    const ids = new URL(url).searchParams.get("ids").split(",").map(Number);
    return new Response(
      JSON.stringify(
        ids.map((id) => ({
          id,
          buys: { unit_price: 1 },
          sells: { unit_price: 2 },
        })),
      ),
      { status: 200 },
    );
  });
  const api = new Gw2ApiClient("https://api.example/v2");
  const ids = Array.from({ length: 40 * 200 }, (_, i) => i + 1);
  const prices = await api.getPrices(ids);
  assert.equal(prices.length, ids.length);
  assert.equal(peak, 16);
  peak = 0;
  await api.fetchByIds("/items", ids);
  assert.equal(peak, 8);
});

test("ids in a batch that failed are reported, apart from ids the API doesn't know", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const ids = new URL(url).searchParams.get("ids").split(",").map(Number);
    if (ids.includes(250)) return new Response("{}", { status: 400 });
    return new Response(
      JSON.stringify(
        ids
          .filter((id) => id !== 3) // untradeable: left out of a good answer
          .map((id) =>
            url.includes("listings")
              ? { id, buys: [{ unit_price: 1, quantity: 1 }] }
              : { id, buys: { unit_price: 1 }, sells: {} },
          ),
      ),
      { status: 200 },
    );
  });
  const api = new Gw2ApiClient("https://api.example/v2");
  const ids = Array.from({ length: 400 }, (_, i) => i + 1);
  const failedIds = new Set();
  const prices = await api.getPrices(ids, { failedIds });
  assert.equal(prices.length, 199, "the first batch, less the untradeable id");
  assert.deepEqual([...failedIds], ids.slice(200), "the whole second batch");

  const orderFailures = new Set();
  const orders = await api.getBuyOrders(ids, { failedIds: orderFailures });
  assert.equal(orders.has(3), false);
  assert.equal(orderFailures.has(3), false);
  assert.equal(orderFailures.size, 200);
  assert.equal(
    (await api.getPrices(ids)).length,
    199,
    "same answer without asking",
  );
});

test("a long Retry-After is capped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? new Response("", { status: 429, headers: { "Retry-After": "3600" } })
      : new Response("[1]", { status: 200 }),
  );
  const api = new Gw2ApiClient("https://api.example/v2");
  let result = null;
  const request = api.fetchJson("/x").then((value) => (result = value));
  const turns = async () => {
    for (let i = 0; i < 20; i++)
      await new Promise((resolve) => setImmediate(resolve));
  };
  await turns();
  t.mock.timers.tick(MAX_RETRY_AFTER_MS - 1);
  await turns();
  assert.equal(calls, 1, "still waiting");
  t.mock.timers.tick(1);
  await turns();
  await request;
  assert.deepEqual(result, [1], "retried after the cap, not an hour");
});
