import {
  COST_HEAT_COLORS,
  COST_LOW_LEGEND_COLOR,
  DEPTH_COLORS,
  DISCIPLINE_COLORS,
  EDGE_SOURCE_STYLES,
  ENTITY_KIND_COLORS,
  EntityKind,
  FORGE_BADGE_URI,
  FORGE_COLOR,
  RARITY_COLORS,
  SOURCE_COLORS,
  SOURCE_LABELS,
  UI_COLORS,
} from "../config/constants.js";
import {
  isForgeResult,
  getSourceCategory,
  getDisciplineKey,
} from "./graph-model.js";

/**
 * The legend's entries and which graph nodes each one matches. Pure: the Legend component (ui/Legend.svelte) and its
 * state (ui/legend-state.svelte.js) draw and select; this decides.
 *
 * @typedef {object} LegendEntry
 * @property {string} key  "<category>:<value>", e.g. "rarity:Exotic", "flag:mf"
 * @property {string} label
 * @property {string} color
 * @property {'double' | 'dashed'} [border]
 * @property {string} [image]
 * @property {boolean} [line]  drawn as a line (an edge colour) rather than a node swatch
 * @property {number} count  How many drawn nodes match.
 *
 * @typedef {{ gameData: { getEntity(kind: string, id: number): { rarity?: string } }, rootCost: number }} MatchContext
 */

/**
 * The entries for this colour mode and graph, each with its match count.
 * @param {object} s  settings values (nodeColorMode, edgeColorMode, forgeIndicator, showBuyCheaperHint, priceBasis)
 * @param {Iterable<import('../types.js').GraphNode>} nodes
 * @param {MatchContext} context
 * @returns {LegendEntry[]}
 */
export function buildLegendEntries(s, nodes, context) {
  nodes = [...nodes];
  const entries = [];
  const add = (key, label, color, extra = {}) =>
    entries.push({ key, label, color, count: 0, ...extra });

  switch (s.nodeColorMode) {
    case "source":
      for (const [category, color] of Object.entries(SOURCE_COLORS))
        add(`source:${category}`, SOURCE_LABELS[category], color);
      break;
    case "discipline": {
      const used = new Set(nodes.map(getDisciplineKey));
      for (const [discipline, color] of Object.entries(DISCIPLINE_COLORS))
        if (used.has(discipline))
          add(
            `disc:${discipline}`,
            discipline === "none" ? "Not crafted" : discipline,
            color,
          );
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
  // Edges coloured by where the ingredient comes from get their own key. It matches the ingredient nodes, so a
  // click highlights them; it's left out when the nodes already use these categories (colour mode "source").
  if (s.edgeColorMode === "source" && s.nodeColorMode !== "source")
    for (const [category, { label, color }] of Object.entries(
      EDGE_SOURCE_STYLES,
    ))
      add(`source:${category}`, `${label} edges`, color, { line: true });
  if (s.forgeIndicator !== "off")
    add("flag:mf", "Forge craft", FORGE_COLOR, { image: FORGE_BADGE_URI });
  add("flag:collapsed", "Collapsed", UI_COLORS.accentLight, {
    border: "double",
  });
  if (s.showBuyCheaperHint && s.priceBasis !== "off")
    add("flag:cheaper", "Buy cheaper", UI_COLORS.good, { border: "dashed" });
  if (nodes.some((node) => node.isOwnedEnough))
    add("flag:owned", "Owned", UI_COLORS.owned);

  for (const entry of entries)
    entry.count = nodes.reduce(
      (count, node) =>
        count + (legendMatches(entry.key, node, context) ? 1 : 0),
      0,
    );
  return entries;
}

/**
 * Does a graph node belong to the legend entry `key`? Mirrors the colour logic in NodeAppearance.
 * @param {string} key  @param {import('../types.js').GraphNode} node  @param {MatchContext} context
 */
export function legendMatches(key, node, { gameData, rootCost }) {
  const separator = key.indexOf(":");
  const category = key.slice(0, separator),
    value = key.slice(separator + 1);
  switch (category) {
    case "rarity":
      return (
        node.kind === EntityKind.item &&
        gameData.getEntity(node.kind, node.entityId).rarity === value
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
        rootCost && node.effectiveCost ? node.effectiveCost / rootCost : 0;
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

/**
 * Node ids matching any of the selected keys (a union).
 * @param {Iterable<string>} keys  @param {Iterable<import('../types.js').GraphNode>} nodes  @param {MatchContext} context
 * @returns {Set<string>}
 */
export function matchingNodeIds(keys, nodes, context) {
  keys = [...keys];
  const ids = new Set();
  if (!keys.length) return ids;
  for (const node of nodes)
    if (keys.some((key) => legendMatches(key, node, context)))
      ids.add(node.nodeId);
  return ids;
}
