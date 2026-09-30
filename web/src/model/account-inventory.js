/**
 * Everything an account holds, flattened into one list of stacks with a `storage` tag, so "how many of this item do
 * I have, and where" is one filter instead of a walk over six differently shaped API responses.
 *
 * Inputs are raw GW2 API responses (any may be missing when the key lacks its permission):
 * `/v2/account/bank`, `/v2/account/inventory` (shared slots), `/v2/account/materials`, `/v2/characters` (bags),
 * `/v2/commerce/delivery` (Trading Post pickup) and `/v2/account/wallet`.
 */

export const Storage = Object.freeze({
  bank: "bank",
  material: "material",
  shared: "shared",
  bag: "bag",
  delivery: "delivery",
});

/** Storages whose items count as owned for crafting: equipped gear is in use, so it's left out. */
export const HELD_STORAGES = new Set(Object.values(Storage));

export const STORAGE_LABELS = {
  bank: "Bank",
  material: "Material storage",
  shared: "Shared slots",
  bag: "Bags",
  delivery: "Trading Post pickup",
};

/**
 * @typedef {{ storage: string, itemId: number, count: number, owner?: string, binding?: string }} Stack
 * @returns {Stack[]}
 */
export function collectStacks({
  bank,
  shared,
  materials,
  characters,
  delivery,
} = {}) {
  const stacks = [];
  const add = (storage, slot, owner) => {
    if (!slot?.id || !(slot.count > 0)) return;
    stacks.push({
      storage,
      itemId: slot.id,
      count: slot.count,
      ...(owner ? { owner } : {}),
      ...(slot.binding ? { binding: slot.binding } : {}),
    });
  };
  for (const slot of bank ?? []) add(Storage.bank, slot);
  for (const slot of shared ?? []) add(Storage.shared, slot);
  for (const slot of materials ?? []) add(Storage.material, slot);
  for (const character of characters ?? [])
    for (const bag of character.bags ?? [])
      for (const slot of bag?.inventory ?? [])
        add(Storage.bag, slot, character.name);
  for (const slot of delivery?.items ?? []) add(Storage.delivery, slot);
  return stacks;
}

/** Item id → total count across the given storages. */
export function ownedItemCounts(stacks, storages = HELD_STORAGES) {
  const counts = new Map();
  for (const stack of stacks)
    if (storages.has(stack.storage))
      counts.set(stack.itemId, (counts.get(stack.itemId) ?? 0) + stack.count);
  return counts;
}

/** Where an item is held: `[{storage, owner?, count}]`, largest first. */
export function itemLocations(stacks, itemId) {
  const byPlace = new Map();
  for (const stack of stacks) {
    if (stack.itemId !== itemId) continue;
    const key = `${stack.storage}:${stack.owner ?? ""}`;
    const place = byPlace.get(key) ?? {
      storage: stack.storage,
      ...(stack.owner ? { owner: stack.owner } : {}),
      count: 0,
    };
    place.count += stack.count;
    byPlace.set(key, place);
  }
  return [...byPlace.values()].sort((a, b) => b.count - a.count);
}

/** Currency id → amount. */
export const walletCounts = (wallet) =>
  new Map((wallet ?? []).map((entry) => [entry.id, entry.value]));

/** Best rating per crafting discipline across every character: discipline → `{rating, character}`. */
export function bestCraftingLevels(characters) {
  const best = new Map();
  for (const character of characters ?? [])
    for (const { discipline, rating } of character.crafting ?? [])
      if (rating > (best.get(discipline)?.rating ?? -1))
        best.set(discipline, { rating, character: character.name });
  return best;
}

/** The crafting disciplines characters level; recipe "disciplines" such as "Mystic Forge" need no character. */
const CRAFTING_DISCIPLINES = new Set([
  "Armorsmith",
  "Artificer",
  "Chef",
  "Huntsman",
  "Jeweler",
  "Leatherworker",
  "Scribe",
  "Tailor",
  "Weaponsmith",
]);

/**
 * Whether the account can make a recipe: any one of its disciplines at `minRating` will do. Recipes without a
 * crafting discipline (Mystic Forge, custom) need none.
 * @returns {{ canCraft: boolean, missing: { discipline: string, rating: number, have: number }[] }}
 */
export function craftingRequirement(recipe, levels) {
  const disciplines = (recipe.disciplines ?? []).filter((discipline) =>
    CRAFTING_DISCIPLINES.has(discipline),
  );
  if (!disciplines.length) return { canCraft: true, missing: [] };
  const canCraft = disciplines.some(
    (discipline) =>
      (levels.get(discipline)?.rating ?? 0) >= (recipe.minRating ?? 0),
  );
  return {
    canCraft,
    missing: canCraft
      ? []
      : disciplines.map((discipline) => ({
          discipline,
          rating: recipe.minRating ?? 0,
          have: levels.get(discipline)?.rating ?? 0,
        })),
  };
}
