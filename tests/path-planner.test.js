import { test } from "node:test";
import assert from "node:assert/strict";
import { PathPlanner } from "../public/src/model/path-planner.js";

// Item 1 is crafted from 2 × item 2 (or, alternatively, 1 × item 3 + 50 copper); item 2 is crafted from 3 × item 4.
const RECIPES = {
  1: [
    { ingredients: [{ type: "Item", id: 2, count: 2 }], outputCount: 1 },
    {
      ingredients: [
        { type: "Item", id: 3, count: 1 },
        { type: "Currency", id: 1, count: 50 },
      ],
      outputCount: 1,
    },
  ],
  2: [{ ingredients: [{ type: "Item", id: 4, count: 3 }], outputCount: 1 }],
};

const planner = (mode, prices) =>
  new PathPlanner({
    mode,
    getRecipes: (id) => RECIPES[id] ?? [],
    getUnitPrice: (id) => prices[id] ?? null,
  });

test("cheapest buys an ingredient when that beats crafting it", () => {
  const plan = planner("cheapest", { 2: 10, 3: 500, 4: 100 });
  assert.deepEqual(
    plan.decide(2),
    { buy: true, recipeIndex: null },
    "10c to buy vs 300c to craft",
  );
  assert.equal(plan.cheapestRecipeIndex(1), 0, "2 × 10c beats 500c + 50c");
});

test("cheapest crafts when that beats buying, and picks the cheaper recipe", () => {
  const plan = planner("cheapest", { 1: 10000, 2: 1000, 3: 20, 4: 5 });
  assert.deepEqual(
    plan.decide(2),
    { buy: false, recipeIndex: 0 },
    "3 × 5c beats 1000c",
  );
  assert.deepEqual(
    plan.decide(1),
    { buy: false, recipeIndex: 0 },
    "2 × 15c beats 20c + 50c and 10000c",
  );
});

test("fewest crafts buys anything priced; standard never buys", () => {
  assert.deepEqual(planner("fewest", { 2: 10 }).decide(2), {
    buy: true,
    recipeIndex: null,
  });
  assert.deepEqual(planner("fewest", {}).decide(2), {
    buy: false,
    recipeIndex: null,
  });
  assert.deepEqual(planner("standard", { 2: 10 }).decide(2), {
    buy: false,
    recipeIndex: null,
  });
});

test("recipe cycles fall back to buying instead of recursing forever", () => {
  const cyclic = new PathPlanner({
    mode: "cheapest",
    getRecipes: (id) =>
      id === 7
        ? [{ ingredients: [{ type: "Item", id: 7, count: 1 }], outputCount: 2 }]
        : [],
    getUnitPrice: () => 40,
  });
  assert.deepEqual(
    cyclic.decide(7),
    { buy: false, recipeIndex: 0 },
    "1 bought at 40c makes 2 → 20c each",
  );
});
