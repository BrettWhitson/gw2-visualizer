import {
  DEPTH_COLORS,
  SOURCE_COLORS,
  SOURCE_LABELS,
  UI_COLORS,
  DISCIPLINE_COLORS,
  COST_HEAT_COLORS,
  FORGE_BADGE_URI,
  EntityKind,
} from "../config/constants.js";
import {
  formatQuantity,
  formatCoinsRuns,
  formatCoinsText,
  mixColors,
} from "../utils/format.js";
import {
  isForgeResult,
  getSourceCategory,
  getDisciplineKey,
} from "../model/graph-model.js";

/**
 * Turns graph nodes/edges into element data for the graph view: colour (per colour mode), label text and state classes.
 * The stylesheet (stylesheet.js) maps these onto visuals.
 */
export class NodeAppearance {
  /**
   * @param {{ gameData: import('../data/game-data.js').GameData, settings: import('../core/settings-store.js').SettingsStore }} deps
   */
  constructor({ gameData, settings }) {
    this.gameData = gameData;
    this.settings = settings;
  }

  /** @param {import('../types.js').GraphNode} node  @param {number} rootCost total cost of the root (for the heatmap) */
  color(node, rootCost) {
    switch (this.settings.values.nodeColorMode) {
      case "depth":
        return DEPTH_COLORS[node.depth % DEPTH_COLORS.length];
      case "source":
        return SOURCE_COLORS[getSourceCategory(node)];
      case "discipline":
        return DISCIPLINE_COLORS[getDisciplineKey(node)];
      case "cost":
        return costHeatColor(node.effectiveCost, rootCost);
      default:
        return this.gameData.getEntityColor(node.kind, node.entityId);
    }
  }

  /** "250 × Mithril Ingot", plus "  ▸" when collapsed ("  ✓" when owned), what's owned, and an optional cost line. */
  label(node) {
    const { showQuantities, showCostInLabel } = this.settings.values;
    const name = this.gameData.getEntity(node.kind, node.entityId).name;
    let label =
      (showQuantities
        ? `${formatQuantity(node.kind, node.entityId, node.quantity)} × `
        : "") +
      name +
      (node.isOwnedEnough ? "  ✓" : node.isCollapsed ? "  ▸" : "");
    if (node.ownedQuantity && !node.isOwnedEnough)
      label += `
(have ${formatQuantity(node.kind, node.entityId, node.ownedQuantity)})`;
    if (showCostInLabel && node.kind === EntityKind.item && node.effectiveCost)
      label += "\n" + formatCoinsText(node.effectiveCost);
    return label;
  }

  /** Space-separated state classes consumed by the stylesheet. */
  classes(node) {
    return [
      node.isRoot && "root",
      node.isCollapsed && "hiddenKids",
      node.isCycle && "cycle",
      node.isBuyCheaper && "cheaper",
      node.isOwnedEnough && "owned",
      isForgeResult(node) && "mf",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /** The element `data` for a node. `bgs` carries the icon + forge badge as a two-layer background. */
  nodeData(node, rootCost) {
    const entity = this.gameData.getEntity(node.kind, node.entityId);
    const data = {
      id: node.nodeId,
      label: this.label(node),
      color: this.color(node, rootCost),
    };
    if (entity.icon) data.icon = entity.icon;
    if (this.settings.values.nodeLook === "card")
      Object.assign(data, this.cardData(node, entity.name));
    if (isForgeResult(node))
      data.bgs = entity.icon
        ? [entity.icon, FORGE_BADGE_URI]
        : [FORGE_BADGE_URI];
    return data;
  }

  /**
   * What an item card shows (Prismatrix's nodeLook "card"): the name as its title; quantity and where it comes from; its
   * cost in coins; and what's owned, as a tag.
   * @param {import('../types.js').GraphNode} node  @param {string} name
   */
  cardData(node, name) {
    const category = getSourceCategory(node);
    const subtitle = [
      `×${formatQuantity(node.kind, node.entityId, node.quantity)} `,
      { mark: SOURCE_COLORS[category] },
      ` ${SOURCE_LABELS[category]}`,
    ];
    if (node.isCollapsed) subtitle.push(" ▸");
    const card = { cardTitle: name, subtitle };
    if (node.kind === EntityKind.item && node.effectiveCost)
      card.value = formatCoinsRuns(node.effectiveCost, UI_COLORS);
    if (node.isOwnedEnough) card.tag = "✓ owned";
    else if (node.ownedQuantity)
      card.tag = `have ${formatQuantity(node.kind, node.entityId, node.ownedQuantity)}`;
    return card;
  }

  /**
   * @param {import('../types.js').GraphEdge} edge
   * @param {Map<string, import('../types.js').GraphNode>} nodesById
   * @param {Map<string, string>} colorsByNodeId
   */
  edgeElement(edge, nodesById, colorsByNodeId) {
    const ingredient = nodesById.get(edge.targetId),
      product = nodesById.get(edge.sourceId);
    return {
      group: "edges",
      // "src-<category>": where the ingredient comes from (the design branch's source-coloured edges).
      classes: [
        isForgeResult(product) && "mf",
        `src-${getSourceCategory(ingredient)}`,
      ]
        .filter(Boolean)
        .join(" "),
      data: {
        id: edge.edgeId,
        source: edge.sourceId,
        target: edge.targetId,
        label:
          "×" +
          formatQuantity(ingredient.kind, ingredient.entityId, edge.quantity),
        sourceColor: colorsByNodeId.get(edge.sourceId),
        targetColor: colorsByNodeId.get(edge.targetId),
        controlPointDistances: [0],
        controlPointWeights: [0.5], // filled in by updateCurvedEdges
      },
    };
  }
}

/** Log-scaled share of the root's cost, mapped onto the heat gradient. */
function costHeatColor(cost, rootCost) {
  if (!rootCost || !cost) return COST_HEAT_COLORS[0];
  const t = Math.min(1, Math.log10(1 + (99 * cost) / rootCost) / 2);
  return t < 0.5
    ? mixColors(COST_HEAT_COLORS[0], COST_HEAT_COLORS[1], t * 2)
    : mixColors(COST_HEAT_COLORS[1], COST_HEAT_COLORS[2], (t - 0.5) * 2);
}
