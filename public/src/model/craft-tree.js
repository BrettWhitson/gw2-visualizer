import {
  EntityKind,
  INGREDIENT_TYPE_TO_KIND,
  RecipeSource,
  UNLIMITED_DEPTH,
} from "../config/constants.js";
import { isCoin } from "../utils/format.js";
import { PathPlanner } from "./path-planner.js";

/**
 * Builds the crafting tree for the current root: one TreeNode per ingredient occurrence, expanded recursively
 * through each item's chosen recipe, with quantities scaled by craft counts and costs rolled up from the leaves.
 */
export class CraftTreeBuilder {
  /** @type {PathPlanner} buy-or-craft decisions for the current Path mode (rebuilt on every build) */
  #planner;

  /**
   * @param {{ gameData: import('../data/game-data.js').GameData, priceBook: import('../data/price-book.js').PriceBook,
   *           settings: import('../core/settings-store.js').SettingsStore, treeState: import('./tree-state.js').TreeState }} deps
   */
  constructor({ gameData, priceBook, settings, treeState }) {
    this.gameData = gameData;
    this.priceBook = priceBook;
    this.settings = settings;
    this.treeState = treeState;
  }

  /** @returns {import('../types.js').TreeNode} */
  build() {
    const { rootItemId, rootQuantity } = this.treeState;
    const ancestorItemIds = new Set(); // for cycle detection along the current path
    const { pathMode, priceBasis } = this.settings.values;
    this.#planner = new PathPlanner({
      mode: pathMode,
      getRecipes: (itemId) => this.#availableRecipes(itemId),
      getUnitPrice: (itemId) => this.priceBook.getUnitPrice(itemId, priceBasis),
    });
    const root = this.#buildNode(
      EntityKind.item,
      rootItemId,
      rootQuantity,
      0,
      "r",
      null,
      ancestorItemIds,
    );
    this.computeCosts(root);
    return root;
  }

  /** Recompute buy/craft costs bottom-up (after prices arrive or the price basis changes). */
  computeCosts(node) {
    node.children.forEach((child) => this.computeCosts(child));
    const unitPrice =
      node.kind === EntityKind.item
        ? this.priceBook.getUnitPrice(
            node.entityId,
            this.settings.values.priceBasis,
          )
        : null;
    node.buyCost = isCoin(node.kind, node.entityId)
      ? node.quantity
      : unitPrice != null
        ? unitPrice * node.quantity
        : null;

    if (node.children.length) {
      let total = 0,
        isPartial = false;
      for (const child of node.children) {
        // Partial-ness propagates: a child whose own ingredients weren't all priced makes this total partial too.
        if (child.effectiveCost == null || child.isCraftCostPartial)
          isPartial = true;
        if (child.effectiveCost != null) total += child.effectiveCost;
      }
      node.craftCost = total;
      node.isCraftCostPartial = isPartial;
      node.effectiveCost = total;
    } else {
      node.craftCost = null;
      node.effectiveCost = node.buyCost;
    }
    node.isBuyCheaper =
      !!node.children.length &&
      node.buyCost != null &&
      !node.isCraftCostPartial &&
      node.buyCost < node.craftCost;
  }

  #buildNode(kind, entityId, quantity, depth, path, parent, ancestorItemIds) {
    /** @type {import('../types.js').TreeNode} */
    const node = {
      path,
      kind,
      entityId,
      quantity,
      depth,
      parent,
      children: [],
      recipe: null,
      recipeIndex: 0,
      alternativeRecipeCount: 0,
      craftCount: 0,
      isCollapsed: false,
      isCycle: false,
      buyCost: null,
      craftCost: null,
      effectiveCost: null,
      isBuyCheaper: false,
      isPlannedPurchase: false,
    };
    if (kind !== EntityKind.item) return node;

    const recipes = this.#availableRecipes(entityId);
    if (!recipes.length) return node;

    // The root is always crafted; everything below may be bought instead, per the Path mode.
    const plan =
      depth === 0
        ? {
            buy: false,
            recipeIndex: this.#planner.cheapestRecipeIndex(entityId),
          }
        : this.#planner.decide(entityId);
    node.isPlannedPurchase = plan.buy;
    node.alternativeRecipeCount = recipes.length;
    node.recipeIndex = this.#chooseRecipeIndex(
      entityId,
      recipes,
      plan.recipeIndex,
    );
    node.recipe = recipes[node.recipeIndex];
    node.craftCount = Math.ceil(
      quantity / Math.max(1, Math.floor(node.recipe.outputCount)),
    );

    if (ancestorItemIds.has(entityId)) {
      node.isCycle = true;
      return node;
    }
    if (this.#shouldCollapse(node, depth)) {
      node.isCollapsed = true;
      return node;
    }

    ancestorItemIds.add(entityId);
    node.recipe.ingredients.forEach((ingredient, index) => {
      node.children.push(
        this.#buildNode(
          INGREDIENT_TYPE_TO_KIND[ingredient.type] ?? EntityKind.item,
          ingredient.id,
          ingredient.count * node.craftCount,
          depth + 1,
          `${path}/${index}`,
          node,
          ancestorItemIds,
        ),
      );
    });
    ancestorItemIds.delete(entityId);
    return node;
  }

  /**
   * Every item any available recipe could pull in below `rootItemId` (all alternatives, all depths), for fetching the
   * prices path planning compares. Capped so a pathological recipe web can't flood the price API.
   */
  collectReachableItemIds(rootItemId, limit = 6000) {
    const reachable = new Set([rootItemId]);
    const queue = [rootItemId];
    while (queue.length && reachable.size < limit) {
      for (const recipe of this.#availableRecipes(queue.shift())) {
        for (const ingredient of recipe.ingredients) {
          if (ingredient.type !== "Item" || reachable.has(ingredient.id))
            continue;
          reachable.add(ingredient.id);
          queue.push(ingredient.id);
        }
      }
    }
    return reachable;
  }

  /** Recipes to consider for an item; forge promotions only when enabled (otherwise those items are bought). */
  #availableRecipes(itemId) {
    const recipes = this.gameData.getRecipes(itemId);
    return this.settings.values.includeForgePromotions
      ? recipes
      : recipes.filter((recipe) => !recipe.isPromotion);
  }

  /** A recipe the user picked wins, then the Path plan's choice, then the Mystic Forge preference, then the first. */
  #chooseRecipeIndex(itemId, recipes, plannedIndex) {
    const { recipeChoiceByItemId } = this.treeState;
    if (recipeChoiceByItemId.has(itemId))
      return recipeChoiceByItemId.get(itemId) % recipes.length;
    if (plannedIndex != null) return plannedIndex;
    if (this.settings.values.preferMysticForge)
      return Math.max(
        0,
        recipes.findIndex((r) => r.source === RecipeSource.mysticForge),
      );
    return 0;
  }

  #shouldCollapse(node, depth) {
    const { collapsedKeys, expandedKeys } = this.treeState;
    const key = getCollapseKey(node, this.settings.values.viewMode);
    if (collapsedKeys.has(key)) return true;
    if (node.isPlannedPurchase && !expandedKeys.has(key)) return true; // bought, not crafted
    const { maxDepth } = this.settings.values;
    return (
      maxDepth < UNLIMITED_DEPTH && depth >= maxDepth && !expandedKeys.has(key)
    );
  }
}

/** Collapse state is per occurrence in tree view, per entity in merged view. */
export function getCollapseKey(node, viewMode) {
  return viewMode === "merged" ? `${node.kind}:${node.entityId}` : node.path;
}

/** Depth-first pre-order traversal. */
export function walkTree(node, visit) {
  visit(node);
  for (const child of node.children) walkTree(child, visit);
}

/**
 * The shopping list: every leaf of the visible tree (raw materials + collapsed items to buy), aggregated.
 * Sorted by total cost (unpriced last), then quantity.
 */
export function collectShoppingList(root) {
  const byEntity = new Map();
  walkTree(root, (node) => {
    if (node.children.length) return;
    const key = `${node.kind}:${node.entityId}`;
    const entry = byEntity.get(key) ?? {
      kind: node.kind,
      entityId: node.entityId,
      quantity: 0,
      totalCost: 0,
      isFullyPriced: true,
      isCraftable: !!node.recipe,
    };
    entry.quantity += node.quantity;
    if (node.buyCost == null) entry.isFullyPriced = false;
    else entry.totalCost += node.buyCost;
    byEntity.set(key, entry);
  });
  return [...byEntity.values()].sort(
    (a, b) =>
      (b.isFullyPriced ? b.totalCost : -1) -
        (a.isFullyPriced ? a.totalCost : -1) || b.quantity - a.quantity,
  );
}
