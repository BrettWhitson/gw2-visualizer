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
  /** @type {Map<number, import('../types.js').Recipe | null>} item id → the recipe a one-unit plan uses (memo) */
  #recipes = new Map();

  /**
   * @param {{ getRecipes: (itemId: number) => import('../types.js').Recipe[],
   *           getConsumers: (itemId: number) => Set<number>,
   *           owned: Map<number, number>, wallet?: Map<number, number>,
   *           includePromotions?: boolean,
   *           recipeAllowed?: (recipe: import('../types.js').Recipe) => boolean }} options
   *   recipeAllowed: recipes it returns false for are never used, at any step of a plan (e.g. no character has the
   *   crafting level for them)
   */
  constructor({
    getRecipes,
    getConsumers,
    owned,
    wallet = new Map(),
    includePromotions = false,
    recipeAllowed = () => true,
  }) {
    this.getConsumers = getConsumers;
    this.owned = owned;
    this.wallet = wallet;
    this.recipesOf = (itemId) =>
      getRecipes(itemId).filter(
        (recipe) =>
          (includePromotions || !recipe.isPromotion) &&
          recipeAllowed(recipe) &&
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

  /** The recipe a plan for one unit would use (the first that works), or null (memoised). */
  recipeFor(itemId) {
    if (!this.#recipes.has(itemId))
      this.#recipes.set(itemId, this.#craftOnly(itemId, 1) ?? null);
    return this.#recipes.get(itemId);
  }

  /**
   * The products of an item that really use it: craftable (in `craftable`) and made, in the plan for one, by a recipe
   * with the item as a direct ingredient. A product whose other recipe uses it doesn't count.
   */
  productsUsing(itemId, craftable) {
    return [...this.getConsumers(itemId)].filter(
      (id) =>
        craftable.has(id) &&
        this.recipeFor(id)?.ingredients.some(
          (ingredient) =>
            ingredient.type === "Item" && ingredient.id === itemId,
        ),
    );
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
  /** Crafts made by the plan being explained (null when not explaining). */
  #trace = null;

  /**
   * The plan behind making `quantity` of an item: every craft step, the owned items it uses up and the currencies
   * it spends. Null when it can't be made.
   * @returns {{ steps: Map<number, { recipe: import('../types.js').Recipe, crafts: number }>,
   *             consumed: Map<number, number>, spent: Map<number, number> } | null}
   */
  explain(itemId, quantity) {
    const ledger = new Ledger(this.owned);
    const wallet = new Ledger(this.wallet);
    this.#work = WORK_BUDGET;
    this.#trace = [];
    try {
      const recipe = this.#make(
        itemId,
        quantity,
        ledger,
        wallet,
        new Set([itemId]),
        0,
      );
      if (recipe === undefined) return null;
      const steps = new Map();
      for (const step of this.#trace) {
        const entry = steps.get(step.itemId);
        if (entry) entry.crafts += step.crafts;
        else
          steps.set(step.itemId, { recipe: step.recipe, crafts: step.crafts });
      }
      const consumed = new Map();
      for (const [id, value] of ledger.changes) {
        const used = (this.owned.get(id) ?? 0) - value;
        if (used > 0) consumed.set(id, used);
      }
      const spent = new Map();
      for (const [id, value] of wallet.changes) {
        const used = (this.wallet.get(id) ?? 0) - value;
        if (used > 0) spent.set(id, used);
      }
      return { steps, consumed, spent };
    } finally {
      this.#trace = null;
    }
  }

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
        walletMark = wallet.mark(),
        traceMark = this.#trace?.length;
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
        this.#trace?.push({ itemId, recipe, crafts });
        return recipe;
      }
      ledger.rollback(mark);
      wallet.rollback(walletMark);
      if (this.#trace) this.#trace.length = traceMark;
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
 *           expanded: Set<string>, collapsed?: Set<string>, showAll: Set<string>, highlight?: Set<string>,
 *           initialDepth?: number,
 *           childLimit?: number }} options
 *   craftable: item id → how many can be made; expanded: node paths the user opened (beyond initialDepth);
 *   collapsed: node paths the user closed (within initialDepth); showAll: node paths whose "+N more" was opened;
 *   highlight: node paths on the routes to point out (always shown, flagged isBestRoute);
 *   focus: node paths opened only to follow a route: they show just their highlighted children, the rest folded;
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
    highlight = new Set(),
    focus = new Set(),
    initialDepth = 1,
    childLimit = CHILD_LIMIT,
  },
) {
  const nodesById = new Map();
  const edges = [];
  const productsOf = (itemId) =>
    planner
      .productsUsing(itemId, craftable)
      .sort((a, b) => rank(b) - rank(a) || a - b);

  const addNode = (itemId, path, depth, ancestors) => {
    const products = productsOf(itemId).filter((id) => !ancestors.has(id));
    const isFocused = focus.has(path) && !expanded.has(path);
    const isOpen =
      !collapsed.has(path) &&
      (depth < initialDepth || expanded.has(path) || isFocused);
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
      isBestRoute: highlight.has(path),
    };
    nodesById.set(path, node);
    if (!isOpen) return;

    // Children on a highlighted route are always shown, even past the limit.
    const onRoute = (productId) => highlight.has(`${path}/${productId}`);
    const routeCount = products.filter(onRoute).length;
    const shown = showAll.has(path)
      ? products
      : [
          ...products.filter(onRoute),
          ...products.filter((id) => !onRoute(id)),
        ].slice(0, isFocused ? routeCount : Math.max(childLimit, routeCount));
    const nextAncestors = new Set(ancestors).add(itemId);
    // Paths use item ids, not positions: ranking changes (prices arriving) mustn't move what's expanded.
    shown.forEach((productId) => {
      const childPath = `${path}/${productId}`;
      addNode(productId, childPath, depth + 1, nextAncestors);
      edges.push({
        edgeId: `${path}->${childPath}`,
        sourceId: path,
        targetId: childPath,
        // How many one craft uses; 0 (no label) if unknown.
        quantity:
          planner
            .recipeFor(productId)
            ?.ingredients.find(
              (ingredient) =>
                ingredient.type === "Item" && ingredient.id === itemId,
            )?.count ?? 0,
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
    const productCount = planner.productsUsing(itemId, craftable).length;
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
 * `profit` ranks by `profitOf` (unprofitable and unknown last).
 * @param {{ query?: string, discipline?: string, sort: "profit" | "value" | "count" | "rarity" | "name",
 *           nameOf: (id: number) => string, priceOf: (id: number) => number | null,
 *           rarityRankOf: (id: number) => number, countOf: (entry: object) => number,
 *           profitOf?: (entry: object) => number | null, disciplinesOf?: (entry: object) => string[],
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
    profitOf = () => null,
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
  const profit = (entry) => profitOf(entry) ?? -Infinity;
  const compare = {
    profit: (a, b) => profit(b) - profit(a) || 0, // -Infinity - -Infinity is NaN: treat as a tie
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

// ---------------------------------------------------------------- profit

/** The Trading Post's fees on a sale: a listing fee and an exchange fee, each a share of the price. */
export const TRADING_POST_FEES = { listing: 0.05, exchange: 0.1 };
const COIN_ID = 1;

/**
 * What selling one unit at `price` copper leaves you after the Trading Post's fees. Each fee is charged per unit with a
 * 1 copper minimum (documented game rules). The game doesn't document how a fraction of a copper is rounded, so each
 * fee is rounded up: that can understate a profit by a copper, never overstate one. Never below 0: a 2c item nets
 * nothing.
 */
export function tradingPostNet(price) {
  if (!(price > 0)) return 0;
  const fee = (share) => Math.max(1, Math.ceil(share * price - 1e-9));
  return Math.max(
    0,
    price - fee(TRADING_POST_FEES.listing) - fee(TRADING_POST_FEES.exchange),
  );
}

/**
 * Profit from crafting `count` of an item instead of selling what it uses up. Values come from `valueOf` (the
 * caller's choice: the highest buy order, what an instant sale gets). Both sides are after the Trading Post's fees
 * (per unit, see tradingPostNet); coin spent counts at face value. Inputs with no value (account-bound, no buyers)
 * count as free and are reported.
 * @param {(itemId: number) => number | null} valueOf  copper per unit, null when it can't be sold
 * @param {{ buyOrders?: { unitPrice: number, quantity: number }[] }} [options]  the output's order book: when given,
 *   the sale is priced at what the buy orders can actually take (see sellIntoBuyOrders) instead of count × valueOf.
 *   When they take only some (`sold` < count), the cost is for making just those, so both sides cover the same units.
 * @returns {{ itemId: number, count: number, revenue: number | null, cost: number, profit: number | null,
 *             sold: number, plan: ReturnType<CraftPlanner["explain"]>, unvaluedInputs: number[],
 *             otherCurrencies: [number, number][] } | null}
 *   plan: the plan the cost is for (making `sold`)
 */
export function profitOf(planner, itemId, count, valueOf, { buyOrders } = {}) {
  const fullPlan = planner.explain(itemId, count);
  if (!fullPlan) return null;
  let revenue = null,
    sold = count;
  if (buyOrders) {
    const sale = sellIntoBuyOrders(buyOrders, count);
    sold = sale.sold;
    revenue = sale.sold ? sale.net : null;
  } else {
    const unit = valueOf(itemId);
    if (unit != null) revenue = tradingPostNet(unit) * count;
  }
  // Selling fewer than can be made: cost what making just those takes (re-planned; pro-rated if that somehow fails).
  let plan = fullPlan,
    scale = 1;
  if (sold > 0 && sold < count) {
    const soldPlan = planner.explain(itemId, sold);
    if (soldPlan) plan = soldPlan;
    else scale = sold / count;
  }
  let cost = (plan.spent.get(COIN_ID) ?? 0) * scale;
  const unvaluedInputs = [];
  for (const [id, used] of plan.consumed) {
    const value = valueOf(id);
    if (value == null) unvaluedInputs.push(id);
    else cost += tradingPostNet(value) * used * scale;
  }
  cost = Math.round(cost);
  return {
    itemId,
    count,
    revenue,
    cost,
    profit: revenue == null ? null : revenue - cost,
    sold,
    plan,
    unvaluedInputs,
    otherCurrencies: [...plan.spent]
      .filter(([id]) => id !== COIN_ID)
      .map(([id, amount]) => [id, Math.round(amount * scale)]),
  };
}

/**
 * Selling `count` into the buy orders, highest first: the gross copper, what's left of it after the fees (per unit, at
 * each order's price) and how many they absorb (big stacks run out of buyers at the top price, so a lone high order
 * doesn't price the whole lot).
 * @param {{ unitPrice: number, quantity: number }[]} buyOrders  highest first
 */
export function sellIntoBuyOrders(buyOrders, count) {
  let gross = 0,
    net = 0,
    sold = 0;
  for (const { unitPrice, quantity } of buyOrders) {
    if (sold >= count) break;
    const take = Math.min(quantity, count - sold);
    gross += take * unitPrice;
    net += take * tradingPostNet(unitPrice);
    sold += take;
  }
  return { gross, net, sold };
}

/**
 * Items the account could craft now without a planner's recipe restriction, but can't with it: each item `open` (an
 * unrestricted planner) can make one of that isn't in `craftable` (what the restricted planner found), with the recipe
 * it would use. Cheap next to findCraftable: one check per candidate, no counting.
 * @param {CraftPlanner} open
 * @param {Map<number, number> | Set<number>} craftable
 * @param {{ shouldYield?: () => boolean, yieldToPage?: () => Promise<void> }} [options]
 * @returns {Promise<{ itemId: number, recipe: import('../types.js').Recipe }[]>}
 */
export async function findBlocked(
  open,
  craftable,
  { shouldYield = () => false, yieldToPage: pause = yieldToPage } = {},
) {
  const blocked = [];
  for (const itemId of open.forwardCandidates()) {
    if (shouldYield()) await pause();
    if (craftable.has(itemId)) continue;
    const recipe = open.recipeFor(itemId);
    if (recipe) blocked.push({ itemId, recipe });
  }
  return blocked;
}

/**
 * The chain of crafts in a plan leading from `materialId` to `productId`: [material, …intermediates, product], or
 * null when the plan doesn't use the material.
 */
export function routeFrom(plan, productId, materialId) {
  const walk = (itemId, seen) => {
    if (itemId === materialId) return [itemId];
    const step = plan.steps.get(itemId);
    if (!step || seen.has(itemId)) return null;
    seen.add(itemId);
    for (const ingredient of step.recipe.ingredients) {
      if (ingredient.type !== "Item") continue;
      const route = walk(ingredient.id, seen);
      if (route) return [...route, itemId];
    }
    return null;
  };
  return walk(productId, new Set());
}

/** Best products kept per material. */
export const TOP_ROUTES = 3;

/**
 * Profit for every craftable item that can be sold, then, for each owned material, the most profitable things to make
 * with it; and for every item on some plan's way, the best profit reachable through it (ranks the forward graph).
 * @param {{ itemId: number, count: number }[]} entries  craftable items and how many can be made
 * @param {{ shouldYield?: () => boolean, yieldToPage?: () => Promise<void> }} [options]
 */
export async function analyseProfits(
  planner,
  entries,
  valueOf,
  { shouldYield = () => false, yieldToPage: pause = yieldToPage } = {},
) {
  const byItem = new Map();
  for (const { itemId, count } of entries) {
    if (shouldYield()) await pause();
    if (valueOf(itemId) == null) continue;
    const result = profitOf(planner, itemId, count, valueOf);
    if (result) byItem.set(itemId, result);
  }
  return rebuildBests(byItem);
}

/** From per-item profits: each material's best uses, and the best profit reachable through each item. */
export function rebuildBests(byItem) {
  const bestByMaterial = new Map();
  const bestThrough = new Map();
  const raise = (itemId, profit) => {
    if (profit > (bestThrough.get(itemId) ?? -Infinity))
      bestThrough.set(itemId, profit);
  };
  for (const [itemId, result] of byItem) {
    if (result.profit == null) continue;
    raise(itemId, result.profit);
    for (const stepId of result.plan.steps.keys()) raise(stepId, result.profit);
    for (const materialId of result.plan.consumed.keys()) {
      raise(materialId, result.profit);
      const best = bestByMaterial.get(materialId) ?? [];
      best.push({ itemId, profit: result.profit });
      best.sort((a, b) => b.profit - a.profit || a.itemId - b.itemId);
      bestByMaterial.set(materialId, best.slice(0, TOP_ROUTES));
    }
  }
  return { byItem, bestByMaterial, bestThrough };
}
