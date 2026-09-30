import { UNLIMITED_DEPTH } from "../public/src/config/constants.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CraftTreeBuilder,
  collectShoppingList,
  collectMissingCraftingLevels,
  walkTree,
  getCollapseKey,
} from "../public/src/model/craft-tree.js";
import { TreeState } from "../public/src/model/tree-state.js";
import {
  RECIPES,
  createFakeGameData,
  createFakePriceBook,
  createSettings,
} from "./helpers/fixtures.js";

function buildTree({
  rootItemId = 1,
  rootQuantity = 1,
  settings = {},
  prices = {},
  configureState,
  account = null,
  recipes,
} = {}) {
  const treeState = new TreeState();
  treeState.rootItemId = rootItemId;
  treeState.rootQuantity = rootQuantity;
  configureState?.(treeState);
  const builder = new CraftTreeBuilder({
    gameData: createFakeGameData(recipes ? { recipes } : {}),
    priceBook: createFakePriceBook(prices),
    settings: createSettings({ useOwned: true, ...settings }),
    treeState,
    getAccount: () => account,
  });
  return builder.build();
}

const findByEntity = (root, entityId) => {
  const found = [];
  walkTree(root, (node) => {
    if (node.entityId === entityId) found.push(node);
  });
  return found;
};

test("scales ingredient quantities by craft count, rounding crafts up per output count", () => {
  const root = buildTree({ rootQuantity: 3 });
  const [ingot] = findByEntity(root, 4);
  const [ore] = findByEntity(root, 5);
  assert.equal(findByEntity(root, 2)[0].quantity, 6); // 3 swords × 2 blades
  assert.equal(ingot.quantity, 18); // 6 blades × 3 ingots
  assert.equal(ingot.craftCount, 9); // ingot recipe makes 2 → ceil(18 / 2)
  assert.equal(ore.quantity, 18); // 9 crafts × 2 ore
});

test("assigns stable path ids from the root", () => {
  const root = buildTree();
  assert.equal(root.path, "r");
  assert.deepEqual(
    root.children.map((c) => c.path),
    ["r/0", "r/1"],
  );
});

test("marks recipes that loop back to an ancestor as cycles and stops expanding", () => {
  const root = buildTree({ rootItemId: 7 });
  const selfReference = root.children.find((c) => c.entityId === 7);
  assert.equal(selfReference.isCycle, true);
  assert.equal(selfReference.children.length, 0);
});

test("collapses beyond maxDepth unless the user expanded that node", () => {
  const shallow = buildTree({ settings: { maxDepth: 1 } });
  assert.ok(
    shallow.children.every((c) => c.isCollapsed && c.children.length === 0),
  );

  const expanded = buildTree({
    settings: { maxDepth: 1 },
    configureState: (state) => state.expandedKeys.add("r/0"),
  });
  assert.equal(expanded.children[0].isCollapsed, false);
  assert.equal(expanded.children[1].isCollapsed, true);
});

test("user collapse wins over everything", () => {
  const root = buildTree({
    configureState: (state) => state.collapsedKeys.add("r/0"),
  });
  assert.equal(root.children[0].isCollapsed, true);
});

test("Mystic Forge promotions are bought unless included", () => {
  const treeState = new TreeState();
  treeState.rootItemId = 4;
  const gameData = createFakeGameData();
  gameData.getRecipes(4)[0].isPromotion = true;
  try {
    const build = (settings) =>
      new CraftTreeBuilder({
        gameData,
        priceBook: createFakePriceBook(),
        settings,
        treeState,
      }).build();
    const skipped = build(createSettings());
    assert.equal(skipped.recipe, null, "promotion ignored → raw material");
    assert.equal(skipped.children.length, 0);
    const included = build(createSettings({ includeForgePromotions: true }));
    assert.equal(included.recipe.isPromotion, true);
    assert.ok(included.children.length > 0, "expands into its forge inputs");
  } finally {
    gameData.getRecipes(4)[0].isPromotion = false;
  }
});

test("the top depth step means no limit", () => {
  const treeState = new TreeState();
  treeState.rootItemId = 1;
  const build = (maxDepth) =>
    new CraftTreeBuilder({
      gameData: createFakeGameData(),
      priceBook: createFakePriceBook(),
      settings: createSettings({ maxDepth }),
      treeState,
    }).build();
  const shallow = build(1);
  assert.ok(shallow.children.every((child) => !child.children.length));
  assert.ok(shallow.children.some((child) => child.isCollapsed));
  const full = build(UNLIMITED_DEPTH);
  assert.ok(full.children.some((child) => child.children.length));
});

test("rolls up craft cost, buy cost and flags when buying is cheaper", () => {
  // 2 blades → 6 ingots → 3 ingot crafts (makes 2) → 6 ore at 100c = 600c to craft, vs 2 × 10c to buy.
  const root = buildTree({ prices: { 2: 10, 5: 100, 6: 1 } });
  const [blade] = findByEntity(root, 2);
  assert.equal(blade.buyCost, 20); // 2 blades × 10
  assert.equal(blade.craftCost, 600);
  assert.equal(blade.isBuyCheaper, true);
  const [hilt] = findByEntity(root, 3);
  assert.equal(hilt.craftCost, 1 + 50, "coin ingredients count at face value");
});

test("marks craft cost partial when an ingredient has no price", () => {
  const root = buildTree({ prices: {} });
  assert.equal(root.isCraftCostPartial, true);
  assert.equal(root.isBuyCheaper, false);
});

test("prefers Mystic Forge recipes when the setting is on", () => {
  const gameData = createFakeGameData();
  gameData.recipesByOutputId
    .get(1)
    .push({ ...gameData.getRecipes(1)[0], id: "mf-alt", source: "mf" });
  const treeState = new TreeState();
  treeState.rootItemId = 1;
  const root = new CraftTreeBuilder({
    gameData,
    priceBook: createFakePriceBook(),
    settings: createSettings({ preferMysticForge: true }),
    treeState,
  }).build();
  assert.equal(root.recipe.id, "mf-alt");
  assert.equal(root.alternativeRecipeCount, 2);
});

test("shopping list aggregates leaves, most expensive first (coin counts at face value)", () => {
  const root = buildTree({ prices: { 5: 3, 6: 7 } });
  const list = collectShoppingList(root);
  assert.deepEqual(
    list.map((e) => [e.kind, e.entityId, e.quantity, e.totalCost]),
    [
      ["currency", 1, 50, 50],
      ["item", 5, 6, 18],
      ["item", 6, 1, 7],
    ],
  );
});

test("collapse keys are per path in tree view and per entity in merged view", () => {
  const node = { path: "r/1/0", kind: "item", entityId: 6 };
  assert.equal(getCollapseKey(node, "tree"), "r/1/0");
  assert.equal(getCollapseKey(node, "merged"), "item:6");
});

// ---------------------------------------------------------------- owned items

/** Account stand-in: item id → owned count. */
const ownedAccount = (owned, craftingLevels = new Map()) => ({
  ownedItems: new Map(Object.entries(owned).map(([id, n]) => [Number(id), n])),
  craftingLevels,
});

test("owned items are used first, top-down, and what you hold enough of isn't expanded", () => {
  // Sword ← 2 Blade ← 3 Ingot each ← Ore. Own 1 Blade and 4 Ingots.
  const root = buildTree({ account: ownedAccount({ 2: 1, 4: 4, 5: 100 }) });
  const [blade] = findByEntity(root, 2);
  assert.equal(blade.ownedQuantity, 1);
  assert.equal(blade.craftCount, 1, "only the missing blade is crafted");
  const [ingot] = findByEntity(root, 4);
  assert.equal(
    ingot.quantity,
    3,
    "ingredients scale with what's left to craft",
  );
  assert.equal(ingot.isOwnedEnough, true);
  assert.equal(ingot.children.length, 0, "owned ingots need no ore");
  assert.deepEqual(findByEntity(root, 5), []);

  const list = collectShoppingList(root);
  const ingotEntry = list.find((entry) => entry.entityId === 4);
  assert.deepEqual([ingotEntry.quantity, ingotEntry.owned], [0, 3]);
  assert.equal(list.at(-1), ingotEntry, "entries you already have come last");
});

test("partly owned: only the rest is bought or crafted, and costs count only that", () => {
  const root = buildTree({
    account: ownedAccount({ 4: 4 }),
    prices: { 4: 10, 5: 3 },
  });
  const [ingot] = findByEntity(root, 4); // 6 needed, 4 owned
  assert.equal(ingot.ownedQuantity, 4);
  assert.equal(ingot.craftCount, 1, "2 more ingots = one craft of 2");
  assert.equal(findByEntity(root, 5)[0].quantity, 2);
  assert.equal(ingot.buyCost, 2 * 10);
  assert.equal(ingot.craftCost, 2 * 3);
  assert.equal(ingot.ownedValue, 4 * 10, "what the owned ingots are worth");
});

test("owned stock is shared across the tree, and the root is always crafted", () => {
  const root = buildTree({
    rootQuantity: 2,
    account: ownedAccount({ 1: 5, 6: 1 }),
  });
  assert.equal(
    root.ownedQuantity,
    0,
    "owning the result doesn't skip making it",
  );
  const planks = findByEntity(root, 6); // one Hilt per sword → 2 planks in one occurrence
  assert.equal(
    planks.reduce((sum, node) => sum + node.ownedQuantity, 0),
    1,
  );
});

test("owned items are ignored when the setting is off or no account is connected", () => {
  for (const options of [
    { account: ownedAccount({ 2: 5 }), settings: { useOwned: false } },
    { account: null },
  ]) {
    const [blade] = findByEntity(buildTree(options), 2);
    assert.equal(blade.ownedQuantity, 0);
    assert.equal(blade.children.length, 1);
  }
});

test("crafted steps no character has the level for are flagged", () => {
  const recipes = RECIPES.map((recipe) =>
    recipe.id === 102 ? { ...recipe, minRating: 400 } : recipe,
  );
  const levels = new Map([["Weaponsmith", { rating: 300, character: "Alt" }]]);
  const root = buildTree({ recipes, account: ownedAccount({}, levels) });
  assert.deepEqual(findByEntity(root, 2)[0].missingCraftingLevels, [
    { discipline: "Weaponsmith", rating: 400, have: 300 },
  ]);
  assert.equal(root.missingCraftingLevels, null, "rating 0 recipes are fine");
  const [missing] = collectMissingCraftingLevels(
    buildTree({ rootQuantity: 2, recipes, account: ownedAccount({}, levels) }),
  );
  assert.deepEqual(
    [...missing.itemIds],
    [2],
    "grouped per requirement, each item once",
  );
});
