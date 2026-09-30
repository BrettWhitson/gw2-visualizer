import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CraftPlanner,
  MAX_COUNT,
  buildForwardGraph,
  chooseLayout,
  RADIAL_LEVEL_SIZE,
  filterAndSort,
  profitOf,
  sellIntoBuyOrders,
  routeFrom,
  analyseProfits,
  findBlocked,
  tradingPostNet,
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

function planner({ owned = {}, wallet = {}, recipes, recipeAllowed } = {}) {
  const gameData = createFakeGameData(recipes ? { recipes } : {});
  const toMap = (object) =>
    new Map(Object.entries(object).map(([id, n]) => [Number(id), n]));
  return new CraftPlanner({
    getRecipes: (id) => gameData.getRecipes(id),
    getConsumers: (id) => gameData.getConsumers(id),
    owned: toMap(owned),
    wallet: toMap(wallet),
    recipeAllowed,
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
    ids(
      filterAndSort(entries, {
        ...options,
        sort: "profit",
        profitOf: (entry) => ({ 1: 50, 2: 300 })[entry.itemId] ?? null,
      }),
    ),
    [2, 1, 3, 4],
    "most profit first; unknown profit last, by name",
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

// ---------------------------------------------------------------- profit

test("a plan explains its crafts, what it uses up and what it spends", () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const plan = p.explain(1, 1);
  // 1 sword ← 2 blades ← 6 ingots (3 crafts of 2) ← 6 ore; 1 hilt ← 1 plank + 50 coin.
  assert.deepEqual(
    [...plan.steps]
      .map(([id, step]) => [id, step.crafts])
      .sort((a, b) => a[0] - b[0]),
    [
      [1, 1],
      [2, 2],
      [3, 1],
      [4, 3],
    ],
  );
  assert.deepEqual(Object.fromEntries(plan.consumed), { 5: 6, 6: 1 });
  assert.deepEqual(Object.fromEntries(plan.spent), { [COIN]: 50 });
  assert.equal(p.explain(1, 5), null, "more than can be made");
});

test("profit is the sale minus what the used-up materials would sell for, after the Trading Post's cut", () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const prices = { 1: 500, 5: 5, 6: 3 };
  const result = profitOf(p, 1, 1, (id) => prices[id] ?? null);
  assert.equal(result.revenue, 500 - 25 - 50);
  assert.equal(
    result.cost,
    6 * tradingPostNet(5) + 1 * tradingPostNet(3) + 50,
    "fees per unit on each input; coin at face value",
  );
  assert.equal(result.profit, result.revenue - result.cost);

  const unsellable = profitOf(p, 1, 1, (id) =>
    id === 1 ? 500 : id === 5 ? 5 : null,
  );
  assert.deepEqual(
    unsellable.unvaluedInputs,
    [6],
    "the plank has no buyers: counted as free, and reported",
  );
  assert.equal(
    profitOf(p, 1, 1, () => null).profit,
    null,
    "an output nobody buys has no profit",
  );
});

test("routes lead from a material through each craft to the product", () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const plan = p.explain(1, 1);
  assert.deepEqual(
    routeFrom(plan, 1, 5),
    [5, 4, 2, 1],
    "ore → ingot → blade → sword",
  );
  assert.deepEqual(routeFrom(plan, 1, 6), [6, 3, 1], "plank → hilt → sword");
  assert.equal(routeFrom(plan, 1, 999), null);
});

test("each material's most profitable uses, and the best profit through each item", async () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const entries = await p.findCraftable();
  const prices = { 1: 500, 2: 40, 4: 6, 5: 5, 6: 3 };
  const { byItem, bestByMaterial, bestThrough } = await analyseProfits(
    p,
    entries,
    (id) => prices[id] ?? null,
  );
  assert.equal(byItem.has(3), false, "hilts have no buyers: no profit to rank");
  const oreBest = bestByMaterial.get(5);
  assert.deepEqual(
    oreBest.map((b) => b.itemId),
    [1, 2, 4].sort((a, b) => byItem.get(b).profit - byItem.get(a).profit),
    "ore's uses, best first",
  );
  assert.equal(
    bestThrough.get(4),
    Math.max(...oreBest.map((b) => b.profit)),
    "ingots lead to the best of them",
  );
});

test("routes to point out are always shown and flagged", async () => {
  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const craftable = new Map(
    (await p.findCraftable()).map(({ itemId, count }) => [itemId, count]),
  );
  const graph = buildForwardGraph(5, {
    planner: p,
    craftable,
    expanded: new Set(["r/4", "r/4/2"]),
    showAll: new Set(),
    highlight: new Set(["r/4", "r/4/2", "r/4/2/1"]),
    childLimit: 0,
  });
  assert.deepEqual(
    graph.nodes.filter((n) => n.isBestRoute).map((n) => n.nodeId),
    ["r/4", "r/4/2", "r/4/2/1"],
    "ore → ingot → blade → sword, despite a limit of none",
  );
});

test("big stacks are priced at what the buy orders can take", () => {
  const orders = [
    { unitPrice: 1000, quantity: 1 },
    { unitPrice: 10, quantity: 5 },
  ];
  assert.deepEqual(sellIntoBuyOrders(orders, 3), {
    gross: 1000 + 2 * 10,
    net: 850 + 2 * 8,
    sold: 3,
  });
  assert.deepEqual(
    sellIntoBuyOrders(orders, 50),
    { gross: 1050, net: 850 + 5 * 8, sold: 6 },
    "only 6 buyers",
  );
  assert.deepEqual(sellIntoBuyOrders([], 5), { gross: 0, net: 0, sold: 0 });

  const p = planner({ owned: { 5: 12, 6: 1 }, wallet: { [COIN]: 100 } });
  const valueOf = (id) => ({ 1: 1000, 5: 5, 6: 3 })[id] ?? null;
  const naive = profitOf(p, 1, 1, valueOf);
  const real = profitOf(p, 1, 1, valueOf, {
    buyOrders: [{ unitPrice: 400, quantity: 9 }],
  });
  assert.equal(
    real.revenue,
    tradingPostNet(400),
    "the order book, not the headline price",
  );
  assert.ok(real.profit < naive.profit);
  const noBuyers = profitOf(p, 1, 1, valueOf, { buyOrders: [] });
  assert.equal(noBuyers.profit, null);
  assert.equal(noBuyers.sold, 0);
});

test("steps opened only to follow a route show just the route", async () => {
  const p = planner({ owned: { 5: 12, 6: 1, 4: 3 }, wallet: { [COIN]: 100 } });
  const craftable = new Map(
    (await p.findCraftable()).map(({ itemId, count }) => [itemId, count]),
  );
  // From ingots (4): blades (2) → swords (1). Focusing r/2 on the sword route hides nothing else here, so check the
  // fold: with no highlighted children, a focused node shows only "+N more".
  const graph = buildForwardGraph(4, {
    planner: p,
    craftable,
    expanded: new Set(),
    showAll: new Set(),
    focus: new Set(["r/2"]),
    highlight: new Set(["r/2"]),
  });
  assert.equal(
    graph.nodesById.get("r/2/1"),
    undefined,
    "the sword isn't on the route",
  );
  assert.equal(
    graph.nodesById.get("r/2/more")?.quantity,
    1,
    "the sword folded away",
  );
});

test("Trading Post fees are per unit, each at least 1 copper", () => {
  assert.equal(tradingPostNet(100), 85, "5% listing + 10% exchange");
  assert.equal(tradingPostNet(30), 30 - 2 - 3, "1.5c rounds up to 2c");
  assert.equal(
    tradingPostNet(103),
    103 - 6 - 11,
    "fees round up: never an overstated profit",
  );
  assert.equal(tradingPostNet(10), 8, "the listing fee's 1c minimum");
  assert.equal(tradingPostNet(2), 0, "1c + 1c: nothing left");
  assert.equal(tradingPostNet(1), 0, "never below nothing");
  assert.equal(tradingPostNet(0), 0);
  assert.deepEqual(
    sellIntoBuyOrders([{ unitPrice: 2, quantity: 5000 }], 1000),
    { gross: 2000, net: 0, sold: 1000 },
    "a thousand 2c items net nothing, not 85% of 20s",
  );
});

test("a partial sale is costed for what sells, not everything that could be made", () => {
  const p = planner({ owned: { 5: 12 } });
  const valueOf = (id) => ({ 4: 100, 5: 5 })[id] ?? null;
  const partial = profitOf(p, 4, 12, valueOf, {
    buyOrders: [{ unitPrice: 100, quantity: 4 }],
  });
  assert.equal(partial.sold, 4);
  assert.equal(partial.revenue, 4 * 85);
  assert.deepEqual(
    Object.fromEntries(partial.plan.consumed),
    { 5: 4 },
    "the plan for 4 ingots: 4 ore",
  );
  assert.equal(partial.cost, profitOf(p, 4, 4, valueOf).cost);
  assert.equal(partial.profit, 4 * 85 - 4 * tradingPostNet(5));
});

test("recipes a character can't make are left out at every step", async () => {
  // Blades from ingots (102) are off limits: no blades, so no swords either, though the sword's own recipe is fine.
  const owned = { 5: 12, 6: 1 };
  const wallet = { [COIN]: 100 };
  const recipeAllowed = (recipe) => recipe.id !== 102;
  const limited = planner({ owned, wallet, recipeAllowed });
  assert.equal(limited.canMake(2), false);
  assert.equal(
    limited.canMake(1),
    false,
    "the blocked recipe is an intermediate",
  );
  assert.equal(limited.canMake(4), true);
  const found = await limited.findCraftable();
  assert.deepEqual(found.map((entry) => entry.itemId).sort(), [3, 4]);

  const open = planner({ owned, wallet });
  assert.equal(open.canMake(1), true, "no predicate: unchanged");
  const blocked = await findBlocked(
    open,
    new Map(found.map(({ itemId, count }) => [itemId, count])),
  );
  assert.deepEqual(
    blocked.map(({ itemId, recipe }) => [itemId, recipe.id]).sort(),
    [
      [1, 101],
      [2, 102],
    ],
    "what the restriction hides, with the recipe it would need",
  );
});

test("a product is linked only when its chosen recipe uses the item", async () => {
  // Blades can also be made from planks (999), but with ore to hand the plan uses ingots (102).
  const recipes = [
    ...RECIPES,
    {
      ...RECIPES.find((r) => r.id === 102),
      id: 999,
      ingredients: [{ type: "Item", id: 6, count: 1 }],
    },
  ];
  const p = planner({
    owned: { 5: 12, 6: 2 },
    wallet: { [COIN]: 100 },
    recipes,
  });
  const craftable = new Map(
    (await p.findCraftable()).map(({ itemId, count }) => [itemId, count]),
  );
  assert.ok(craftable.has(2));
  const graph = buildForwardGraph(6, {
    planner: p,
    craftable,
    expanded: new Set(),
    showAll: new Set(),
  });
  assert.deepEqual(
    graph.edges.map((e) => [e.targetId, e.quantity]),
    [["r/3", 1]],
    "planks → hilts; no blade edge, and no made-up ×1",
  );
  assert.deepEqual(
    usefulMaterials(p, craftable).find((m) => m.itemId === 6)?.productCount,
    1,
  );
});
