import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGraphModel,
  isForgeResult,
  getSourceCategory,
  getDisciplineKey,
} from "../public/src/model/graph-model.js";
import { CraftTreeBuilder } from "../public/src/model/craft-tree.js";
import { TreeState } from "../public/src/model/tree-state.js";
import {
  createFakeGameData,
  createFakePriceBook,
  createSettings,
  ITEMS,
  RECIPES,
} from "./helpers/fixtures.js";

/** Sword plus a second recipe path that reuses Ingots, so merged view has something to merge. */
function worldWithSharedIngredient() {
  const recipes = RECIPES.map((r) =>
    r.id === 104
      ? {
          ...r,
          ingredients: [...r.ingredients, { type: "Item", id: 4, count: 1 }],
        }
      : r,
  );
  return createFakeGameData({ items: ITEMS, recipes });
}

function graphFor(
  settingsOverrides = {},
  { rootItemId = 1, gameData = worldWithSharedIngredient() } = {},
) {
  const settings = createSettings(settingsOverrides);
  const treeState = new TreeState();
  treeState.rootItemId = rootItemId;
  const root = new CraftTreeBuilder({
    gameData,
    priceBook: createFakePriceBook(),
    settings,
    treeState,
  }).build();
  return buildGraphModel(root, { settings: settings.values, gameData });
}

test("tree view keeps one node per occurrence", () => {
  const graph = graphFor();
  assert.equal(graph.nodes.filter((n) => n.entityId === 4).length, 2);
  assert.equal(
    graph.edges.length,
    graph.nodes.length - 1,
    "a tree has n-1 edges",
  );
});

test("merged view combines occurrences and sums quantities", () => {
  const graph = graphFor({ viewMode: "merged" });
  const ingots = graph.nodes.filter((n) => n.entityId === 4);
  assert.equal(ingots.length, 1);
  assert.equal(ingots[0].nodeId, "item:4");
  assert.equal(ingots[0].occurrenceCount, 2);
  assert.equal(ingots[0].quantity, 6 + 1);
});

test("filters hide raw materials and currencies but never the root", () => {
  const graph = graphFor({ hideRawMaterials: true, hideCurrencies: true });
  assert.ok(
    !graph.nodes.some((n) => n.entityId === 5 || n.entityId === 6),
    "raw items removed",
  );
  assert.ok(
    !graph.nodes.some((n) => n.kind === "currency"),
    "currency removed",
  );
  assert.ok(graph.nodes[0].isRoot);
});

test("ingredient ordering by name sorts siblings", () => {
  const graph = graphFor({ ingredientOrder: "name" });
  const rootChildren = graph.edges
    .filter((e) => e.sourceId === "r")
    .map((e) => graph.nodesById.get(e.targetId).entityId);
  assert.deepEqual(rootChildren, [2, 3]); // "Test Blade" < "Test Hilt"
});

test("forge results exclude cycles and collapsed promotions", () => {
  const forgeRecipe = {
    source: "mf",
    isPromotion: false,
    disciplines: ["Mystic Forge"],
  };
  assert.equal(
    isForgeResult({ recipe: forgeRecipe, isCycle: false, isCollapsed: false }),
    true,
  );
  assert.equal(
    isForgeResult({ recipe: forgeRecipe, isCycle: true, isCollapsed: false }),
    false,
  );
  assert.equal(
    isForgeResult({
      recipe: { ...forgeRecipe, isPromotion: true },
      isCycle: false,
      isCollapsed: true,
    }),
    false,
  );
  assert.equal(
    isForgeResult({
      recipe: { ...forgeRecipe, isPromotion: true },
      isCycle: false,
      isCollapsed: false,
    }),
    true,
    "expanded promotion counts",
  );
});

test("source categories", () => {
  const craftRecipe = { source: "api", disciplines: ["Tailor"] };
  assert.equal(getSourceCategory({ isRoot: true, kind: "item" }), "root");
  assert.equal(getSourceCategory({ kind: "currency" }), "currency");
  assert.equal(getSourceCategory({ kind: "named" }), "generic");
  assert.equal(getSourceCategory({ kind: "item", recipe: null }), "raw");
  assert.equal(
    getSourceCategory({ kind: "item", recipe: craftRecipe }),
    "craft",
  );
  assert.equal(getDisciplineKey({ recipe: craftRecipe }), "Tailor");
  assert.equal(
    getDisciplineKey({ recipe: { disciplines: ["Unknown"] } }),
    "none",
  );
});
