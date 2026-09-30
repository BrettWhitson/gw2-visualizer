/**
 * Entry point for the "What you can craft" page: a ranked list of what the connected account can craft right now
 * from what it owns, and a forward graph of what a chosen item or material can become. The graph reuses the
 * crafting page's graph view, layout and look.
 */
import { CACHE_DB_NAME, EntityKind, RARITY_ORDER } from "./config/constants.js";
import { SettingsStore } from "./core/settings-store.js";
import { AccountSession } from "./data/account-session.js";
import { GameData } from "./data/game-data.js";
import { Gw2ApiClient } from "./data/gw2-api-client.js";
import { IndexedDbStore } from "./data/indexed-db-store.js";
import { PriceBook } from "./data/price-book.js";
import { craftingRequirement } from "./model/account-inventory.js";
import {
  CraftPlanner,
  MAX_COUNT,
  buildForwardGraph,
  chooseLayout,
  filterAndSort,
  recipeDisciplines,
  usefulMaterials,
} from "./model/craftable.js";
import { GraphView } from "./graph/graph-view.js";
import { NodeAppearance } from "./graph/node-appearance.js";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { registerServiceWorker } from "./pwa.js";
import { escapeHtml, querySelector as $ } from "./utils/dom.js";
import { formatCoinsHtml, formatNumber } from "./utils/format.js";

const LAYOUT_KEY = "gw2ct.craftableLayout";
const LAYOUT_SETTINGS = {
  columns: { direction: "RL", layoutEngine: "layered" },
  radial: { direction: "radial", layoutEngine: "layered" },
};

/** Rows rendered at once; "Show more" adds this many again. */
const PAGE_SIZE = 150;
/**
 * The forward graph reads left to right: an item on the left, what it becomes to its right. In the crafting page's
 * terms that's the "RL" direction (its root grows toward the right) with arrows at the product end of each edge.
 */
const GRAPH_OVERRIDES = {
  direction: "RL",
  arrowEnd: "ingredient",
  viewMode: "tree",
  showCostInLabel: false,
  edgeQuantityLabels: "on",
  showBuyCheaperHint: false,
};

const countLabel = (count) =>
  count >= MAX_COUNT ? `${formatNumber(MAX_COUNT)}+` : formatNumber(count);

/** Labels for this graph: "can make N" on products, "you have N" on the root, "+N more" on folds. */
class CraftableAppearance extends NodeAppearance {
  label(node) {
    const name = this.gameData.getEntity(node.kind, node.entityId).name;
    if (node.isOverflow) return `+${formatNumber(node.quantity)} more  ▸`;
    const more = node.isCollapsed ? "  ▸" : "";
    return node.isRoot
      ? `${name}\n(you have ${formatNumber(node.quantity)})`
      : `${countLabel(node.quantity)} × ${name}${more}`;
  }
}

class CraftablePage {
  settings = new SettingsStore();
  api = new Gw2ApiClient();
  priceBook = new PriceBook(this.api);
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
  }

  start() {
    this.graphView = new GraphView({
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
    this.#bindControls();
    this.account.addEventListener("change", () => this.#onAccountChange());
    this.#gameDataReady = this.gameData
      .load({
        onProgress: (message) => this.#status(message),
      })
      .then(() => this.#status(""))
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
    this.planner = null;
    this.craftable = new Map();
    this.craftableEntries = [];
    this.materials = [];
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
    const token = ++this.#computeToken;
    const { status } = this.account;
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
    // Prices rank "Most valuable"; the list redraws when they arrive.
    this.priceBook
      .ensure([
        ...this.craftable.keys(),
        ...this.materials.map((m) => m.itemId),
      ])
      .then((arrived) => {
        if (arrived && token === this.#computeToken) this.#renderList();
      })
      .catch(() => {
        /* no prices: "Most valuable" falls back to name order */
      });
  }

  // ---------------------------------------------------------------- list

  #bindControls() {
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
    const priceOf = (id) => this.priceBook.getUnitPrice(id, "sell");
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
        disciplinesOf: (entry) => recipeDisciplines(entry.recipe),
        isAllowed: (entry) => isMaterials || this.#levelAllows(entry.recipe),
      },
    );
    const rows = sorted.slice(0, this.shown).map((entry) => {
      const entity = this.gameData.getEntity(EntityKind.item, entry.itemId);
      const color = this.gameData.getEntityColor(EntityKind.item, entry.itemId);
      const price = priceOf(entry.itemId);
      const detail = isMaterials
        ? `you have ${formatNumber(entry.owned)} · makes ${formatNumber(entry.productCount)} thing${entry.productCount === 1 ? "" : "s"}`
        : `can make ${countLabel(entry.count)} · ${escapeHtml(recipeDisciplines(entry.recipe).join(", ") || "Recipe")}`;
      return `<button type="button" class="craft-row${entry.itemId === this.rootItemId ? " current" : ""}" data-item-id="${entry.itemId}">
        ${entity.icon ? `<img src="${escapeHtml(entity.icon)}" alt="" loading="lazy" decoding="async" style="border-color:${color}">` : '<span class="no-icon"></span>'}
        <span class="craft-row-text"><span class="craft-row-name" style="color:${color}">${escapeHtml(entity.name)}</span>
        <span class="muted small">${detail}</span></span>
        <span class="craft-row-price">${price != null ? formatCoinsHtml(price) : ""}</span>
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
      rank: (id) => this.priceBook.getUnitPrice(id, "sell") ?? -1,
      expanded: this.expanded,
      collapsed: this.collapsed,
      showAll: this.showAll,
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
      ]
        .filter(Boolean)
        .join(" ");
      return { group: "nodes", data, classes };
    });
    // Edges run ingredient → product here (the crafting page's run product → ingredient), so they're built directly.
    const edgeElements = this.graph.edges.map((edge) => ({
      group: "edges",
      classes: "",
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
    // "+N more" folds look like placeholders, not items (the shared stylesheet has no rule for them).
    this.graphView.cy
      .style()
      .selector("node.overflow")
      .style({ "border-style": "dashed", "background-opacity": 0.4 })
      .update();
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
      this.showAll.add(nodeId.replace(/\/more$/, ""));
    } else if (!node.productCount) {
      return;
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
    const price = this.priceBook.getUnitPrice(node.entityId, "sell");
    const owned = planner.owned.get(node.entityId) ?? 0;
    const recipe = node.isRoot ? planner.recipeFor(node.entityId) : node.recipe;
    const lines = [
      owned ? `You have <b>${formatNumber(owned)}</b>` : "",
      this.craftable.has(node.entityId)
        ? `You can make <b>${countLabel(this.craftable.get(node.entityId))}</b>`
        : "",
      price != null ? `Trading Post: ${formatCoinsHtml(price)} each` : "",
    ].filter(Boolean);
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
      ${recipeHtml}
      <div class="btnrow">
        ${node.isRoot ? "" : `<button type="button" data-start="${node.entityId}">Start from here</button>`}
        <a href="crafting.html#item=${Number(node.entityId)}">Crafting tree →</a>
      </div>`;
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

const account = new AccountSession();
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
