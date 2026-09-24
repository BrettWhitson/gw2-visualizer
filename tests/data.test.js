import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ItemSearchIndex,
  decodeItemChatLink,
} from "../public/src/data/item-search-index.js";
import {
  normalizeRecipe,
  normalizeItem,
  withSchemaVersion,
} from "../public/src/data/gw2-api-client.js";
import { GW2_API_SCHEMA_VERSION } from "../public/src/config/constants.js";
import { GameData } from "../public/src/data/game-data.js";
import { PriceBook } from "../public/src/data/price-book.js";
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
