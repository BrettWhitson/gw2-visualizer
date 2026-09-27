import {
  COIN_CURRENCY_ID,
  EntityKind,
  INGREDIENT_TYPE_TO_KIND,
} from "../config/constants.js";

/**
 * Decides, per item, whether to buy it or which recipe to craft it with, for the ribbon's "Path" modes:
 *  - standard: always craft with the default recipe (no decisions; the tree builder's usual behaviour);
 *  - cheapest: the lowest unit cost among buying and every available recipe, recursively (each ingredient is itself
 *    bought or crafted, whichever is cheaper);
 *  - fewest:   buy anything with a trading post price; craft only what can't be bought.
 *
 * Costs are per unit of output, in copper. Ingredients with no gold value (account-bound items, non-coin currencies,
 * unpriced items) are left out of a recipe's cost and mark it "incomplete". Options are compared on their known cost;
 * on a tie a complete option wins, then buying (less work).
 */
export class PathPlanner {
  /** @type {Map<number, PlanOption>} */
  #plans = new Map();

  /**
   * @param {{ mode: 'standard' | 'cheapest' | 'fewest', getRecipes: (itemId: number) => import('../types.js').Recipe[],
   *           getUnitPrice: (itemId: number) => number | null }} options
   */
  constructor({ mode, getRecipes, getUnitPrice }) {
    this.mode = mode;
    this.getRecipes = getRecipes;
    this.getUnitPrice = getUnitPrice;
  }

  /** @returns {{ buy: boolean, recipeIndex: number | null }} recipeIndex null = keep the builder's default recipe */
  decide(itemId) {
    if (this.mode === "fewest")
      return { buy: this.getUnitPrice(itemId) != null, recipeIndex: null };
    if (this.mode !== "cheapest") return { buy: false, recipeIndex: null };
    const plan = this.#plan(itemId, new Set());
    return plan.buy
      ? { buy: true, recipeIndex: null }
      : { buy: false, recipeIndex: plan.recipeIndex };
  }

  /** Cheapest recipe for an item that must be crafted (the root), or null to keep the default. */
  cheapestRecipeIndex(itemId) {
    if (this.mode !== "cheapest") return null;
    let best = null;
    this.getRecipes(itemId).forEach((recipe, recipeIndex) => {
      const option = {
        ...this.#recipeCost(recipe, new Set([itemId])),
        buy: false,
        recipeIndex,
      };
      if (isBetter(option, best)) best = option;
    });
    return best?.recipeIndex ?? null;
  }

  /**
   * Cheapest way to get one unit of `itemId`. `visiting` holds the items being crafted further up, so recipe
   * cycles (a material promoted from itself) fall back to buying.
   * @returns {PlanOption}
   */
  #plan(itemId, visiting) {
    const cached = this.#plans.get(itemId);
    if (cached) return cached;

    const buyPrice = this.getUnitPrice(itemId);
    let best =
      buyPrice != null
        ? { cost: buyPrice, isComplete: true, buy: true, recipeIndex: null }
        : null;
    let dependsOnPath = false;
    if (visiting.has(itemId)) {
      dependsOnPath = true;
    } else {
      visiting.add(itemId);
      this.getRecipes(itemId).forEach((recipe, recipeIndex) => {
        const option = {
          ...this.#recipeCost(recipe, visiting),
          buy: false,
          recipeIndex,
        };
        if (isBetter(option, best)) best = option;
      });
      visiting.delete(itemId);
    }

    const plan = best ?? {
      cost: 0,
      isComplete: false,
      buy: false,
      recipeIndex: null,
    };
    // An answer cut short by a cycle depends on the path that reached it, so only cache complete explorations.
    if (!dependsOnPath) this.#plans.set(itemId, plan);
    return plan;
  }

  /** Unit cost of crafting with `recipe`: ingredient costs divided by the output count. */
  #recipeCost(recipe, visiting) {
    let cost = 0,
      isComplete = true;
    for (const ingredient of recipe.ingredients) {
      const kind = INGREDIENT_TYPE_TO_KIND[ingredient.type] ?? EntityKind.item;
      if (kind === EntityKind.item) {
        const plan = this.#plan(ingredient.id, visiting);
        cost += plan.cost * ingredient.count;
        if (!plan.isComplete) isComplete = false;
      } else if (
        kind === EntityKind.currency &&
        ingredient.id === COIN_CURRENCY_ID
      ) {
        cost += ingredient.count;
      } else {
        isComplete = false;
      }
    }
    return {
      cost: cost / (recipe.outputCount > 0 ? recipe.outputCount : 1),
      isComplete,
    };
  }
}

/** @typedef {{ cost: number, isComplete: boolean, buy: boolean, recipeIndex: number | null }} PlanOption */

/** Lower known cost wins; on a tie, complete beats incomplete, then buying beats crafting. */
function isBetter(option, best) {
  if (!best) return true;
  if (option.cost !== best.cost) return option.cost < best.cost;
  if (option.isComplete !== best.isComplete) return option.isComplete;
  return option.buy && !best.buy;
}
