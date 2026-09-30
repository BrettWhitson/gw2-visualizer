/**
 * Entry point for the "What you can craft" page: a ranked list of what the connected account can craft right now
 * from what it owns, and a forward graph of what a chosen item or material can become. The graph reuses the
 * crafting page's graph view, layout and look.
 */
import { CACHE_DB_NAME, EntityKind, RARITY_ORDER } from "./config/constants.js";
import { SettingsStore } from "./core/settings-store.js";
import {
  createAccountSession,
  createPriceBook,
  pricesMaxAge,
} from "./data/site-account.js";
import { OrderBooks } from "./data/order-books.js";
import { DataUpdates, getDataUpdates } from "./core/data-preferences.js";
import { GameData } from "./data/game-data.js";
import { Gw2ApiClient } from "./data/gw2-api-client.js";
import { IndexedDbStore } from "./data/indexed-db-store.js";
import { craftingRequirement } from "./model/account-inventory.js";
import {
  CraftPlanner,
  MAX_COUNT,
  TRADING_POST_NET,
  analyseProfits,
  buildForwardGraph,
  profitOf,
  rebuildBests,
  chooseLayout,
  routeFrom,
  filterAndSort,
  recipeDisciplines,
  usefulMaterials,
} from "./model/craftable.js";
import { chooseGraphView } from "./render/choose-graph-view.js";

/** Looks for this page's own classes: "+N more" folds are placeholders, and the most profitable routes stand out. */
const CLASS_STYLES = {
  nodes: {
    overflow: { pattern: "dashed", fillAlpha: 0.4 },
    "best-route": { aura: "#e5b83b", labelPriority: 1 },
  },
  edges: { "best-route": { color: "#e5b83b", width: 3, glow: true } },
};
import { NodeAppearance } from "./graph/node-appearance.js";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { registerServiceWorker } from "./pwa.js";
import { escapeHtml, querySelector as $ } from "./utils/dom.js";
import {
  formatAge,
  formatCoinsHtml,
  formatCoinsText,
  formatNumber,
} from "./utils/format.js";

const LAYOUT_KEY = "gw2ct.craftableLayout";
const LAYOUT_SETTINGS = {
  columns: { direction: "RL", layoutEngine: "layered" },
  radial: { direction: "radial", layoutEngine: "layered" },
};

/**
 * How many of the most profitable results are re-priced against their order books: one API request, and as many as
 * the list shows at once (thin markets further down were rare, and order books are heavy responses).
 */
const ORDER_BOOK_CHECKS = 150;

/** Rows rendered at once; "Show more" adds this many again. */
const PAGE_SIZE = 150;
/**
 * The forward graph reads left to right: an item on the left, what it becomes to its right. In the crafting page's
 * terms that's the "RL" direction (its root grows toward the right) with arrows at the product end of each edge.
 */
const GRAPH_OVERRIDES = {
  direction: "RL",
  arrowEnd: "ingredient",
  flowToward: "target", // edges run ingredient → product here
  viewMode: "tree",
  showCostInLabel: false,
  edgeQuantityLabels: "on",
  showBuyCheaperHint: false,
};

const countLabel = (count) =>
  count >= MAX_COUNT ? `${formatNumber(MAX_COUNT)}+` : formatNumber(count);

/** Labels for this graph: "can make N" on products, "you have N" on the root, "+N more" on folds. */
class CraftableAppearance extends NodeAppearance {
  /** @type {(itemId: number) => number | null} profit from making all you can, set by the page */
  profitOf = () => null;

  label(node) {
    const name = this.gameData.getEntity(node.kind, node.entityId).name;
    if (node.isOverflow) return `+${formatNumber(node.quantity)} more  ▸`;
    const more = node.isCollapsed ? "  ▸" : "";
    if (node.isRoot)
      return `${name}\n(you have ${formatNumber(node.quantity)})`;
    const profit = this.profitOf(node.entityId);
    return `${countLabel(node.quantity)} × ${name}${more}${
      profit
        ? `\n${profit > 0 ? `+${formatCoinsText(profit)} profit` : `${formatCoinsText(-profit)} loss`}`
        : ""
    }`;
  }
}

/** "Mithril Ore → Mithril Ingot → …": long routes keep their ends. */
function routeText(names) {
  const shown =
    names.length > 5 ? [...names.slice(0, 2), "…", ...names.slice(-2)] : names;
  return shown.join(" → ");
}

class CraftablePage {
  settings = new SettingsStore();
  api = new Gw2ApiClient();
  priceBook = createPriceBook(this.api);
  orderBooks = new OrderBooks(this.api, {
    store: new IndexedDbStore(CACHE_DB_NAME),
    maxAge: pricesMaxAge,
  });
  /** The account data the results were computed for: a refresh that changes nothing else doesn't redo them. */
  #computedFor = null;
  /** The next computation refetches prices and order books (the Refresh button). */
  #forceFetch = false;
  gameData = new GameData({
    apiClient: this.api,
    cache: new IndexedDbStore(CACHE_DB_NAME),
  });
  /** @type {CraftPlanner | null} */
  planner = null;
  /** @type {Map<number, number>} item id → how many can be made */
  craftable = new Map();
  /** @type {{ itemId: number, count: number, recipe: object }[]} */
  craftableEntries = [];
  materials = [];
  /** @type {Awaited<ReturnType<typeof analyseProfits>> | null} profit per item and the best uses of each material */
  profits = null;
  list = "craftable";
  shown = PAGE_SIZE;
  rootItemId = null;
  selectedNodeId = null;
  expanded = new Set();
  collapsed = new Set();
  showAll = new Set();
  graph = null;
  #gameDataReady = null;
  /** The item last opened, and for which account: reopened after a refresh. */
  #lastRoot = null;
  /** "auto" | "columns" | "radial", remembered in this browser. */
  layoutPreference = readStored(
    LAYOUT_KEY,
    ["auto", "columns", "radial"],
    "auto",
  );
  #computeToken = 0;

  /** @param {AccountSession} account */
  constructor(account) {
    this.account = account;
    const graphSettings = {
      values: { ...this.settings.values, ...GRAPH_OVERRIDES },
    };
    graphSettings.get = (key) => graphSettings.values[key];
    this.graphSettings = graphSettings;
    this.appearance = new CraftableAppearance({
      gameData: this.gameData,
      settings: graphSettings,
    });
    this.appearance.profitOf = (itemId) =>
      this.profits?.byItem.get(itemId)?.profit ?? null;
  }

  start() {
    this.graphView = new (chooseGraphView(this.settings.values))({
      container: $("#cy"),
      canvasWrapper: $("#cyWrap"),
      settings: this.graphSettings,
      handlers: {
        onNodeTap: (nodeId) => this.#onNodeTap(nodeId),
        onNodeDoubleTap: (nodeId) => this.#toggle(nodeId),
        onNodeContextTap: () => {},
        onBackgroundTap: () => this.#select(null),
        onNodeHoverStart: (nodeId, event) => {
          this.graphView.showLineage(nodeId);
          this.#showTooltip(nodeId, event);
        },
        onNodeHoverEnd: () => {
          this.graphView.clearLineage();
          $("#craftTooltip").hidden = true;
        },
        onPointerMove: (event) => this.#moveTooltip(event),
        onViewportChange: () => ($("#craftTooltip").hidden = true),
      },
    });
    this.graphView.setClassStyles(CLASS_STYLES);
    this.#bindControls();
    this.account.addEventListener(
      "change",
      () => (this.#computing = this.#onAccountChange()),
    );
    this.#gameDataReady = this.gameData
      .load({
        onProgress: (message) => this.#status(message),
      })
      .then(() => {
        performance.mark("craftable:game-data");
        this.#status("");
      })
      .catch((error) =>
        this.#status(`Couldn't load game data: ${error.message}`),
      );
    this.#onAccountChange();
  }

  #status(text) {
    $("#statusText").textContent = text;
  }

  // ---------------------------------------------------------------- account → results

  /** Forget the lists, graph and selection: they belonged to the account as it was. */
  #resetResults() {
    this.#computedFor = null; // whatever comes next is computed afresh
    this.planner = null;
    this.craftable = new Map();
    this.craftableEntries = [];
    this.materials = [];
    this.profits = null;
    this.rootItemId = null;
    this.graph = null;
    this.expanded = new Set();
    this.collapsed = new Set();
    this.showAll = new Set();
    this.#select(null);
    this.graphView.clear();
    $("#craftTooltip").hidden = true;
    this.#renderList();
  }

  async #onAccountChange() {
    const { status, fetchedAt } = this.account;
    this.#renderDataBar();
    // A background refresh starting or failing changes nothing on screen; only new data redoes the results.
    if (
      status === "ready" &&
      this.planner &&
      this.#computedFor?.accountName === this.account.accountName &&
      this.#computedFor?.fetchedAt === fetchedAt
    )
      return;
    const token = ++this.#computeToken;
    this.#resetResults();
    if (status !== "ready") {
      this.#showGraphMessage(
        status === "connecting"
          ? "Loading what your account owns…"
          : "Connect your account (top right) to see what you can craft with what you own. The key needs the <b>inventories</b> permission; add <b>characters</b> to check crafting levels and <b>wallet</b> for recipes that cost coin, karma or other currencies.",
      );
      return;
    }
    if (!this.account.has("inventories")) {
      this.#showGraphMessage(
        "Your API key lacks the <b>inventories</b> permission, so what you own can't be read. Connect a key with <b>inventories</b> (and <b>characters</b>, <b>wallet</b>).",
      );
      return;
    }
    this.#showGraphMessage("Working out what you can craft…");
    await this.#gameDataReady;
    if (token !== this.#computeToken) return;
    if (!this.gameData.recipesByOutputId.size) {
      this.#showGraphMessage(
        "The game data couldn't be loaded, so recipes aren't available. Check your connection and reload the page.",
      );
      return;
    }

    this.#computedFor = { accountName: this.account.accountName, fetchedAt };
    const force = this.#forceFetch; // cleared once a computation with it completes
    this.planner = new CraftPlanner({
      getRecipes: (id) => this.gameData.getRecipes(id),
      getConsumers: (id) => this.gameData.getConsumers(id),
      owned: this.account.ownedItems,
      wallet: this.account.wallet,
    });
    let sliceStart = performance.now();
    const entries = await this.planner.findCraftable({
      shouldYield: () => {
        if (performance.now() - sliceStart < 12) return false;
        sliceStart = performance.now();
        return true;
      },
      onProgress: (done, total) =>
        this.#status(`Checking recipes… ${Math.round((100 * done) / total)}%`),
    });
    if (token !== this.#computeToken) return;
    performance.mark("craftable:planned"); // milestones for profiling (DevTools → Performance, or getEntriesByType)
    this.#status("");
    this.craftableEntries = entries;
    this.craftable = new Map(
      entries.map(({ itemId, count }) => [itemId, count]),
    );
    this.materials = usefulMaterials(this.planner, this.craftable);
    this.#fillDisciplines();
    this.#renderList();
    this.#showGraphMessage(
      entries.length
        ? "Pick an item or one of your materials to see what it can become."
        : "Nothing can be crafted from what this account holds right now.",
    );
    // After a refresh of the same account, keep looking at the same item when it's still owned or craftable.
    const previous = this.#lastRoot;
    if (
      previous?.accountName === this.account.accountName &&
      (this.craftable.has(previous.itemId) ||
        this.planner.owned.get(previous.itemId) > 0)
    )
      this.#openRoot(previous.itemId);
    // Prices, then profits: what each item sells for, minus what its materials would. Only what can matter is
    // priced: craftable items that can be traded, and owned items that feed something craftable.
    const tradeable = (id) =>
      !(this.gameData.items.get(id)?.flags ?? []).some(
        (flag) => flag === "AccountBound" || flag === "SoulbindOnAcquire",
      );
    const shouldYield = () => {
      if (performance.now() - sliceStart < 12) return false;
      sliceStart = performance.now();
      return true;
    };
    const fetchPrices = async (ids) => {
      try {
        await this.priceBook.ensure(ids.filter(tradeable), { force });
      } catch {
        /* no prices: no profits; the list still works */
      }
    };
    this.#status("Fetching Trading Post prices…");
    await fetchPrices([
      ...this.craftable.keys(),
      ...this.materials.map((material) => material.itemId),
    ]);
    if (token !== this.#computeToken) return;
    this.#status("Working out profits…");
    sliceStart = performance.now();
    const valueOf = (id) => this.#valueOf(id);
    let profits = await analyseProfits(this.planner, entries, valueOf, {
      shouldYield,
    });
    if (token !== this.#computeToken) return;
    // A plan can use an owned item the first pass didn't price (deep chains): price those and work it out again.
    const unpriced = new Set();
    for (const result of profits.byItem.values())
      for (const id of result.plan.consumed.keys())
        if (!this.priceBook.has(id)) unpriced.add(id);
    const toFetch = [...unpriced].filter(tradeable);
    if (toFetch.length) {
      await fetchPrices(toFetch);
      if (token !== this.#computeToken) return;
      profits = await analyseProfits(this.planner, entries, valueOf, {
        shouldYield,
      });
      if (token !== this.#computeToken) return;
    }
    this.profits = profits;
    this.#renderDataBar();
    // Show the ranking now; the order-book check refines the top of it afterwards.
    this.#renderList();
    performance.mark("craftable:ranked");
    if (this.rootItemId != null) this.#openRoot(this.rootItemId);
    this.#status("Checking buy-order depth…");
    const changed = await this.#priceAgainstOrderBooks(token, force);
    if (token !== this.#computeToken) return;
    if (force) this.#forceFetch = false;
    this.#status("");
    performance.mark("craftable:refined");
    if (changed) {
      this.#renderList();
      if (this.rootItemId != null) this.#openRoot(this.rootItemId);
    }
  }

  /** "Account data 3 h ago · prices 3 h ago · Refresh", and whether updates are manual. */
  #renderDataBar() {
    const bar = $("#craftData");
    if (!this.account.isReady) {
      bar.hidden = true;
      return;
    }
    const now = Date.now();
    const pricesAt = this.priceBook.oldestFetchedAt(this.craftable.keys());
    const parts = [
      this.account.fetchedAt != null
        ? `Account data ${formatAge(now - this.account.fetchedAt)}`
        : "",
      pricesAt != null ? `prices ${formatAge(now - pricesAt)}` : "",
    ].filter(Boolean);
    const busy = this.account.refreshing || this.#refreshing;
    bar.hidden = false;
    bar.innerHTML = `<span>${escapeHtml(parts.join(" · "))}${
      getDataUpdates() === DataUpdates.manual
        ? ' <span class="muted" title="Change this in the account menu (top right)">· updates when you refresh</span>'
        : ""
    }</span>
      <button type="button" class="linklike" data-refresh-data${busy ? " disabled" : ""}>${busy ? "Refreshing…" : "Refresh"}</button>`;
  }

  #refreshing = false;
  /** The computation under way (or last run), so a refresh can wait for it. */
  #computing = null;

  /** Refresh: the account from the API, then prices and order books fetched again for the new results. */
  async #refreshAll() {
    this.#refreshing = true;
    this.#forceFetch = true;
    this.#renderDataBar();
    try {
      const loaded = await this.account.refresh();
      // New account data recomputes through the change event; otherwise (unchanged, or unreachable) still refresh
      // the prices. Either way, wait for that computation before calling the refresh done.
      if (!loaded && this.account.isReady) {
        this.#computedFor = null;
        this.#computing = this.#onAccountChange();
      }
      await this.#computing;
    } finally {
      this.#refreshing = false;
      this.#renderDataBar();
    }
  }

  /**
   * The top buy order says little about selling hundreds: the most profitable results are re-priced at what the
   * buy orders can actually take, then the per-material bests are rebuilt from the corrected numbers.
   */
  async #priceAgainstOrderBooks(token, force = false) {
    const { byItem } = this.profits;
    const top = [...byItem.values()]
      .filter((result) => result.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, ORDER_BOOK_CHECKS);
    let books;
    try {
      books = await this.orderBooks.get(
        top.map((result) => result.itemId),
        { force },
      );
    } catch {
      return false; // keep the headline-price estimate
    }
    if (token !== this.#computeToken) return false;
    for (const result of top) {
      const corrected = profitOf(
        this.planner,
        result.itemId,
        result.count,
        (id) => this.#valueOf(id),
        { buyOrders: books.get(result.itemId) ?? [] },
      );
      if (corrected) byItem.set(result.itemId, corrected);
    }
    this.profits = rebuildBests(byItem);
    return true;
  }

  /**
   * What an item is worth: the highest buy order (an instant sale), before the Trading Post's cut. Null with no
   * buyers: a lone high sell listing says nothing about what it would fetch.
   */
  #valueOf(itemId) {
    const buy = this.priceBook.getQuote(itemId)?.buy;
    return buy > 0 ? buy : null;
  }

  /** The best uses of an item (a material, or a step on the way): [{ itemId, profit, route }], best first. */
  #bestRoutesFrom(itemId, limit = 3) {
    if (!this.profits) return [];
    const { byItem, bestByMaterial } = this.profits;
    const candidates =
      bestByMaterial.get(itemId) ??
      [...byItem.values()]
        .filter(
          (result) => result.plan.steps.has(itemId) && result.itemId !== itemId,
        )
        .map((result) => ({ itemId: result.itemId, profit: result.profit }))
        .sort((a, b) => b.profit - a.profit)
        .slice(0, limit);
    return candidates
      .filter((candidate) => candidate.profit > 0)
      .slice(0, limit)
      .map((candidate) => ({
        ...candidate,
        route: routeFrom(
          byItem.get(candidate.itemId).plan,
          candidate.itemId,
          itemId,
        ),
      }))
      .filter((candidate) => candidate.route);
  }

  /** For a craftable item: the chain from its main material (the one worth the most) to it. */
  #routeTo(itemId) {
    const result = this.profits?.byItem.get(itemId);
    if (!result) return null;
    let main = null,
      mainValue = -1;
    for (const [id, used] of result.plan.consumed) {
      const value = (this.#valueOf(id) ?? 0) * used;
      if (value > mainValue) [main, mainValue] = [id, value];
    }
    return main == null ? null : routeFrom(result.plan, itemId, main);
  }

  #nameOf(itemId) {
    return this.gameData.getEntity(EntityKind.item, itemId).name;
  }

  // ---------------------------------------------------------------- list

  #bindControls() {
    globalThis.addEventListener("gw2-data-updates", () =>
      this.#renderDataBar(),
    );
    $("#craftData").addEventListener("click", (event) => {
      if (event.target.closest("[data-refresh-data]")) this.#refreshAll();
    });
    for (const tab of document.querySelectorAll("[data-list]"))
      tab.addEventListener("click", () => {
        this.list = tab.dataset.list;
        for (const other of document.querySelectorAll("[data-list]"))
          other.setAttribute("aria-selected", String(other === tab));
        this.shown = PAGE_SIZE;
        this.#renderList();
      });
    for (const id of [
      "craftSearch",
      "craftSort",
      "craftDiscipline",
      "craftLevels",
    ])
      $(`#${id}`).addEventListener("input", () => {
        this.shown = PAGE_SIZE;
        this.#renderList();
      });
    $("#craftResults").addEventListener("click", (event) => {
      if (event.target.closest("[data-more]")) {
        this.shown += PAGE_SIZE;
        this.#renderList();
        return;
      }
      const row = event.target.closest("[data-item-id]");
      if (row) this.#openRoot(Number(row.dataset.itemId));
    });
    document
      .querySelector(".graph-tools")
      .addEventListener("click", (event) => {
        const action = event.target.closest("[data-graph]")?.dataset.graph;
        if (action === "fit") this.graphView.fit();
        else if (action === "zoom-in") this.graphView.zoomBy(1.25);
        else if (action === "zoom-out") this.graphView.zoomBy(0.8);
      });
    $("#craftDetails").addEventListener("click", (event) => {
      const start = event.target.closest("[data-start]");
      if (start) this.#openRoot(Number(start.dataset.start));
      const route = event.target.closest("[data-route]");
      if (route)
        this.#revealRoute(route.dataset.routeFrom, Number(route.dataset.route));
      if (event.target.closest("[data-close-details]")) this.#select(null);
    });
    window.addEventListener("resize", () => this.graphView.resize());
    const layoutButtons = document.querySelectorAll("[data-layout]");
    const syncLayoutButtons = () =>
      layoutButtons.forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.layout === this.layoutPreference),
        ),
      );
    syncLayoutButtons();
    layoutButtons.forEach((button) =>
      button.addEventListener("click", () => {
        this.layoutPreference = button.dataset.layout;
        writeStored(LAYOUT_KEY, this.layoutPreference);
        syncLayoutButtons();
        this.#renderGraph({ fit: true });
      }),
    );
  }

  #fillDisciplines() {
    const select = $("#craftDiscipline");
    const current = select.value;
    const disciplines = new Set(
      this.craftableEntries.flatMap((entry) => recipeDisciplines(entry.recipe)),
    );
    select.innerHTML =
      '<option value="">Any discipline</option>' +
      [...disciplines]
        .sort()
        .map(
          (discipline) =>
            `<option value="${escapeHtml(discipline)}"${discipline === current ? " selected" : ""}>${escapeHtml(discipline)}</option>`,
        )
        .join("");
  }

  /** Can a character make this recipe (or is the check off / impossible without the characters permission)? */
  #levelAllows(recipe) {
    if (!$("#craftLevels").checked || !this.account.has("characters"))
      return true;
    return craftingRequirement(recipe, this.account.craftingLevels).canCraft;
  }

  #renderList() {
    const counts = {
      craftable: this.craftableEntries.length,
      materials: this.materials.length,
    };
    for (const [key, value] of Object.entries(counts))
      document.querySelector(`[data-count="${key}"]`).textContent = value
        ? formatNumber(value)
        : "";
    const results = $("#craftResults");
    if (!this.planner) {
      results.innerHTML = "";
      return;
    }
    const isMaterials = this.list === "materials";
    const nameOf = (id) => this.gameData.getEntity(EntityKind.item, id).name;
    const priceOf = (id) => this.#valueOf(id);
    const profitOf = (entry) =>
      isMaterials
        ? (this.profits?.bestByMaterial.get(entry.itemId)?.[0]?.profit ?? null)
        : (this.profits?.byItem.get(entry.itemId)?.profit ?? null);
    const sorted = filterAndSort(
      isMaterials ? this.materials : this.craftableEntries,
      {
        query: $("#craftSearch").value,
        discipline: isMaterials ? "" : $("#craftDiscipline").value,
        sort: $("#craftSort").value,
        nameOf,
        priceOf,
        rarityRankOf: (id) =>
          RARITY_ORDER.indexOf(
            this.gameData.getEntity(EntityKind.item, id).rarity,
          ),
        countOf: (entry) => (isMaterials ? entry.productCount : entry.count),
        profitOf,
        disciplinesOf: (entry) => recipeDisciplines(entry.recipe),
        isAllowed: (entry) => isMaterials || this.#levelAllows(entry.recipe),
      },
    );
    const rows = sorted.slice(0, this.shown).map((entry) => {
      const entity = this.gameData.getEntity(EntityKind.item, entry.itemId);
      const color = this.gameData.getEntityColor(EntityKind.item, entry.itemId);
      const price = priceOf(entry.itemId);
      const profit = profitOf(entry);
      let detail, route;
      if (isMaterials) {
        const best = this.#bestRoutesFrom(entry.itemId, 1)[0];
        detail = `you have ${formatNumber(entry.owned)}${
          best
            ? ` · best: ${countLabel(this.craftable.get(best.itemId))} × ${escapeHtml(this.#nameOf(best.itemId))}`
            : ` · makes ${formatNumber(entry.productCount)} thing${entry.productCount === 1 ? "" : "s"}`
        }`;
        route = best?.route;
      } else {
        detail = `can make ${countLabel(entry.count)} · ${escapeHtml(recipeDisciplines(entry.recipe).join(", ") || "Recipe")}`;
        route = this.#routeTo(entry.itemId);
      }
      const routeHtml =
        route && route.length > 2
          ? `<span class="craft-route" title="${escapeHtml(route.map((id) => this.#nameOf(id)).join(" → "))}">${escapeHtml(routeText(route.map((id) => this.#nameOf(id))))}</span>`
          : "";
      return `<button type="button" class="craft-row${entry.itemId === this.rootItemId ? " current" : ""}" data-item-id="${entry.itemId}">
        ${entity.icon ? `<img src="${escapeHtml(entity.icon)}" alt="" loading="lazy" decoding="async" style="border-color:${color}">` : '<span class="no-icon"></span>'}
        <span class="craft-row-text"><span class="craft-row-name" style="color:${color}">${escapeHtml(entity.name)}</span>
        <span class="muted small">${detail}</span>${routeHtml}</span>
        <span class="craft-row-price">${price != null ? `<span title="Highest buy order, each">${formatCoinsHtml(price)}</span>` : '<span class="muted" title="No buy orders">no buyers</span>'}${
          profit != null
            ? `<span class="craft-row-profit ${profit > 0 ? "good" : "bad"}" title="${isMaterials ? "Best use of it: profit" : "Profit from making all you can"}: what it sells for minus what the materials would, after the Trading Post's 15%">${profit > 0 ? "+" : "−"}${formatCoinsHtml(Math.abs(profit))}</span>`
            : ""
        }</span>
      </button>`;
    });
    const hiddenByLevels =
      !isMaterials &&
      $("#craftLevels").checked &&
      this.account.has("characters")
        ? this.craftableEntries.filter(
            (entry) => !this.#levelAllows(entry.recipe),
          ).length
        : 0;
    results.innerHTML =
      (rows.length
        ? rows.join("")
        : '<p class="muted craft-none">Nothing matches.</p>') +
      (sorted.length > this.shown
        ? `<button type="button" class="craft-more" data-more>Show ${formatNumber(Math.min(PAGE_SIZE, sorted.length - this.shown))} more of ${formatNumber(sorted.length - this.shown)}</button>`
        : "") +
      (hiddenByLevels
        ? `<p class="muted small craft-none">${formatNumber(hiddenByLevels)} more need crafting levels your characters don't have.</p>`
        : "");
  }

  // ---------------------------------------------------------------- graph

  #showGraphMessage(html) {
    const empty = $("#graphEmpty");
    empty.innerHTML = `<p>${html}</p>`;
    empty.hidden = this.rootItemId != null && this.account.isReady;
  }

  #openRoot(itemId) {
    this.rootItemId = itemId;
    this.#lastRoot = { itemId, accountName: this.account.accountName };
    this.expanded = new Set();
    this.collapsed = new Set();
    this.showAll = new Set();
    // Open the best routes from here and point them out.
    // Steps opened for a route show only the route; double-click one for everything it makes.
    this.bestRoutes = this.#bestRoutesFrom(itemId);
    this.highlight = new Set();
    this.focus = new Set();
    for (const { route } of this.bestRoutes) {
      let path = "r";
      for (const stepId of route.slice(1)) {
        if (path !== "r") this.focus.add(path);
        path += `/${stepId}`;
        this.highlight.add(path);
      }
    }
    this.selectedNodeId = null;
    $("#graphEmpty").hidden = true;
    this.#renderGraph({ fit: true });
    this.#select("r");
    this.graphView.fit(); // again, now that the details column has taken its space
    this.#renderList();
  }

  #renderGraph({ fit = false, anchorNodeId = null } = {}) {
    if (this.rootItemId == null || !this.planner) return;
    this.graph = buildForwardGraph(this.rootItemId, {
      planner: this.planner,
      craftable: this.craftable,
      // Branches leading to the most profitable crafts first; then by price.
      rank: (id) =>
        this.profits?.bestThrough.get(id) ?? (this.#valueOf(id) ?? -1) - 1e12,
      expanded: this.expanded,
      collapsed: this.collapsed,
      showAll: this.showAll,
      highlight: this.highlight ?? new Set(),
      focus: this.focus ?? new Set(),
    });
    Object.assign(
      this.graphSettings.values,
      LAYOUT_SETTINGS[chooseLayout(this.graph, this.layoutPreference)],
    );
    const colorsByNodeId = new Map();
    const nodeElements = this.graph.nodes.map((node) => {
      const data = this.appearance.nodeData(node, 0);
      colorsByNodeId.set(node.nodeId, data.color);
      const classes = [
        this.appearance.classes(node),
        node.isOverflow && "overflow",
        node.isBestRoute && "best-route",
      ]
        .filter(Boolean)
        .join(" ");
      return { group: "nodes", data, classes };
    });
    // Edges run ingredient → product here (the crafting page's run product → ingredient), so they're built directly.
    const edgeElements = this.graph.edges.map((edge) => ({
      group: "edges",
      classes: this.graph.nodesById.get(edge.targetId)?.isBestRoute
        ? "best-route"
        : "",
      data: {
        id: edge.edgeId,
        source: edge.sourceId,
        target: edge.targetId,
        label: edge.quantity ? `×${formatNumber(edge.quantity)}` : "",
        sourceColor: colorsByNodeId.get(edge.sourceId),
        targetColor: colorsByNodeId.get(edge.targetId),
        controlPointDistances: [0],
        controlPointWeights: [0.5], // filled in by the layout for curved edges
      },
    }));
    this.graphView.render({
      nodeElements,
      edgeElements,
      nodesById: this.graph.nodesById,
      fit,
      anchorNodeId,
    });
    $("#craftTooltip").hidden = true; // its node may have moved or gone
    if (this.selectedNodeId && !this.graph.nodesById.has(this.selectedNodeId))
      this.#select(null);
    const productCount = this.graph.nodes.length - 1;
    this.#status(
      `${formatNumber(productCount)} item${productCount === 1 ? "" : "s"} shown · double-click a node to see what it makes in turn`,
    );
  }

  /** Double-click: open or close what a node can make; on "+N more", show them all. */
  #toggle(nodeId) {
    const node = this.graph?.nodesById.get(nodeId);
    if (!node) return;
    if (node.isOverflow) {
      const parent = nodeId.replace(/\/more$/, "");
      this.showAll.add(parent);
      // It may have been open only to show a route: keep it open now that it shows everything.
      if (this.focus?.delete(parent)) this.expanded.add(parent);
    } else if (!node.productCount) {
      return;
    } else if (this.focus?.has(nodeId)) {
      // Showing just a route: show everything it makes.
      this.focus.delete(nodeId);
      this.expanded.add(nodeId);
    } else if (node.hasChildren) {
      this.expanded.delete(nodeId);
      this.collapsed.add(nodeId);
    } else {
      this.collapsed.delete(nodeId);
      this.expanded.add(nodeId);
    }
    this.#renderGraph({ anchorNodeId: nodeId });
  }

  #onNodeTap(nodeId) {
    const node = this.graph?.nodesById.get(nodeId);
    if (node?.isOverflow) this.#toggle(nodeId);
    else this.#select(nodeId);
  }

  #select(nodeId) {
    this.selectedNodeId = nodeId;
    this.graphView.select(nodeId);
    const node = nodeId && this.graph?.nodesById.get(nodeId);
    const details = $("#craftDetails");
    const wasHidden = details.hidden;
    if (!node || node.isOverflow) details.hidden = true;
    else {
      details.innerHTML = this.#detailsHtml(node);
      details.hidden = false;
    }
    if (wasHidden !== details.hidden) this.graphView.resize(); // the graph gives up or regains the column
  }

  #detailsHtml(node) {
    const { gameData, planner } = this;
    const entity = gameData.getEntity(EntityKind.item, node.entityId);
    const color = gameData.getEntityColor(EntityKind.item, node.entityId);
    const price = this.#valueOf(node.entityId);
    const owned = planner.owned.get(node.entityId) ?? 0;
    const recipe = node.isRoot ? planner.recipeFor(node.entityId) : node.recipe;
    const lines = [
      owned ? `You have <b>${formatNumber(owned)}</b>` : "",
      this.craftable.has(node.entityId)
        ? `You can make <b>${countLabel(this.craftable.get(node.entityId))}</b>`
        : "",
      price != null
        ? `Buy orders: ${formatCoinsHtml(price)} each`
        : "No buy orders",
    ].filter(Boolean);
    const profitHtml = this.#profitHtml(node.entityId);
    const routesHtml = this.#bestRoutesHtml(node);
    let recipeHtml = "";
    if (recipe) {
      const requirement = this.account.has("characters")
        ? craftingRequirement(recipe, this.account.craftingLevels)
        : null;
      const ingredients = recipe.ingredients
        .map((ingredient) => {
          const kind =
            ingredient.type === "Currency"
              ? EntityKind.currency
              : EntityKind.item;
          const ingredientEntity = gameData.getEntity(kind, ingredient.id);
          const have =
            kind === EntityKind.currency
              ? (this.account.wallet.get(ingredient.id) ?? 0)
              : (planner.owned.get(ingredient.id) ?? 0);
          return `<li>${formatNumber(ingredient.count)} × <span style="color:${gameData.getEntityColor(kind, ingredient.id)}">${escapeHtml(ingredientEntity.name)}</span> <span class="muted">(have ${formatNumber(have)})</span></li>`;
        })
        .join("");
      recipeHtml = `<div class="muted small">${escapeHtml(recipeDisciplines(recipe).join(", ") || "Recipe")}${recipe.minRating ? ` ${recipe.minRating}` : ""} · makes ${formatNumber(recipe.outputCount)}${
        requirement && !requirement.canCraft
          ? ` · <span class="bad">no character has the level</span>`
          : ""
      }</div><ul class="craft-ingredients">${ingredients}</ul>`;
    }
    return `<div class="craft-details-head">${entity.icon ? `<img src="${escapeHtml(entity.icon)}" alt="" style="border-color:${color}">` : ""}
        <div><b style="color:${color}">${escapeHtml(entity.name)}</b><div class="muted small">${escapeHtml([entity.rarity, entity.type].filter(Boolean).join(" · "))}</div></div>
        <button type="button" class="craft-details-close" data-close-details aria-label="Close details">×</button></div>
      ${lines.length ? `<p>${lines.join(" · ")}</p>` : ""}
      ${profitHtml}
      ${routesHtml}
      ${recipeHtml}
      <div class="btnrow">
        ${node.isRoot ? "" : `<button type="button" data-start="${node.entityId}">Start from here</button>`}
        <a href="crafting.html#item=${Number(node.entityId)}">Crafting tree →</a>
      </div>`;
  }

  /** Making all you can of this item: what it sells for, what the materials would, and the crafts on the way. */
  #profitHtml(itemId) {
    const result = this.profits?.byItem.get(itemId);
    if (!result) return "";
    const steps = [...result.plan.steps]
      .filter(([id]) => id !== itemId)
      .map(
        ([id, step]) =>
          `<li>${formatNumber(step.crafts * step.recipe.outputCount)} × ${escapeHtml(this.#nameOf(id))}</li>`,
      )
      .join("");
    const notes = [
      result.unvaluedInputs.length
        ? `${result.unvaluedInputs.length} material${result.unvaluedInputs.length > 1 ? "s" : ""} with no buyers counted as free`
        : "",
      ...result.otherCurrencies.map(
        ([id, amount]) =>
          `also spends ${formatNumber(amount)} ${escapeHtml(this.gameData.getEntity(EntityKind.currency, id).name)}`,
      ),
    ].filter(Boolean);
    return `<div class="craft-profit">
      <div><span class="muted">Make all ${countLabel(result.count)}:</span> sells for ${formatCoinsHtml(result.revenue)}, materials worth ${formatCoinsHtml(result.cost)}</div>
      ${result.sold < result.count ? `<div class="bad small">Buy orders take only ${formatNumber(result.sold)} of ${formatNumber(result.count)}; the rest would need listing and waiting.</div>` : ""}
      <div class="${result.profit > 0 ? "good" : "bad"}"><b>${result.profit > 0 ? "Profit" : "Loss"} ${formatCoinsHtml(Math.abs(result.profit))}</b> <span class="muted small">(after the Trading Post's ${Math.round((1 - TRADING_POST_NET) * 100)}%)</span></div>
      ${notes.length ? `<div class="muted small">${escapeHtml(notes.join(" · "))}</div>` : ""}
      ${steps ? `<details><summary class="small">Crafts on the way</summary><ul class="craft-ingredients">${steps}</ul></details>` : ""}
    </div>`;
  }

  /** The most profitable things to make from this item, each with its route; click one to show it in the graph. */
  #bestRoutesHtml(node) {
    const routes = node.isRoot
      ? (this.bestRoutes ?? [])
      : this.#bestRoutesFrom(node.entityId);
    if (!routes.length) return "";
    const items = routes
      .map(
        ({ itemId, profit, route }, index) =>
          `<li><button type="button" class="linklike craft-route-link" data-route="${index}" data-route-from="${escapeHtml(node.nodeId)}">${countLabel(this.craftable.get(itemId))} × ${escapeHtml(this.#nameOf(itemId))}</button> <span class="good">+${formatCoinsHtml(profit)}</span>
          <div class="craft-route">${escapeHtml(route.map((id) => this.#nameOf(id)).join(" → "))}</div></li>`,
      )
      .join("");
    return `<div class="craft-best"><div class="muted small">Most profitable from here</div><ol>${items}</ol></div>`;
  }

  /** Show a best route from a node: open each step and select its end. */
  #revealRoute(fromNodeId, index) {
    const node = this.graph?.nodesById.get(fromNodeId);
    if (!node) return;
    const routes = node.isRoot
      ? (this.bestRoutes ?? [])
      : this.#bestRoutesFrom(node.entityId);
    const route = routes[index]?.route;
    if (!route) return;
    let path = fromNodeId;
    for (const stepId of route.slice(1)) {
      this.collapsed.delete(path);
      if (!this.graph.nodesById.get(path)?.hasChildren) this.focus?.add(path);
      path += `/${stepId}`;
      this.highlight?.add(path);
    }
    this.#renderGraph({ anchorNodeId: fromNodeId });
    if (this.graph.nodesById.has(path)) {
      this.#select(path);
      this.graphView.revealNode(path);
    }
  }

  // ---------------------------------------------------------------- tooltip

  #showTooltip(nodeId, event) {
    const node = this.graph?.nodesById.get(nodeId);
    if (!node) return;
    const tooltip = $("#craftTooltip");
    if (node.isOverflow) {
      tooltip.innerHTML = `${formatNumber(node.quantity)} more craftable items use this. Click to show them all.`;
    } else {
      const entity = this.gameData.getEntity(EntityKind.item, node.entityId);
      const facts = [
        node.isRoot
          ? `you have ${formatNumber(node.quantity)}`
          : `can make ${countLabel(node.quantity)}`,
        node.productCount
          ? `${formatNumber(node.productCount)} thing${node.productCount === 1 ? "" : "s"} craftable from it`
          : "",
      ].filter(Boolean);
      const profit = this.profits?.byItem.get(node.entityId)?.profit;
      if (profit != null)
        facts.push(
          `${profit > 0 ? "profit" : "loss"} ${formatCoinsText(Math.abs(profit))}`,
        );
      tooltip.innerHTML = `<b style="color:${this.gameData.getEntityColor(EntityKind.item, node.entityId)}">${escapeHtml(entity.name)}</b><div class="muted">${facts.join(" · ")}</div>${
        node.productCount
          ? `<div class="muted small">${node.hasChildren ? "Double-click to hide what it makes" : "Double-click to see what it makes"}</div>`
          : ""
      }`;
    }
    tooltip.hidden = false;
    this.#moveTooltip(event);
  }

  #moveTooltip(event) {
    const tooltip = $("#craftTooltip");
    if (tooltip.hidden || !event) return;
    const x = event.clientX ?? event.originalEvent?.clientX;
    const y = event.clientY ?? event.originalEvent?.clientY;
    if (x == null) return;
    const width = tooltip.offsetWidth,
      height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 14, innerHeight - height - 8))}px`;
  }
}

function readStored(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback; // storage blocked
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: kept for this page only */
  }
}

function showFatalError(message) {
  $("#graphEmpty").innerHTML = `<p>${escapeHtml(message)}</p>`;
}

const account = createAccountSession();
mountSiteChrome({ page: "craftable", account });
if (!globalThis.cytoscape) {
  showFatalError(
    "The graph library failed to load. Check your connection and reload the page.",
  );
} else {
  try {
    globalThis.cytoscape.use(globalThis.cytoscapeDagre);
  } catch {
    // cytoscape-dagre registers itself when loaded after cytoscape; use() then throws "already registered".
  }
  const page = new CraftablePage(account);
  if (["localhost", "127.0.0.1"].includes(location.hostname))
    globalThis.gw2Craftable = page; // console access while developing
  page.start();
  account.restore();
}
registerServiceWorker();
