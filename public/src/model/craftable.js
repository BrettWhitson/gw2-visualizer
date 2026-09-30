import { EntityKind } from "../config/constants.js";
import { yieldToPage } from "../utils/async.js";

/**
 * "What can I craft with what I have": which items the account can make right now from what it owns, how many, and
 * a forward graph from any item to what it can become.
 *
 * "Can make" means a plan was found: owned units are used first, the rest is crafted, recursively, with surplus
 * from a craft kept for later steps (a recipe that makes 5 when 2 are needed leaves 3). Alternative recipes are tried
 * in order, backtracking when one falls short. The search is greedy per ingredient (the first plan that works for an
 * ingredient is kept), so it never claims too much but can miss a plan that needs owned units shared differently;
 * each check also has a work budget, so a pathological recipe web counts as "can't" rather than stalling the page. Currency ingredients (coin, karma, spirit shards…) come
 * from the wallet. Guild and generic ("any charm") ingredients can't be planned, so recipes that need them are
 * skipped, as are random-yield Mystic Forge recipes and, unless included, material promotions.
 */

/** Deepest chain of intermediate crafts considered below an item. */
const MAX_PLAN_DEPTH = 6;
/** How far forward from owned items candidates are looked for (material → refined → component → …). */
const MAX_FORWARD_STEPS = 4;
/** `maxMakeable` stops counting here; the UI shows "N+". */
export const MAX_COUNT = 1000;
/** Recipe attempts one check may make before giving up. */
const WORK_BUDGET = 20000;

/** Owned amounts with an undo log, so a failed branch of the search can be rolled back cheaply. */
class Ledger {
  #amounts;
  #journal = [];

  constructor(amounts) {
    this.#amounts = amounts; // never mutated in place: changes go through the journal
    this.changes = new Map();
  }

  get(key) {
    return this.changes.has(key)
      ? this.changes.get(key)
      : (this.#amounts.get(key) ?? 0);
  }

  add(key, delta) {
    this.#journal.push([key, this.changes.has(key), this.changes.get(key)]);
    this.changes.set(key, this.get(key) + delta);
  }

  mark() {
    return this.#journal.length;
  }

  rollback(mark) {
    while (this.#journal.length > mark) {
      const [key, had, value] = this.#journal.pop();
      if (had) this.changes.set(key, value);
      else this.changes.delete(key);
    }
  }
}

export class CraftPlanner {
  /** @type {Map<number, number>} item id → how many can be made (memo) */
  #counts = new Map();

  /**
   * @param {{ getRecipes: (itemId: number) => import('../types.js').Recipe[],
   *           getConsumers: (itemId: number) => Set<number>,
   *           owned: Map<number, number>, wallet?: Map<number, number>,
   *           includePromotions?: boolean }} options
   */
  constructor({
    getRecipes,
    getConsumers,
    owned,
    wallet = new Map(),
    includePromotions = false,
  }) {
    this.getConsumers = getConsumers;
    this.owned = owned;
    this.wallet = wallet;
    this.recipesOf = (itemId) =>
      getRecipes(itemId).filter(
        (recipe) =>
          (includePromotions || !recipe.isPromotion) &&
          Number.isInteger(recipe.outputCount) &&
          recipe.outputCount >= 1 &&
          recipe.ingredients.every(
            (ingredient) =>
              ingredient.type === "Item" || ingredient.type === "Currency",
          ),
      );
  }

  /** Whether `quantity` of an item can be crafted (not just taken from stock) with what's owned. */
  canMake(itemId, quantity = 1) {
    return this.#craftOnly(itemId, quantity) !== undefined;
  }

  /** How many can be crafted from what's owned, up to MAX_COUNT (memoised). */
  maxMakeable(itemId) {
    if (this.#counts.has(itemId)) return this.#counts.get(itemId);
    let count = 0;
    if (this.canMake(itemId, 1)) {
      // Gallop up, then binary search between the last success and the first failure.
      let low = 1,
        high = 2;
      while (high <= MAX_COUNT && this.canMake(itemId, high)) {
        low = high;
        high *= 2;
      }
      high = Math.min(high, MAX_COUNT + 1);
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (this.canMake(itemId, middle)) low = middle;
        else high = middle;
      }
      count = Math.min(low, MAX_COUNT);
      // The search assumes "can make n" implies "can make fewer"; recipe choices can make that not quite true,
      // so step down until the reported count really is makeable.
      while (count > 0 && !this.canMake(itemId, count)) count--;
    }
    this.#counts.set(itemId, count);
    return count;
  }

  /** The recipe a plan for one unit would use (the first that works), or null. */
  recipeFor(itemId) {
    return this.#craftOnly(itemId, 1) ?? null;
  }

  /**
   * Every item reachable forward from what's owned that can be crafted now, most-makeable first.
   * @param {{ shouldYield?: () => boolean, onProgress?: (done: number, total: number) => void }} [options]
   *        pass shouldYield to run in slices (the caller awaits between them)
   * @returns {Promise<{ itemId: number, count: number, recipe: import('../types.js').Recipe }[]>}
   */
  async findCraftable({ shouldYield = () => false, onProgress } = {}) {
    const candidates = this.forwardCandidates();
    const results = [];
    let done = 0;
    for (const itemId of candidates) {
      done++;
      const count = this.maxMakeable(itemId);
      if (count)
        results.push({ itemId, count, recipe: this.recipeFor(itemId) });
      if (shouldYield()) {
        onProgress?.(done, candidates.size);
        await yieldToPage();
      }
    }
    onProgress?.(candidates.size, candidates.size);
    return results.sort((a, b) => b.count - a.count || a.itemId - b.itemId);
  }

  /** Items whose recipes use something owned, and what those make in turn, up to MAX_FORWARD_STEPS away. */
  forwardCandidates() {
    const found = new Set();
    let frontier = [...this.owned.keys()].filter(
      (id) => this.owned.get(id) > 0,
    );
    for (let step = 0; step < MAX_FORWARD_STEPS && frontier.length; step++) {
      const next = [];
      for (const itemId of frontier)
        for (const consumerId of this.getConsumers(itemId)) {
          if (found.has(consumerId) || !this.recipesOf(consumerId).length)
            continue;
          found.add(consumerId);
          next.push(consumerId);
        }
      frontier = next;
    }
    return found;
  }

  /** Craft `quantity` without taking the item itself from stock: returns the recipe used, or undefined. */
  #craftOnly(itemId, quantity) {
    const ledger = new Ledger(this.owned);
    const wallet = new Ledger(this.wallet);
    this.#work = WORK_BUDGET;
    return this.#make(itemId, quantity, ledger, wallet, new Set([itemId]), 0);
  }

  #work = 0;

  /**
   * Provide `quantity` of an item: from stock first, then crafting the rest. Returns the recipe used for the
   * crafted part (null when stock covered it all), or undefined when it can't be done (the ledgers are rolled back).
   */
  #craft(itemId, quantity, ledger, wallet, visiting, depth) {
    const have = ledger.get(itemId);
    const fromStock = Math.min(have, quantity);
    const mark = ledger.mark();
    if (fromStock) ledger.add(itemId, -fromStock);
    const rest = quantity - fromStock;
    if (!rest) return null;
    if (visiting.has(itemId) || depth >= MAX_PLAN_DEPTH) {
      ledger.rollback(mark);
      return undefined;
    }
    visiting.add(itemId);
    const recipe = this.#make(itemId, rest, ledger, wallet, visiting, depth);
    visiting.delete(itemId);
    if (recipe === undefined) ledger.rollback(mark);
    return recipe;
  }

  /** Craft `quantity` with the first recipe that works; surplus output goes into stock. */
  #make(itemId, quantity, ledger, wallet, visiting, depth) {
    for (const recipe of this.recipesOf(itemId)) {
      if (--this.#work < 0) return undefined; // over budget: treat as not makeable
      const mark = ledger.mark(),
        walletMark = wallet.mark();
      const crafts = Math.ceil(quantity / recipe.outputCount);
      let ok = true;
      for (const ingredient of recipe.ingredients) {
        const needed = ingredient.count * crafts;
        if (ingredient.type === "Currency") {
          if (wallet.get(ingredient.id) < needed) ok = false;
          else wallet.add(ingredient.id, -needed);
        } else if (
          this.#craft(
            ingredient.id,
            needed,
            ledger,
            wallet,
            visiting,
            depth + 1,
          ) === undefined
        )
          ok = false;
        if (!ok) break;
      }
      if (ok) {
        const surplus = crafts * recipe.outputCount - quantity;
        if (surplus) ledger.add(itemId, surplus);
        return recipe;
      }
      ledger.rollback(mark);
      wallet.rollback(walletMark);
    }
    return undefined;
  }
}

// ---------------------------------------------------------------- forward graph

/** Products shown under one node before the rest fold into a "+N more" node. */
export const CHILD_LIMIT = 12;

/**
 * A forward tree from `rootItemId`: each node's children are the craftable items whose recipes use it. Node ids are
 * paths of item ids from the root ("r/19684/9586"). Shaped like
 * the crafting page's GraphModel (tree view), so the same graph view, layout and styles draw it; edges run from an
 * ingredient to its product.
 *
 * @param {number} rootItemId
 * @param {{ planner: CraftPlanner, craftable: Map<number, number>, rank?: (itemId: number) => number,
 *           expanded: Set<string>, collapsed?: Set<string>, showAll: Set<string>, initialDepth?: number,
 *           childLimit?: number }} options
 *   craftable: item id → how many can be made; expanded: node paths the user opened (beyond initialDepth);
 *   collapsed: node paths the user closed (within initialDepth); showAll: node paths whose "+N more" was opened;
 *   rank: higher first (default: how many can be made)
 */
export function buildForwardGraph(
  rootItemId,
  {
    planner,
    craftable,
    rank = (itemId) => craftable.get(itemId) ?? 0,
    expanded,
    collapsed = new Set(),
    showAll,
    initialDepth = 1,
    childLimit = CHILD_LIMIT,
  },
) {
  const nodesById = new Map();
  const edges = [];
  const productsOf = (itemId) =>
    [...planner.getConsumers(itemId)]
      .filter((id) => craftable.has(id))
      .sort((a, b) => rank(b) - rank(a) || a - b);

  const addNode = (itemId, path, depth, ancestors) => {
    const products = productsOf(itemId).filter((id) => !ancestors.has(id));
    const isOpen =
      !collapsed.has(path) && (depth < initialDepth || expanded.has(path));
    const node = {
      nodeId: path,
      kind: EntityKind.item,
      entityId: itemId,
      quantity:
        depth === 0 ? (planner.owned.get(itemId) ?? 0) : craftable.get(itemId),
      craftCount: 0,
      effectiveCost: 0,
      buyCost: null,
      craftCost: null,
      isCostComplete: true,
      depth,
      recipe: depth === 0 ? null : planner.recipeFor(itemId),
      recipeIndex: 0,
      alternativeRecipeCount: 0,
      isCollapsed: !isOpen && products.length > 0,
      isCycle: false,
      hasChildren: isOpen && products.length > 0,
      isBuyCheaper: false,
      isPlannedPurchase: false,
      ownedQuantity: planner.owned.get(itemId) ?? 0,
      isOwnedEnough: false,
      productCount: products.length,
      collapseKey: path,
      occurrenceCount: 1,
      isRoot: depth === 0,
    };
    nodesById.set(path, node);
    if (!isOpen) return;

    const shown = showAll.has(path) ? products : products.slice(0, childLimit);
    const nextAncestors = new Set(ancestors).add(itemId);
    // Paths use item ids, not positions: ranking changes (prices arriving) mustn't move what's expanded.
    shown.forEach((productId) => {
      const childPath = `${path}/${productId}`;
      addNode(productId, childPath, depth + 1, nextAncestors);
      edges.push({
        edgeId: `${path}->${childPath}`,
        sourceId: path,
        targetId: childPath,
        quantity:
          planner
            .recipeFor(productId)
            ?.ingredients.find((ingredient) => ingredient.id === itemId)
            ?.count ?? 1,
      });
    });
    const hidden = products.length - shown.length;
    if (hidden > 0) {
      const morePath = `${path}/more`;
      nodesById.set(morePath, {
        ...overflowNode(morePath, depth + 1, hidden),
      });
      edges.push({
        edgeId: `${path}->${morePath}`,
        sourceId: path,
        targetId: morePath,
        quantity: 0,
      });
    }
  };

  addNode(rootItemId, "r", 0, new Set());
  return { nodes: [...nodesById.values()], edges, nodesById };
}

/** A "+N more" placeholder: opening it shows every product of its parent. */
function overflowNode(path, depth, hiddenCount) {
  return {
    nodeId: path,
    kind: EntityKind.named,
    entityId: `${hiddenCount} more`,
    quantity: hiddenCount,
    craftCount: 0,
    effectiveCost: 0,
    buyCost: null,
    craftCost: null,
    isCostComplete: true,
    depth,
    recipe: null,
    recipeIndex: 0,
    alternativeRecipeCount: 0,
    isCollapsed: true,
    isCycle: false,
    hasChildren: false,
    isBuyCheaper: false,
    isPlannedPurchase: false,
    ownedQuantity: 0,
    isOwnedEnough: false,
    isOverflow: true,
    collapseKey: path,
    occurrenceCount: 1,
    isRoot: false,
  };
}

// ---------------------------------------------------------------- the lists

/**
 * Owned materials that feed at least one craftable item, with how many craftable products each leads to directly.
 * @returns {{ itemId: number, owned: number, productCount: number }[]}
 */
export function usefulMaterials(planner, craftable) {
  const materials = [];
  for (const [itemId, owned] of planner.owned) {
    if (!(owned > 0)) continue;
    let productCount = 0;
    for (const consumerId of planner.getConsumers(itemId))
      if (craftable.has(consumerId)) productCount++;
    if (productCount) materials.push({ itemId, owned, productCount });
  }
  return materials;
}

/** Disciplines a recipe is made with, for filtering ("Mystic Forge" included). */
export const recipeDisciplines = (recipe) =>
  recipe?.disciplines?.length ? recipe.disciplines : [];

/**
 * Filter and sort list entries (`{ itemId, … }`).
 * @param {object[]} entries
 * `profit` ranks by what the whole lot sells for: unit sell price × `quantityOf` (how many you can make, or own).
 * @param {{ query?: string, discipline?: string, sort: "profit" | "value" | "count" | "rarity" | "name",
 *           nameOf: (id: number) => string, priceOf: (id: number) => number | null,
 *           rarityRankOf: (id: number) => number, countOf: (entry: object) => number,
 *           quantityOf?: (entry: object) => number, disciplinesOf?: (entry: object) => string[],
 *           isAllowed?: (entry: object) => boolean }} options
 */
export function filterAndSort(
  entries,
  {
    query = "",
    discipline = "",
    sort,
    nameOf,
    priceOf,
    rarityRankOf,
    countOf,
    quantityOf = countOf,
    disciplinesOf = () => [],
    isAllowed = () => true,
  },
) {
  const needle = query.trim().toLowerCase();
  const kept = entries.filter(
    (entry) =>
      isAllowed(entry) &&
      (!needle || nameOf(entry.itemId).toLowerCase().includes(needle)) &&
      (!discipline || disciplinesOf(entry).includes(discipline)),
  );
  const byName = (a, b) => nameOf(a.itemId).localeCompare(nameOf(b.itemId));
  const total = (entry) => {
    const price = priceOf(entry.itemId);
    return price == null ? -1 : price * quantityOf(entry);
  };
  const compare = {
    profit: (a, b) => total(b) - total(a),
    // Unpriced (untradeable) items after priced ones.
    value: (a, b) => (priceOf(b.itemId) ?? -1) - (priceOf(a.itemId) ?? -1),
    count: (a, b) => countOf(b) - countOf(a),
    rarity: (a, b) => rarityRankOf(b.itemId) - rarityRankOf(a.itemId),
    name: () => 0,
  }[sort];
  return kept.sort((a, b) => compare(a, b) || byName(a, b));
}

/** Levels wider than this read better as rings than as one very tall column. */
export const RADIAL_LEVEL_SIZE = 25;

/** "auto" → radial when any level of the graph holds more than RADIAL_LEVEL_SIZE items, columns otherwise. */
export function chooseLayout(graph, preference = "auto") {
  if (preference !== "auto") return preference;
  const perDepth = new Map();
  for (const node of graph.nodes)
    perDepth.set(node.depth, (perDepth.get(node.depth) ?? 0) + 1);
  return Math.max(0, ...perDepth.values()) > RADIAL_LEVEL_SIZE
    ? "radial"
    : "columns";
}
