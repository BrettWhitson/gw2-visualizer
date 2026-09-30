import {
  ARENANET_NOTICE,
  CACHE_DB_NAME,
  EntityKind,
  RARITY_COLORS,
  SITE_TITLE,
  UI_COLORS,
  UNLIMITED_DEPTH,
} from "./config/constants.js";
import {
  CUSTOMIZE_GROUPS,
  Redraw,
  SETTINGS_GROUPS,
  VIEW_OPTION_GROUPS,
} from "./config/settings-schema.js";
import { SettingsStore } from "./core/settings-store.js";
import { RecentItems } from "./core/recent-items.js";
import { Gw2ApiClient } from "./data/gw2-api-client.js";
import { IndexedDbStore } from "./data/indexed-db-store.js";
import { GameData } from "./data/game-data.js";
import { PriceBook } from "./data/price-book.js";
import { WikiSources } from "./data/wiki-sources.js";
import { ItemSearchIndex } from "./data/item-search-index.js";
import { TreeState } from "./model/tree-state.js";
import { CraftTreeBuilder, walkTree } from "./model/craft-tree.js";
import { buildGraphModel } from "./model/graph-model.js";
import { NodeAppearance } from "./graph/node-appearance.js";
import { GraphView } from "./graph/graph-view.js";
import { composeGraphPng } from "./graph/png-exporter.js";
import { Tooltip } from "./ui/tooltip.js";
import { DetailsPanel } from "./ui/details-panel.js";
import { ShoppingListPanel } from "./ui/shopping-list-panel.js";
import { SearchBox } from "./ui/search-box.js";
import { Legend } from "./ui/legend.js";
import { OptionsPanel } from "./ui/options-panel.js";
import { Toolbar } from "./ui/toolbar.js";
import { RibbonPopout } from "./ui/ribbon-popout.js";
import { sectionResetKeys } from "./ui/ribbon-sections.js";
import { StatusBar, LoadingOverlay, SidePanel } from "./ui/app-chrome.js";
import { ToastCenter } from "./ui/toast.js";
import {
  querySelector as $,
  querySelectorAll as $$,
  isTypingTarget,
  downloadBlob,
  escapeHtml,
} from "./utils/dom.js";
import { formatNumber } from "./utils/format.js";

/**
 * Application controller. Owns the services (data, prices, settings), the view components, and the user actions
 * that tie them together. Components never talk to each other directly — they call back into the app.
 *
 * Render pipeline:  TreeState + GameData + PriceBook ─CraftTreeBuilder→ TreeNode tree ─buildGraphModel→ GraphModel
 *                   ─NodeAppearance→ Cytoscape elements ─GraphView→ canvas (+ legend / details / shopping list)
 */
export class CraftingTreeApp {
  /** @type {import('./types.js').TreeNode | null} */ tree = null;
  /** @type {import('./types.js').GraphModel} */ graph = {
    nodes: [],
    edges: [],
    nodesById: new Map(),
  };
  #priceRequestGeneration = 0;
  /** The page's own title, restored when the graph is cleared. */
  #startTitle = document.title;
  #lastErrorAt = 0;

  constructor() {
    // services
    this.settings = new SettingsStore();
    this.recentItems = new RecentItems();
    this.api = new Gw2ApiClient();
    const cache = new IndexedDbStore(CACHE_DB_NAME);
    this.gameData = new GameData({ apiClient: this.api, cache });
    this.wikiSources = new WikiSources({ cache });
    this.priceBook = new PriceBook(this.api);
    this.searchIndex = new ItemSearchIndex(this.gameData);
    this.treeState = new TreeState();
    this.treeBuilder = new CraftTreeBuilder({
      gameData: this.gameData,
      priceBook: this.priceBook,
      settings: this.settings,
      treeState: this.treeState,
    });
    this.appearance = new NodeAppearance({
      gameData: this.gameData,
      settings: this.settings,
    });

    // view components
    const context = {
      gameData: this.gameData,
      priceBook: this.priceBook,
      settings: this.settings,
      wikiSources: this.wikiSources,
    };
    const panelActions = {
      openItem: (itemId) => this.openItem(itemId),
      toggleCollapsed: (nodeId) => this.toggleCollapsed(nodeId),
      cycleRecipe: (nodeId, step) => this.cycleRecipe(nodeId, step),
      focusEntity: (kind, entityId) => this.focusEntity(kind, entityId),
      notify: (message) => this.statusBar.setMessage(message),
    };
    this.toasts = new ToastCenter($("#toasts"));
    this.statusBar = new StatusBar($("#statusText"), $("#counts"), $("#busy"));
    this.loadingOverlay = new LoadingOverlay(
      $("#overlay"),
      $("#ovText"),
      $("#ovBar"),
    );
    this.sidePanel = new SidePanel($("#sidebar"), {
      layout: $("main"),
      handle: $("#panelHandle"),
      resizer: $("#panelResizer"),
      onResize: (width, isFinal) => {
        this.graphView.resize();
        if (isFinal) this.settings.set("sidebarWidth", width);
      },
    });
    this.tooltip = new Tooltip($("#tooltip"), context);
    this.detailsPanel = new DetailsPanel(
      $("#tab-details"),
      context,
      panelActions,
    );
    this.shoppingListPanel = new ShoppingListPanel(
      $("#tab-materials"),
      context,
      panelActions,
    );
    this.legend = new Legend($("#legend"), context, {
      onSelectionChange: (nodeIds, entries) =>
        this.#onLegendSelectionChange(nodeIds, entries),
      onFocusRequest: (nodeIds) => this.graphView.focusOn(nodeIds),
    });
    const optionCallbacks = {
      onOptionChange: (key, value, redraw) =>
        this.changeSetting(key, value, redraw),
      onReset: (keys) => this.resetSettings(keys),
    };
    this.customizePanel = new OptionsPanel(
      $("#tab-view"),
      this.settings,
      {
        groups: CUSTOMIZE_GROUPS,
        initiallyOpen: ["layout", "nodes", "labels", "edges"],
      },
      optionCallbacks,
    );
    this.settingsPanel = new OptionsPanel(
      $("#settingsOptions"),
      this.settings,
      { groups: SETTINGS_GROUPS },
      optionCallbacks,
    );
    this.ribbonPopout = new RibbonPopout($("#ribbonPopout"), this.settings, {
      ...optionCallbacks,
      onOpenInCustomize: (groupId) => {
        this.openCustomizeTab();
        this.customizePanel.revealGroup(groupId);
      },
    });
    this.optionPanels = [
      this.customizePanel,
      this.settingsPanel,
      this.ribbonPopout,
    ];
    this.toolbar = new Toolbar($("#toolbar"), this.settings, {
      onSettingChange: (key, value, redraw) =>
        this.changeSetting(key, value, redraw),
      onPreset: (kind, name) => this.applyPreset(kind, name),
      onSectionReset: (sectionId) => this.resetSection(sectionId),
      onSectionToggle: (sectionId, button) =>
        this.ribbonPopout.toggle(sectionId, button),
    });
    this.searchBox = new SearchBox({
      input: $("#search"),
      resultsElement: $("#results"),
      searchIndex: this.searchIndex,
      gameData: this.gameData,
      onPick: (itemId) => this.openItem(itemId),
      getRecentItemIds: () => this.recentItems.itemIds,
    });
    this.graphView = new GraphView({
      container: $("#cy"),
      canvasWrapper: $("#cyWrap"),
      settings: this.settings,
      handlers: {
        onNodeTap: (nodeId, event) => this.#onNodeTap(nodeId, event),
        onNodeDoubleTap: (nodeId) => this.toggleCollapsed(nodeId),
        onNodeContextTap: (nodeId) => this.cycleRecipe(nodeId, 1),
        onBackgroundTap: () => this.selectNode(null),
        onNodeHoverStart: (nodeId, event) =>
          this.#onNodeHoverStart(nodeId, event),
        onNodeHoverEnd: () => {
          this.graphView.clearLineage();
          this.tooltip.hide();
        },
        onPointerMove: (event) => this.tooltip.moveTo(event),
        onViewportChange: () => this.tooltip.hide(),
      },
    });
  }

  async start() {
    this.#bindGlobalControls();
    this.optionPanels.forEach((panel) => panel.render());
    this.toolbar.sync();
    // Phones start with the graph uncovered: toolbar and panel collapsed (for this visit only; the handles open them).
    if (globalThis.matchMedia?.("(max-width: 700px)").matches)
      Object.assign(this.settings.values, {
        ribbonCollapsed: true,
        sidebarOpen: false,
      });
    this.sidePanel.setWidth(this.settings.values.sidebarWidth);
    this.sidePanel.setOpen(this.settings.values.sidebarOpen);
    this.#applyRibbonState();
    $("#cy").addEventListener("keydown", (event) => this.#onGraphKey(event));
    this.legend.update(this.graph.nodesById, 0);
    if (!(await this.#loadGameData())) return;
    this.#renderRecentItems();
    this.#openFromLocationHash();
    if (!this.treeState.hasRoot) this.searchBox.focus();
  }

  // ---------------------------------------------------------------- user actions

  openItem(itemId, { recordHistory = true, quantity } = {}) {
    const item = this.gameData.items.get(itemId);
    if (!item) {
      this.statusBar.setMessage(`Unknown item ${itemId}`);
      return;
    }
    this.treeState.openRoot(itemId, { recordHistory, quantity });
    this.recentItems.add(itemId);
    this.#syncRootControls();
    $("#rootQty").value = this.treeState.rootQuantity;
    this.searchBox.setText(item.name);
    document.title = `${item.name} — ${SITE_TITLE}`;
    this.#syncLocationHash();
    this.#render({ fit: "smart", grow: true });
    this.selectNode(this.graphView.rootNodeId);
  }

  /** Clear the graph and return to the start screen. Back (Alt+←) reopens what was cleared. */
  clearGraph() {
    if (!this.treeState.hasRoot) return;
    this.#priceRequestGeneration++; // drop price responses for the cleared tree
    this.treeState.clear();
    this.tooltip.hide();
    this.ribbonPopout.close({ restoreFocus: false });
    this.legend.clearSelection();
    this.graphView.clear();
    this.tree = null;
    this.graph = { nodes: [], edges: [], nodesById: new Map() };
    this.legend.update(this.graph.nodesById, 0);
    this.detailsPanel.render(null);
    this.shoppingListPanel.render(null);
    this.statusBar.setCounts(0, 0);
    $("#rootQty").value = this.treeState.rootQuantity;
    this.#syncRootControls();
    this.searchBox.setText("");
    document.title = this.#startTitle;
    history.replaceState(null, "", location.pathname + location.search);
    this.#renderRecentItems();
    $("#empty").hidden = false;
    this.searchBox.focus();
  }

  goBack() {
    const previous = this.treeState.popHistory();
    if (previous) {
      this.treeState.rootQuantity = previous.quantity;
      this.openItem(previous.itemId, { recordHistory: false });
    }
    this.#syncRootControls();
  }

  /** Back needs history; Clear needs a graph. */
  #syncRootControls() {
    $("#btnBack").disabled = !this.treeState.history.length;
    $("#btnClear").disabled = !this.treeState.hasRoot;
  }

  setRootQuantity(quantity) {
    this.treeState.rootQuantity = Math.max(
      1,
      Math.floor(Number(quantity) || 1),
    );
    $("#rootQty").value = this.treeState.rootQuantity;
    if (!this.treeState.hasRoot) return;
    this.#syncLocationHash();
    this.#render();
  }

  selectNode(nodeId) {
    this.treeState.selectedNodeId = nodeId;
    this.graphView.select(nodeId);
    this.detailsPanel.render(
      nodeId ? (this.graph.nodesById.get(nodeId) ?? null) : null,
    );
    if (nodeId) this.sidePanel.showTab("details");
  }

  toggleCollapsed(nodeId) {
    const node = this.graph.nodesById.get(nodeId);
    if (!node?.recipe || node.isCycle) return;
    this.treeState.toggleCollapsed(node);
    this.tooltip.hide();
    this.#render({ anchorNodeId: nodeId });
  }

  cycleRecipe(nodeId, step) {
    const node = this.graph.nodesById.get(nodeId);
    if (!node || node.alternativeRecipeCount < 2) return;
    this.treeState.cycleRecipe(node, step);
    this.tooltip.hide();
    this.#render({ anchorNodeId: nodeId });
  }

  /** Depth stepper (−/+ beside the ribbon slider). */
  stepDepth(step) {
    const depth = Math.max(
      1,
      Math.min(UNLIMITED_DEPTH, this.settings.values.maxDepth + step),
    );
    if (depth !== this.settings.values.maxDepth) this.#setDepthLimit(depth);
  }

  /** Zoom to every node showing this entity (from the side panel) and select the first. */
  focusEntity(kind, entityId) {
    const nodeIds = this.graph.nodes
      .filter(
        (node) =>
          node.kind === kind && String(node.entityId) === String(entityId),
      )
      .map((node) => node.nodeId);
    if (!nodeIds.length) return;
    this.graphView.focusOn(nodeIds, {
      padding: 80,
      includeNeighbours: true,
      durationMs: 350,
    });
    this.graphView.flash(nodeIds);
    this.selectNode(nodeIds[0]);
  }

  /**
   * Persist a setting and redraw as much as it requires.
   * @param {string} key  @param {unknown} value  @param {string} redraw  one of Redraw.*
   */
  changeSetting(key, value, redraw) {
    this.settings.set(key, value);
    if (key === "viewMode") {
      // Node ids and collapse keys differ between views.
      this.treeState.resetExpansion();
      this.treeState.selectedNodeId = null;
      this.optionPanels.forEach((panel) => panel.render()); // some options only apply to one view
    }
    if (key === "maxDepth") this.treeState.resetExpansion();
    if (key === "canvasBackground") this.graphView.syncBackground();
    this.toolbar.sync();
    for (const panel of this.optionPanels) {
      panel.syncValues();
      panel.refreshStatus();
    }

    if (this.treeState.hasRoot) {
      if (redraw === Redraw.fit) this.#render({ fit: true });
      else if (redraw === Redraw.relayout)
        this.#render({ anchorNodeId: this.#anchorNodeId() });
      else if (redraw === Redraw.restyle) this.graphView.applyStylesheet();
    }
    this.legend.update(this.graph.nodesById, this.tree?.effectiveCost || 0);
  }

  /** @param {'layout' | 'style'} kind */
  applyPreset(kind, name) {
    this.settings.applyPreset(kind, name);
    this.#afterBulkSettingsChange();
  }

  /** Restore the given settings to their defaults (Customize: per option, per section, or all). */
  resetSettings(keys) {
    this.settings.reset(keys);
    this.#afterBulkSettingsChange();
  }

  #afterBulkSettingsChange() {
    this.optionPanels.forEach((panel) => panel.render());
    this.toolbar.sync();
    this.#applyRibbonState();
    this.graphView.syncBackground();
    this.graphView.applyStylesheet();
    if (this.treeState.hasRoot) this.#render({ fit: true });
    else this.legend.update(this.graph.nodesById, 0);
  }

  /** A ribbon section's ↺: its controls and popout options back to defaults (Presets: both to Standard). */
  resetSection(sectionId) {
    if (sectionId === "presets") {
      this.settings.applyPreset("layout", "Standard");
      this.applyPreset("style", "Standard");
      return;
    }
    const keys = sectionResetKeys(sectionId, VIEW_OPTION_GROUPS);
    if (keys.includes("maxDepth") || keys.includes("viewMode"))
      this.treeState.resetExpansion();
    this.resetSettings(keys);
  }

  toggleRibbon() {
    this.ribbonPopout.close({ restoreFocus: false });
    this.settings.set("ribbonCollapsed", !this.settings.values.ribbonCollapsed);
    this.#applyRibbonState();
  }

  #applyRibbonState() {
    const isCollapsed = this.settings.values.ribbonCollapsed;
    this.toolbar.setCollapsed(isCollapsed);
    const handle = $("#ribbonHandle");
    const action = isCollapsed ? "Show the toolbar" : "Hide the toolbar";
    handle.setAttribute("aria-expanded", String(!isCollapsed));
    handle.title = `${action} (T)`;
    handle.querySelector(".sr-only").textContent = action;
  }

  toggleSidePanel() {
    this.settings.set("sidebarOpen", !this.settings.values.sidebarOpen);
    this.sidePanel.setOpen(this.settings.values.sidebarOpen);
    this.graphView.resize();
  }

  openCustomizeTab() {
    if (!this.settings.values.sidebarOpen) this.toggleSidePanel();
    this.sidePanel.showTab("view");
  }

  async exportPng() {
    if (!this.treeState.hasRoot) return;
    try {
      this.statusBar.setMessage("Rendering PNG…");
      const rootItem = this.gameData.items.get(this.treeState.rootItemId);
      const highlighted = this.legend.selectedEntries;
      const { blob, width, height } = await composeGraphPng({
        graphView: this.graphView,
        title: `${formatNumber(this.treeState.rootQuantity)} × ${rootItem?.name || "Crafting tree"}`,
        titleColor: RARITY_COLORS[rootItem?.rarity] || UI_COLORS.text,
        subtitle: highlighted.length
          ? `Highlighted: ${highlighted.map((entry) => `${entry.label} (${entry.count})`).join(", ")}`
          : `${SITE_TITLE} · ${new Date().toLocaleDateString()}`,
        legendEntries: this.settings.values.showLegend
          ? this.legend.entries
          : highlighted,
        selectedLegendKeys: this.legend.selectedKeys,
        footer: `${SITE_TITLE} · ${ARENANET_NOTICE}`,
      });
      const fileName = `${(rootItem?.name || "tree").replace(/[^\w\- ]+/g, "")}${highlighted.length ? " (highlighted)" : ""}.png`;
      downloadBlob(blob, fileName);
      this.statusBar.setMessage(`Exported ${fileName} (${width}×${height})`);
    } catch (error) {
      this.statusBar.setMessage(`PNG export failed: ${error.message}`);
    }
  }

  async refreshGameData() {
    this.priceBook.clear();
    if (
      (await this.#loadGameData({ forceRefresh: true })) &&
      this.treeState.hasRoot
    )
      this.#render();
  }

  /** Last-resort handler for uncaught errors: log, and tell the user (at most once every few seconds). */
  reportError(error) {
    console.error(error);
    const now = Date.now();
    if (now - this.#lastErrorAt < 5000) return;
    this.#lastErrorAt = now;
    this.toasts.show(`Something went wrong: ${error?.message ?? error}`, {
      tone: "error",
      durationMs: 8000,
    });
  }

  /** A new release took over (service worker update). */
  offerReload() {
    this.toasts.show("A new version is available.", {
      durationMs: 0,
      action: { label: "Reload", onClick: () => location.reload() },
    });
  }

  /** The Settings dialog (behaviour, data, shortcuts); `section` scrolls to e.g. the shortcuts list. */
  openSettings(section = null) {
    const dialog = $("#settingsDialog");
    this.settingsPanel.render();
    this.#renderDataSummary();
    if (!dialog.open) dialog.showModal();
    if (section) $(`#${section}`)?.scrollIntoView({ block: "start" });
  }

  async refreshPrices() {
    this.priceBook.clear();
    if (this.treeState.hasRoot) await this.#loadPricesForTree();
    this.#renderDataSummary();
  }

  /** Ask first (inline toast, not a blocking dialog), then delete the IndexedDB cache. */
  clearCache() {
    this.toasts.show(
      "Delete the cached game data? It is downloaded again next time the app starts.",
      {
        durationMs: 10000,
        action: {
          label: "Delete",
          onClick: async () => {
            try {
              await this.gameData.cache.clear();
              this.toasts.show("Cached game data cleared.", {
                tone: "success",
                durationMs: 4000,
              });
            } catch (error) {
              this.toasts.show(`Could not clear the cache: ${error.message}`, {
                tone: "error",
              });
            }
            this.#renderDataSummary();
          },
        },
      },
    );
  }

  async #renderDataSummary() {
    const summary = this.gameData.summary;
    const element = $("#dataSummary");
    if (!summary) {
      element.innerHTML = "<dt>Status</dt><dd>Not loaded</dd>";
      return;
    }
    let storage = "";
    try {
      const { usage } = (await navigator.storage?.estimate?.()) ?? {};
      if (usage) storage = `${(usage / 1048576).toFixed(1)} MB`;
    } catch {
      /* unsupported */
    }
    const rows = [
      [
        "Recipes",
        `${formatNumber(summary.apiRecipeCount)} API · ${formatNumber(summary.forgeRecipeCount)} Mystic Forge${summary.customRecipeCount ? ` · ${summary.customRecipeCount} custom` : ""}`,
      ],
      ["Items", formatNumber(summary.itemCount)],
      ["Game build", summary.buildId ?? "unknown"],
      ["Downloaded", new Date(summary.cachedAt).toLocaleString()],
      [
        "Prices",
        this.priceBook.lastUpdatedAt
          ? `${formatNumber(this.priceBook.size)} items · ${new Date(this.priceBook.lastUpdatedAt).toLocaleTimeString()}`
          : "none yet",
      ],
      ...(storage ? [["Storage used", storage]] : []),
    ];
    element.innerHTML = rows
      .map(
        ([label, value]) =>
          `<dt>${label}</dt><dd>${escapeHtml(String(value))}</dd>`,
      )
      .join("");
  }

  /** Recently opened items on the start screen. */
  #renderRecentItems() {
    const element = $("#recent");
    const items = this.recentItems.itemIds
      .map((id) => this.gameData.items.get(id))
      .filter(Boolean);
    element.hidden = !items.length;
    element.innerHTML = items.length
      ? `<span class="muted">Recent:</span> ${items
          .map(
            (item) =>
              `<button type="button" class="recent-item" data-item-id="${item.id}" style="--rarity:${RARITY_COLORS[item.rarity] || UI_COLORS.text}">${
                item.icon
                  ? `<img src="${escapeHtml(item.icon)}" alt="" loading="lazy">`
                  : ""
              }${escapeHtml(item.name)}</button>`,
          )
          .join("")}`
      : "";
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Rebuild tree → graph → elements and hand them to the GraphView, then refresh the side panels.
   * @param {{ fit?: boolean | 'smart', anchorNodeId?: string | null, grow?: boolean }} [options]
   */
  #render({ fit = false, anchorNodeId = null, grow = false } = {}) {
    if (!this.treeState.hasRoot) return;
    $("#empty").hidden = true;

    this.tree = this.treeBuilder.build();
    this.graph = buildGraphModel(this.tree, {
      settings: this.settings.values,
      gameData: this.gameData,
    });
    const rootCost = this.tree.effectiveCost || 0;
    const colorsByNodeId = new Map();
    const nodeElements = this.graph.nodes.map((node) => {
      const data = this.appearance.nodeData(node, rootCost);
      colorsByNodeId.set(node.nodeId, data.color);
      return { group: "nodes", data, classes: this.appearance.classes(node) };
    });
    const edgeElements = this.graph.edges.map((edge) =>
      this.appearance.edgeElement(edge, this.graph.nodesById, colorsByNodeId),
    );

    this.graphView.render({
      nodeElements,
      edgeElements,
      nodesById: this.graph.nodesById,
      fit,
      anchorNodeId,
      grow,
    });
    this.statusBar.setCounts(this.graph.nodes.length, this.graph.edges.length);
    this.#refreshPanels();
    this.#loadPricesForTree();
  }

  /** Costs changed but structure didn't: update labels/colours/classes in place, no re-layout. */
  #refreshInPlace() {
    if (!this.tree) return;
    this.treeBuilder.computeCosts(this.tree);
    this.graph = buildGraphModel(this.tree, {
      settings: this.settings.values,
      gameData: this.gameData,
    });
    const rootCost = this.tree.effectiveCost || 0;
    const colorsByNodeId = new Map();
    const nodeUpdates = this.graph.nodes.map((node) => {
      const data = this.appearance.nodeData(node, rootCost);
      colorsByNodeId.set(node.nodeId, data.color);
      return { id: node.nodeId, data, classes: this.appearance.classes(node) };
    });
    const edgeUpdates = this.graph.edges.map((edge) => ({
      id: edge.edgeId,
      data: {
        sourceColor: colorsByNodeId.get(edge.sourceId),
        targetColor: colorsByNodeId.get(edge.targetId),
      },
    }));
    this.graphView.updateInPlace(nodeUpdates, edgeUpdates);
    this.#refreshPanels();
  }

  #refreshPanels() {
    const { selectedNodeId } = this.treeState;
    if (!this.graphView.hasNode(selectedNodeId))
      this.treeState.selectedNodeId = null;
    this.graphView.select(this.treeState.selectedNodeId);
    this.legend.update(this.graph.nodesById, this.tree?.effectiveCost || 0);
    this.detailsPanel.render(
      this.graph.nodesById.get(this.treeState.selectedNodeId) ?? null,
    );
    this.shoppingListPanel.render(this.tree);
  }

  /** Fetch trading-post prices for everything in the tree; update in place when they arrive. */
  async #loadPricesForTree() {
    if (this.settings.values.priceBasis === "off" || !this.tree) return;
    const { pathMode } = this.settings.values;
    // Path planning weighs every recipe option, including branches not drawn yet, so it needs their prices too.
    const itemIds =
      pathMode === "standard"
        ? new Set()
        : this.treeBuilder.collectReachableItemIds(this.treeState.rootItemId);
    walkTree(this.tree, (node) => {
      if (node.kind === EntityKind.item) itemIds.add(node.entityId);
    });
    const generation = ++this.#priceRequestGeneration;
    const busyTimer = setTimeout(() => this.statusBar.setBusy(true), 250); // only show for slow fetches
    let receivedNewPrices;
    try {
      receivedNewPrices = await this.priceBook.ensure(itemIds);
    } finally {
      clearTimeout(busyTimer);
      if (generation === this.#priceRequestGeneration)
        this.statusBar.setBusy(false);
    }
    if (!receivedNewPrices || generation !== this.#priceRequestGeneration)
      return;
    // Cost ordering and cost labels change node positions/sizes → re-layout; otherwise update in place.
    // A planned path is re-planned with the new prices, which can change what is bought vs crafted.
    const { ingredientOrder, showCostInLabel } = this.settings.values;
    if (
      ingredientOrder === "cost" ||
      showCostInLabel ||
      pathMode !== "standard"
    )
      this.#render({ anchorNodeId: this.#anchorNodeId() });
    else this.#refreshInPlace();
  }

  #anchorNodeId() {
    return this.treeState.selectedNodeId || this.graphView.rootNodeId;
  }

  #setDepthLimit(depth) {
    this.treeState.resetExpansion();
    this.settings.set("maxDepth", depth);
    this.toolbar.sync();
    this.#render({ fit: true });
  }

  // ---------------------------------------------------------------- event handlers

  #onNodeTap(nodeId, event) {
    const node = this.graph.nodesById.get(nodeId);
    if (!node) return;
    if (event?.shiftKey && node.kind === EntityKind.item) {
      this.openItem(node.entityId);
      return;
    }
    this.selectNode(nodeId);
    this.graphView.pulse(nodeId);
  }

  #onNodeHoverStart(nodeId, event) {
    this.graphView.showLineage(nodeId);
    const node = this.graph.nodesById.get(nodeId);
    if (node && this.settings.values.showTooltips)
      this.tooltip.show(node, event);
  }

  /**
   * Keyboard access to the graph (focus it with Tab): ↑ product, ↓ first ingredient, ← / → siblings, Enter expand /
   * collapse, Home root. The selection follows, the view keeps it on screen, and a live region announces it.
   */
  #onGraphKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { nodes, edges, nodesById } = this.graph;
    if (!nodes.length) return;
    const current =
      nodesById.get(this.treeState.selectedNodeId) ??
      nodes.find((n) => n.isRoot);
    const parentOf = (id) =>
      edges.find((edge) => edge.targetId === id)?.sourceId;
    const childrenOf = (id) =>
      edges.filter((edge) => edge.sourceId === id).map((edge) => edge.targetId);
    let targetId;
    switch (event.key) {
      case "ArrowUp":
        targetId = parentOf(current.nodeId);
        break;
      case "ArrowDown":
        targetId = childrenOf(current.nodeId)[0];
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        const siblings = childrenOf(parentOf(current.nodeId));
        const index = siblings.indexOf(current.nodeId);
        targetId = siblings[index + (event.key === "ArrowRight" ? 1 : -1)];
        break;
      }
      case "Home":
        targetId = nodes.find((n) => n.isRoot)?.nodeId;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        this.toggleCollapsed(current.nodeId);
        this.#announceNode(nodesById.get(current.nodeId) ?? current);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!targetId) return;
    this.selectNode(targetId);
    this.graphView.revealNode(targetId);
    this.#announceNode(nodesById.get(targetId));
  }

  /** Screen-reader summary of a node: name, quantity, state, and where it sits. */
  #announceNode(node) {
    if (!node) return;
    const entity = this.gameData.getEntity(node.kind, node.entityId);
    const ingredientCount = this.graph.edges.filter(
      (e) => e.sourceId === node.nodeId,
    ).length;
    const parts = [
      `${formatNumber(node.quantity)} × ${entity.name}`,
      node.isRoot ? "root" : null,
      node.hasChildren
        ? `${ingredientCount} ingredient${ingredientCount === 1 ? "" : "s"}`
        : null,
      node.isCollapsed ? "collapsed" : null,
      node.isPlannedPurchase ? "bought" : null,
      !node.recipe ? "raw material" : null,
    ].filter(Boolean);
    $("#graphAnnouncer").textContent = parts.join(", ");
  }

  #onLegendSelectionChange(nodeIds, selectedEntries) {
    this.graphView.setHighlightedNodes(nodeIds);
    if (selectedEntries.length) {
      this.statusBar.setMessage(
        `${nodeIds.size} node${nodeIds.size === 1 ? "" : "s"} highlighted: ${selectedEntries.map((e) => e.label).join(", ")}`,
      );
    }
  }

  /** Buttons anywhere in the chrome declare `data-command="<name>"`. */
  #runCommand(command, button) {
    switch (command) {
      case "customize":
        button.closest("dialog")?.close();
        this.openCustomizeTab();
        break;
      case "export-png":
        this.exportPng();
        break;
      case "refresh-data":
        button.closest("dialog")?.close();
        this.refreshGameData();
        break;
      case "refresh-prices":
        this.refreshPrices();
        break;
      case "clear-cache":
        this.clearCache();
        break;
      case "settings":
        this.openSettings();
        break;
      case "shortcuts":
        this.openSettings("shortcutsSection");
        break;
      case "close-dialog":
        button.closest("dialog")?.close();
        break;
      case "back":
        this.goBack();
        break;
      case "clear-graph":
        this.clearGraph();
        break;
      case "toggle-sidebar":
        this.toggleSidePanel();
        break;
      case "toggle-ribbon":
        this.toggleRibbon();
        break;
      case "zoom-in":
        this.graphView.zoomBy(1.3);
        break;
      case "zoom-out":
        this.graphView.zoomBy(1 / 1.3);
        break;
      case "fit":
        this.graphView.fit();
        break;
      case "center-root":
        this.graphView.centerOnRoot();
        break;
      case "retry-load":
        this.#retryInitialLoad();
        break;
    }
  }

  #bindGlobalControls() {
    $("#rootQty").addEventListener("change", (event) =>
      this.setRootQuantity(event.target.value),
    );
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-command]");
      if (button && !button.disabled)
        this.#runCommand(button.dataset.command, button);
      const recent = event.target.closest("#recent [data-item-id]");
      if (recent) this.openItem(Number(recent.dataset.itemId));
    });
    for (const link of $$("#empty a[data-query]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const [firstMatch] = this.searchIndex.search(link.dataset.query);
        if (firstMatch != null) this.openItem(firstMatch);
      });
    }
    document.addEventListener("keydown", (event) =>
      this.#handleShortcut(event),
    );
    window.addEventListener("hashchange", () => this.#openFromLocationHash());
    window.addEventListener("offline", () =>
      this.toasts.show(
        "You are offline. Cached game data still works; prices will not update.",
        { durationMs: 8000 },
      ),
    );
    window.addEventListener("online", () =>
      this.toasts.show("Back online.", { tone: "success", durationMs: 3000 }),
    );
  }

  #handleShortcut(event) {
    if (
      isTypingTarget(event.target) ||
      document.querySelector("dialog[open]") ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const shortcuts = {
      "/": () => this.searchBox.focus(),
      ",": () => this.openSettings(),
      "?": () => this.openSettings("shortcutsSection"),
      t: () => this.toggleRibbon(),
      p: () => this.toggleSidePanel(),
      x: () => this.clearGraph(),
      "[": () => this.stepDepth(-1),
      "]": () => this.stepDepth(1),
      f: () => this.graphView.fit(),
      r: () => this.graphView.centerOnRoot(),
      "+": () => this.graphView.zoomBy(1.3),
      "=": () => this.graphView.zoomBy(1.3),
      "-": () => this.graphView.zoomBy(1 / 1.3),
      Escape: () => {
        if (this.ribbonPopout.isOpen) this.ribbonPopout.close();
        else if (!this.legend.clearSelection()) this.selectNode(null);
      },
    };
    if (event.key === "ArrowLeft" && event.altKey) {
      this.goBack();
      return;
    }
    const handler =
      shortcuts[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!handler) return;
    if (event.key === "/" || event.key === "?") event.preventDefault();
    handler();
  }

  // ---------------------------------------------------------------- loading & URL

  /** @returns {Promise<boolean>} whether game data is ready */
  async #loadGameData({ forceRefresh = false } = {}) {
    this.loadingOverlay.show();
    this.loadingOverlay.setRetryVisible(false);
    try {
      const summary = await this.gameData.load({
        forceRefresh,
        onProgress: (message, fraction) =>
          this.loadingOverlay.setProgress(message, fraction),
        onUpdateAvailable: () =>
          this.toasts.show(
            "Updated game data is available (new game build). Load it now?",
            {
              durationMs: 0,
              action: {
                label: "Update",
                onClick: () => this.refreshGameData(),
              },
            },
          ),
      });
      this.searchIndex.rebuild();
      this.loadingOverlay.hide();
      this.statusBar.setMessage(
        [
          `${formatNumber(summary.apiRecipeCount)} recipes + ${formatNumber(summary.forgeRecipeCount)} Mystic Forge${summary.customRecipeCount ? ` + ${summary.customRecipeCount} custom` : ""}`,
          `${formatNumber(summary.itemCount)} items`,
          `build ${summary.buildId ?? "?"}`,
          `cached ${new Date(summary.cachedAt).toLocaleString()}`,
        ].join(" · "),
      );
      return true;
    } catch (error) {
      console.error(error);
      const hint = navigator.onLine
        ? "The GW2 API may be down or rate-limiting. Try again in a minute."
        : "You appear to be offline.";
      this.loadingOverlay.setProgress(
        `Could not load game data (${error.message}). ${hint}`,
        0,
      );
      this.loadingOverlay.setRetryVisible(true);
      return false;
    }
  }

  async #retryInitialLoad() {
    if (!(await this.#loadGameData())) return;
    this.#openFromLocationHash();
    if (!this.treeState.hasRoot) this.searchBox.focus();
  }

  #syncLocationHash() {
    const hash = this.treeState.toHash();
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  #openFromLocationHash() {
    const target = TreeState.parseHash(location.hash);
    if (!target) {
      this.clearGraph(); // the hash was removed (e.g. browser Back to the bare URL)
      return;
    }
    if (
      target.itemId !== this.treeState.rootItemId ||
      target.quantity !== this.treeState.rootQuantity
    ) {
      this.openItem(target.itemId, { quantity: target.quantity });
    }
  }
}
