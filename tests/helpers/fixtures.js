/**
 * Tiny in-memory game world for tests:
 *
 *   Sword (1) ← 2× Blade (2) + 1× Hilt (3)
 *   Blade (2) ← 3× Ingot (4)          (makes 1)
 *   Ingot (4) ← 2× Ore (5)            (makes 2 per craft)
 *   Hilt  (3) ← 1× Plank (6) + 50 coin
 *   Gift  (7) ← Mystic Forge: 1× Sword + 1× Gift (self-reference → cycle)
 */
import { RARITY_COLORS } from "../../web/src/config/constants.js";

const item = (id, name, rarity = "Basic", extra = {}) => ({
  id,
  name,
  icon: `icon${id}.png`,
  rarity,
  type: "CraftingMaterial",
  level: 0,
  chatLink: "",
  flags: [],
  ...extra,
});

export const ITEMS = [
  item(1, "Test Sword", "Exotic", { type: "Weapon" }),
  item(2, "Test Blade", "Fine"),
  item(3, "Test Hilt", "Fine"),
  item(4, "Test Ingot"),
  item(5, "Test Ore"),
  item(6, "Test Plank"),
  item(7, "Gift of Testing", "Legendary", {
    type: "Trophy",
    flags: ["AccountBound"],
  }),
];

const recipe = (id, outputItemId, ingredients, extra = {}) => ({
  id,
  source: "api",
  type: "Refinement",
  outputItemId,
  outputCount: 1,
  disciplines: ["Weaponsmith"],
  minRating: 0,
  craftTimeMs: 0,
  flags: [],
  ingredients: ingredients.map(([type, ingredientId, count]) => ({
    type,
    id: ingredientId,
    count,
  })),
  ...extra,
});

export const RECIPES = [
  recipe(101, 1, [
    ["Item", 2, 2],
    ["Item", 3, 1],
  ]),
  recipe(102, 2, [["Item", 4, 3]]),
  recipe(103, 4, [["Item", 5, 2]], { outputCount: 2 }),
  recipe(104, 3, [
    ["Item", 6, 1],
    ["Currency", 1, 50],
  ]),
  recipe(
    "mf1",
    7,
    [
      ["Item", 1, 1],
      ["Item", 7, 1],
    ],
    { source: "mf", disciplines: ["Mystic Forge"], type: "MysticForge" },
  ),
];

/** Minimal stand-in for GameData with the methods the model layer uses. */
export function createFakeGameData({ items = ITEMS, recipes = RECIPES } = {}) {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const recipesByOutputId = new Map();
  for (const r of recipes) {
    if (!recipesByOutputId.has(r.outputItemId))
      recipesByOutputId.set(r.outputItemId, []);
    recipesByOutputId.get(r.outputItemId).push(r);
  }
  const consumersById = new Map();
  for (const r of recipes)
    for (const ingredient of r.ingredients)
      if (ingredient.type === "Item") {
        if (!consumersById.has(ingredient.id))
          consumersById.set(ingredient.id, new Set());
        consumersById.get(ingredient.id).add(r.outputItemId);
      }
  return {
    items: itemsById,
    recipesByOutputId,
    getRecipes: (id) => recipesByOutputId.get(id) ?? [],
    hasRecipe: (id) => recipesByOutputId.has(id),
    getConsumers: (id) => consumersById.get(id) ?? new Set(),
    getEntity: (kind, id) => ({
      name: itemsById.get(id)?.name ?? `${kind} #${id}`,
      icon: null,
      rarity: itemsById.get(id)?.rarity,
      flags: [],
    }),
    getEntityColor: (kind, id) =>
      RARITY_COLORS[itemsById.get(id)?.rarity] ?? "#777777",
  };
}

/** PriceBook stand-in: fixed unit prices (copper) by item id. */
export function createFakePriceBook(unitPrices = {}) {
  return {
    getUnitPrice: (id, basis) =>
      basis === "off" ? null : (unitPrices[id] ?? null),
    has: (id) => id in unitPrices,
    getQuote: (id) =>
      id in unitPrices ? { buy: unitPrices[id], sell: unitPrices[id] } : null,
  };
}

/** SettingsStore stand-in. */
export function createSettings(overrides = {}) {
  return {
    values: {
      viewMode: "tree",
      maxDepth: 13,
      includeForgePromotions: false,
      priceBasis: "sell",
      preferMysticForge: false,
      ingredientOrder: "recipe",
      hideRawMaterials: false,
      hideCurrencies: false,
      hideGenericIngredients: false,
      ...overrides,
    },
  };
}
