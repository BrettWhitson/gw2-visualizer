import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CraftPlanner,
  MAX_COUNT,
  buildForwardGraph,
  chooseLayout,
  RADIAL_LEVEL_SIZE,
  filterAndSort,
  usefulMaterials,
} from "../public/src/model/craftable.js";
import { RECIPES, createFakeGameData } from "./helpers/fixtures.js";

/*
 * Fixture world (tests/helpers/fixtures.js):
 *   Sword (1) ← 2× Blade (2) + 1× Hilt (3)
 *   Blade (2) ← 3× Ingot (4)
 *   Ingot (4) ← 2× Ore (5), makes 2 per craft
 *   Hilt  (3) ← 1× Plank (6) + 50 coin
 *   Gift  (7) ← Mystic Forge: 1× Sword + 1× Gift
 */
const COIN = 1;

function planner({ owned = {}, wallet = {}, recipes } = {}) {
  const gameData = createFakeGameData(recipes ? { recipes } : {});
  const toMap = (object) =>
    new Map(Object.entries(object).map(([id, n]) => [Number(id), n]));
  return new CraftPlanner({
    getRecipes: (id) => gameData.getRecipes(id),
    getConsumers: (id) => gameData.getConsumers(id),
    owned: toMap(owned),
    wallet: toMap(wallet),
  });
}

test("multi-step: raw materials become the finished item", () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  assert.equal(p.canMake(1), true);
  assert.equal(p.maxMakeable(1), 1, "one plank → one hilt → one sword");
  const more = planner({ owned: { 5: 12, 6: 5 }, wallet: { [COIN]: 100 } });
  assert.equal(more.maxMakeable(1), 2, "then ore and coin run out at two");
});

test("surplus from a craft is used by later steps", () => {
  // Two blades need 6 ingots; ingots come in pairs, so 3 crafts = 6 ore (not 4 crafts = 8).
  assert.equal(planner({ owned: { 5: 6 } }).maxMakeable(2), 2);
  assert.equal(planner({ owned: { 5: 5 } }).maxMakeable(2), 1);
});

test("owned intermediates count, and nothing is made from thin air", () => {
  assert.equal(
    planner({ owned: { 4: 3 } }).maxMakeable(2),
    1,
    "3 owned ingots → a blade",
  );
  assert.equal(planner({ owned: { 4: 2 } }).canMake(2), false);
  assert.equal(
    planner({ owned: { 6: 3 } }).canMake(3),
    false,
    "a hilt needs coin from the wallet too",
  );
  assert.equal(
    planner({ owned: { 6: 3 }, wallet: { [COIN]: 50 } }).maxMakeable(3),
    1,
  );
});

test("owning the item itself isn't crafting it", () => {
  assert.equal(planner({ owned: { 2: 50 } }).canMake(2), false);
});

test("a recipe that needs its own output uses an owned copy, never itself", () => {
  const owned = { 5: 6, 6: 1 };
  assert.equal(planner({ owned, wallet: { [COIN]: 50 } }).canMake(7), false);
  assert.equal(
    planner({ owned: { ...owned, 7: 1 }, wallet: { [COIN]: 50 } }).canMake(7),
    true,
  );
});

test("alternative recipes are tried when the first falls short", () => {
  const recipes = [
    ...RECIPES,
    {
      ...RECIPES.find((r) => r.id === 102),
      id: 999,
      ingredients: [{ type: "Item", id: 6, count: 1 }],
    },
  ];
  const p = planner({ owned: { 6: 2 }, recipes }); // no ingots or ore, but planks
  assert.equal(p.maxMakeable(2), 2, "the plank recipe for blades");
});

test("counts stop at the cap", () => {
  assert.equal(planner({ owned: { 5: 1e7 } }).maxMakeable(4), MAX_COUNT);
});

test("craftable items are found forward from what's owned", async () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  assert.deepEqual([...p.forwardCandidates()].sort(), [1, 2, 3, 4, 7]);
  const found = await p.findCraftable();
  assert.deepEqual(
    found.map(({ itemId, count }) => [itemId, count]),
    [
      [4, 12],
      [2, 4],
      [1, 1],
      [3, 1],
    ],
    "most-makeable first; the gift needs a gift",
  );
});

test("the forward graph opens one level, folds big fan-outs and follows expansion", async () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const craftable = new Map(
    (await p.findCraftable()).map(({ itemId, count }) => [itemId, count]),
  );
  const options = {
    planner: p,
    craftable,
    expanded: new Set(),
    showAll: new Set(),
  };

  const first = buildForwardGraph(5, options);
  assert.deepEqual(
    first.nodes.map((n) => [n.nodeId, n.entityId, n.quantity, n.isCollapsed]),
    [
      ["r", 5, 12, false],
      ["r/4", 4, 12, true],
    ],
  );
  assert.deepEqual(
    first.edges.map((e) => [e.sourceId, e.targetId, e.quantity]),
    [["r", "r/4", 2]],
  );

  const opened = buildForwardGraph(5, {
    ...options,
    expanded: new Set(["r/4"]),
  });
  assert.ok(opened.nodesById.get("r/4/2"), "ingot → blade");
  assert.equal(opened.nodesById.get("r/4/2").entityId, 2);

  // With room for none, the root's one product folds into "+1 more"; opening it shows everything.
  const folded = buildForwardGraph(5, { ...options, childLimit: 0 });
  const more = folded.nodesById.get("r/more");
  assert.equal(more.isOverflow, true);
  assert.equal(more.quantity, 1);
  const all = buildForwardGraph(5, {
    ...options,
    showAll: new Set(["r"]),
    childLimit: 0,
  });
  assert.ok(all.nodesById.get("r/4") && !all.nodesById.get("r/more"));
});

test("the lists: materials that lead somewhere, filtered and sorted", async () => {
  const p = planner({
    owned: { 5: 12, 6: 1, 9999: 3 },
    wallet: { [COIN]: 100 },
  });
  const craftable = new Map(
    (await p.findCraftable()).map(({ itemId, count }) => [itemId, count]),
  );
  assert.deepEqual(
    usefulMaterials(p, craftable).map((m) => [m.itemId, m.productCount]),
    [
      [5, 1],
      [6, 1],
    ],
    "an owned item that feeds nothing craftable is left out",
  );

  const names = { 1: "Sword", 2: "Blade", 3: "Hilt", 4: "Ingot" };
  const entries = [...craftable].map(([itemId, count]) => ({ itemId, count }));
  const options = {
    nameOf: (id) => names[id],
    priceOf: (id) => ({ 1: 500, 2: 200 })[id] ?? null,
    rarityRankOf: (id) => (id === 1 ? 5 : 1),
    countOf: (entry) => entry.count,
  };
  const ids = (list) => list.map((entry) => entry.itemId);
  assert.deepEqual(
    ids(filterAndSort(entries, { ...options, sort: "value" })),
    [1, 2, 3, 4],
    "unpriced last, then by name",
  );
  assert.deepEqual(
    ids(filterAndSort(entries, { ...options, sort: "count" })),
    [4, 2, 3, 1],
    "ties by name",
  );
  assert.deepEqual(
    ids(filterAndSort(entries, { ...options, sort: "name", query: "bl" })),
    [2],
  );
  assert.deepEqual(
    ids(
      filterAndSort(entries, {
        ...options,
        sort: "name",
        isAllowed: (e) => e.itemId !== 2,
      }),
    ),
    [3, 4, 1],
  );
});

test("auto layout turns radial when a level gets crowded", () => {
  const graph = (perLevel) => ({
    nodes: perLevel.flatMap((count, depth) =>
      Array.from({ length: count }, () => ({ depth })),
    ),
  });
  assert.equal(chooseLayout(graph([1, 4, 12])), "columns");
  assert.equal(chooseLayout(graph([1, 4, RADIAL_LEVEL_SIZE + 1])), "radial");
  assert.equal(
    chooseLayout(graph([1, 80]), "columns"),
    "columns",
    "a chosen layout is kept",
  );
});

test("the forward graph honours collapsing, and stops at recipe loops", async () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const craftable = new Map(
    (await p.findCraftable()).map(({ itemId, count }) => [itemId, count]),
  );
  const graph = buildForwardGraph(5, {
    planner: p,
    craftable,
    expanded: new Set(),
    collapsed: new Set(["r"]),
    showAll: new Set(),
  });
  assert.deepEqual(
    graph.nodes.map((n) => n.nodeId),
    ["r"],
    "the root closed by the user",
  );
  assert.equal(graph.nodes[0].isCollapsed, true);
});

test("a deep enough chain is beyond the plan depth", () => {
  // item n+1 ← item n, 20 steps: too deep to plan from the first.
  const recipes = Array.from({ length: 20 }, (_, n) => ({
    id: 5000 + n,
    source: "api",
    type: "Refinement",
    outputItemId: 1001 + n,
    outputCount: 1,
    disciplines: [],
    minRating: 0,
    craftTimeMs: 0,
    flags: [],
    ingredients: [{ type: "Item", id: 1000 + n, count: 1 }],
  }));
  const p = planner({ owned: { 1000: 5 }, recipes });
  assert.equal(p.canMake(1003), true, "a few steps is fine");
  assert.equal(p.canMake(1020), false, "twenty isn't");
});
