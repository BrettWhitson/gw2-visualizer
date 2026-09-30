import {
  COST_HEAT_COLORS,
  COST_LOW_LEGEND_COLOR,
  DEPTH_COLORS,
  DISCIPLINE_COLORS,
  ENTITY_KIND_COLORS,
  EntityKind,
  FORGE_BADGE_URI,
  FORGE_COLOR,
  RARITY_COLORS,
  SOURCE_COLORS,
  SOURCE_LABELS,
  UI_COLORS,
} from "../config/constants.js";
import { escapeHtml } from "../utils/dom.js";
import {
  isForgeResult,
  getSourceCategory,
  getDisciplineKey,
} from "../model/graph-model.js";

/**
 * @typedef {object} LegendEntry
 * @property {string} key  "<category>:<value>", e.g. "rarity:Exotic", "flag:mf"
 * @property {string} label
 * @property {string} color
 * @property {'double' | 'dashed'} [border]
 * @property {string} [image]
 * @property {number} count  How many drawn nodes match.
 */

/**
 * The legend doubles as a filter: entries follow the colour mode, show match counts, and can be clicked to
 * highlight matching nodes (several entries combine as a union).
 */
export class Legend {
  /** @type {LegendEntry[]} */ entries = [];
  /** @type {Set<string>} */ selectedKeys = new Set();
  #nodesById = new Map();
  #rootCost = 0;
  /** Collapsed to a single toggle button; starts collapsed on phone-sized screens. */
  #isCollapsed = globalThis.matchMedia?.("(max-width: 700px)").matches ?? false;

  /**
   * @param {HTMLElement} element
   * @param {{ gameData: import('../data/game-data.js').GameData, settings: import('../core/settings-store.js').SettingsStore }} context
   * @param {{ onSelectionChange(matchingNodeIds: Set<string>, entries: LegendEntry[]): void, onFocusRequest(matchingNodeIds: Set<string>): void }} callbacks
   */
  constructor(element, context, callbacks) {
    this.element = element;
    this.context = context;
    this.callbacks = callbacks;
    element.addEventListener("click", (event) => {
      if (event.target.closest(".lg-toggle")) {
        this.#isCollapsed = !this.#isCollapsed;
        this.#renderButtons();
        return;
      }
      const button = event.target.closest(".lg");
      if (!button) return;
      if (button.dataset.clear != null) this.clearSelection();
      else
        this.toggle(button.dataset.key, {
          exclusive: event.ctrlKey || event.metaKey,
        });
    });
    element.addEventListener("dblclick", (event) => {
      const button = event.target.closest(".lg[data-key]");
      if (!button) return;
      this.selectedKeys.add(button.dataset.key);
      this.#emitSelection();
      this.callbacks.onFocusRequest(this.getMatchingNodeIds());
    });
  }

  /**
   * Rebuild entries for the current graph (after every render / data refresh) and re-apply the selection.
   * @param {Map<string, import('../types.js').GraphNode>} nodesById
   * @param {number} rootCost
   */
  update(nodesById, rootCost) {
    this.#nodesById = nodesById;
    this.#rootCost = rootCost;
    const showLegend = this.context.settings.values.showLegend;
    this.entries = this.#buildEntries();
    const validKeys = new Set(this.entries.map((entry) => entry.key));
    for (const key of [...this.selectedKeys])
      if (!validKeys.has(key) || !showLegend) this.selectedKeys.delete(key);

    const nodes = [...nodesById.values()];
    for (const entry of this.entries)
      entry.count = nodes.reduce(
        (count, node) => count + (this.#matches(entry.key, node) ? 1 : 0),
        0,
      );

    this.element.hidden = !showLegend;
    if (showLegend) this.#renderButtons();
    this.#emitSelection();
  }

  /** @param {string} key  @param {{ exclusive?: boolean }} [options] exclusive = select only this entry */
  toggle(key, { exclusive = false } = {}) {
    if (exclusive) {
      this.selectedKeys.clear();
      this.selectedKeys.add(key);
    } else if (this.selectedKeys.has(key)) this.selectedKeys.delete(key);
    else this.selectedKeys.add(key);
    this.#renderButtons();
    this.#emitSelection();
  }

  /** @returns {boolean} whether anything was selected */
  clearSelection() {
    if (!this.selectedKeys.size) return false;
    this.selectedKeys.clear();
    this.#renderButtons();
    this.#emitSelection();
    return true;
  }

  /** @returns {Set<string>} node ids matching any selected entry */
  getMatchingNodeIds() {
    const ids = new Set();
    if (!this.selectedKeys.size) return ids;
    const keys = [...this.selectedKeys];
    for (const node of this.#nodesById.values())
      if (keys.some((key) => this.#matches(key, node))) ids.add(node.nodeId);
    return ids;
  }

  get selectedEntries() {
    return this.entries.filter((entry) => this.selectedKeys.has(entry.key));
  }

  #emitSelection() {
    this.callbacks.onSelectionChange(
      this.getMatchingNodeIds(),
      this.selectedEntries,
    );
  }

  #renderButtons() {
    if (!this.context.settings.values.showLegend) return;
    const buttons = this.entries.map((entry) => {
      const classes = [
        "lg",
        this.selectedKeys.has(entry.key) && "on",
        !entry.count && "zero",
      ]
        .filter(Boolean)
        .join(" ");
      const swatch = entry.image
        ? `<img class="mfb" src="${entry.image}">`
        : `<i style="border-color:${entry.color}${entry.border ? `;border-style:${entry.border}` : ""}"></i>`;
      return `<button type="button" class="${classes}" data-key="${escapeHtml(entry.key)}" aria-pressed="${this.selectedKeys.has(entry.key)}" title="Click to highlight · double-click to zoom to them">${swatch}${escapeHtml(entry.label)}<small>${entry.count}</small></button>`;
    });
    if (this.selectedKeys.size)
      buttons.push(
        '<button type="button" class="lg clear" data-clear title="Clear highlight (Esc)">✕ clear</button>',
      );
    const selectedCount = this.selectedKeys.size
      ? ` (${this.selectedKeys.size} on)`
      : "";
    const toggle =
      `<button type="button" class="lg-toggle" aria-expanded="${!this.#isCollapsed}" title="${this.#isCollapsed ? "Show" : "Hide"} legend">` +
      `Legend${selectedCount} ${this.#isCollapsed ? "▸" : "▾"}</button>`;
    this.element.classList.toggle("collapsed", this.#isCollapsed);
    this.element.innerHTML =
      toggle + (this.#isCollapsed ? "" : buttons.join(""));
  }

  /** @returns {LegendEntry[]} */
  #buildEntries() {
    const s = this.context.settings.values;
    const entries = [];
    const add = (key, label, color, extra = {}) =>
      entries.push({ key, label, color, count: 0, ...extra });

    switch (s.nodeColorMode) {
      case "source":
        for (const [category, color] of Object.entries(SOURCE_COLORS))
          add(`source:${category}`, SOURCE_LABELS[category], color);
        break;
      case "discipline": {
        const used = new Set(
          [...this.#nodesById.values()].map(getDisciplineKey),
        );
        for (const [discipline, color] of Object.entries(DISCIPLINE_COLORS)) {
          if (used.has(discipline))
            add(
              `disc:${discipline}`,
              discipline === "none" ? "Not crafted" : discipline,
              color,
            );
        }
        break;
      }
      case "depth":
        DEPTH_COLORS.forEach((color, depth) =>
          add(`depth:${depth}`, depth === 0 ? "Root" : `Tier ${depth}`, color),
        );
        break;
      case "cost":
        add("cost:hi", "≥10% of cost", COST_HEAT_COLORS[2]);
        add("cost:mid", "1–10% of cost", COST_HEAT_COLORS[1]);
        add("cost:lo", "<1% of cost", COST_LOW_LEGEND_COLOR);
        break;
      default:
        for (const [rarity, color] of Object.entries(RARITY_COLORS))
          add(`rarity:${rarity}`, rarity, color);
        add(
          `kind:${EntityKind.currency}`,
          "Currency",
          ENTITY_KIND_COLORS[EntityKind.currency],
        );
    }
    if (s.forgeIndicator !== "off")
      add("flag:mf", "Forge craft", FORGE_COLOR, { image: FORGE_BADGE_URI });
    add("flag:collapsed", "Collapsed", UI_COLORS.accentLight, {
      border: "double",
    });
    if (s.showBuyCheaperHint && s.priceBasis !== "off")
      add("flag:cheaper", "Buy cheaper", UI_COLORS.good, { border: "dashed" });
    if ([...this.#nodesById.values()].some((node) => node.isOwnedEnough))
      add("flag:owned", "Owned", UI_COLORS.owned);
    return entries;
  }

  /** Does a graph node belong to the legend entry `key`? Mirrors the colour logic in NodeAppearance. */
  #matches(key, node) {
    const separator = key.indexOf(":");
    const category = key.slice(0, separator),
      value = key.slice(separator + 1);
    switch (category) {
      case "rarity":
        return (
          node.kind === EntityKind.item &&
          this.context.gameData.getEntity(node.kind, node.entityId).rarity ===
            value
        );
      case "kind":
        return node.kind === value;
      case "source":
        return getSourceCategory(node) === value;
      case "disc":
        return getDisciplineKey(node) === value;
      case "depth":
        return node.depth % DEPTH_COLORS.length === Number(value);
      case "cost": {
        const share =
          this.#rootCost && node.effectiveCost
            ? node.effectiveCost / this.#rootCost
            : 0;
        return value === "hi"
          ? share >= 0.1
          : value === "mid"
            ? share >= 0.01 && share < 0.1
            : share < 0.01;
      }
      case "flag":
        if (value === "mf") return isForgeResult(node);
        if (value === "collapsed") return node.isCollapsed;
        if (value === "cheaper") return node.isBuyCheaper;
        if (value === "owned") return node.isOwnedEnough;
        return false;
      default:
        return false;
    }
  }
}
