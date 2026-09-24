import { UNLIMITED_DEPTH } from "../public/src/config/constants.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CraftTreeBuilder,
  collectShoppingList,
  walkTree,
  getCollapseKey,
} from "../public/src/model/craft-tree.js";
import { TreeState } from "../public/src/model/tree-state.js";
import {
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
} = {}) {
  const treeState = new TreeState();
  treeState.rootItemId = rootItemId;
  treeState.rootQuantity = rootQuantity;
  configureState?.(treeState);
  const builder = new CraftTreeBuilder({
    gameData: createFakeGameData(),
    priceBook: createFakePriceBook(prices),
    settings: createSettings(settings),
    treeState,
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
