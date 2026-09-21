import {
  EntityKind,
  RecipeSource,
  RARITY_ORDER,
  DISCIPLINE_COLORS,
} from "../config/constants.js";
import { getCollapseKey } from "./craft-tree.js";

/**
 * Projects the crafting tree onto the graph that's drawn:
 *  - tree view: one graph node per tree node (ids are tree paths)
 *  - merged view: one graph node per entity, quantities/costs summed, edges aggregated
 * Applies the user's filters and ingredient ordering on the way.
 *
 * @param {import('../types.js').TreeNode} root
 * @param {{ settings: typeof import('../config/settings-schema.js').DEFAULT_SETTINGS, gameData: import('../data/game-data.js').GameData }} options
 * @returns {import('../types.js').GraphModel}
 */
export function buildGraphModel(root, { settings, gameData }) {
  const isMerged = settings.viewMode === "merged";
  const nodeIdOf = (treeNode) =>
    isMerged ? `${treeNode.kind}:${treeNode.entityId}` : treeNode.path;
  const nodesById = new Map(),
    edgesById = new Map();

  const visit = (treeNode) => {
    if (isFilteredOut(treeNode, settings)) return;
    addOccurrence(treeNode);
    for (const child of orderChildren(
      treeNode,
      settings.ingredientOrder,
      gameData,
    ))
      visit(child);
  };

  const addOccurrence = (treeNode) => {
    const nodeId = nodeIdOf(treeNode);
    let node = nodesById.get(nodeId);
    if (!node) {
      node = {
        nodeId,
        kind: treeNode.kind,
        entityId: treeNode.entityId,
        quantity: 0,
        craftCount: 0,
        effectiveCost: 0,
        buyCost: 0,
        craftCost: 0,
        isCostComplete: true,
        depth: treeNode.depth,
        recipe: treeNode.recipe,
        recipeIndex: treeNode.recipeIndex,
        alternativeRecipeCount: treeNode.alternativeRecipeCount,
        isCollapsed: treeNode.isCollapsed,
        isCycle: treeNode.isCycle,
        hasChildren: treeNode.children.length > 0,
        isBuyCheaper: treeNode.isBuyCheaper,
        isPlannedPurchase: treeNode.isPlannedPurchase,
        collapseKey: getCollapseKey(treeNode, settings.viewMode),
        occurrenceCount: 0,
        isRoot: treeNode.depth === 0,
      };
      nodesById.set(nodeId, node);
    }
    node.occurrenceCount++;
    node.quantity += treeNode.quantity;
    node.craftCount += treeNode.craftCount;
    if (treeNode.effectiveCost == null || treeNode.isCraftCostPartial)
      node.isCostComplete = false;
    if (treeNode.effectiveCost != null)
      node.effectiveCost += treeNode.effectiveCost;
    node.buyCost = sumOrNull(node.buyCost, treeNode.buyCost);
    node.craftCost = sumOrNull(node.craftCost, treeNode.craftCost);
    node.depth = Math.min(node.depth, treeNode.depth);
    node.isCollapsed ||= treeNode.isCollapsed;
    node.hasChildren ||= treeNode.children.length > 0;
    node.isBuyCheaper ||= treeNode.isBuyCheaper;

    if (treeNode.parent) {
      const sourceId = nodeIdOf(treeNode.parent);
      const edgeId = `${sourceId}->${nodeId}`;
      const edge = edgesById.get(edgeId) ?? {
        edgeId,
        sourceId,
        targetId: nodeId,
        quantity: 0,
      };
      edge.quantity += treeNode.quantity;
      edgesById.set(edgeId, edge);
    }
  };

  visit(root);
  return {
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
    nodesById,
  };
}

const sumOrNull = (a, b) => (a == null || b == null ? null : a + b);

function isFilteredOut(treeNode, settings) {
  if (treeNode.depth === 0) return false;
  return (
    (settings.hideCurrencies && treeNode.kind === EntityKind.currency) ||
    (settings.hideGenericIngredients && treeNode.kind === EntityKind.named) ||
    (settings.hideRawMaterials &&
      treeNode.kind === EntityKind.item &&
      !treeNode.recipe)
  );
}

function orderChildren(treeNode, order, gameData) {
  if (order === "recipe" || treeNode.children.length < 2)
    return treeNode.children;
  const subtreeSize = (n) =>
    (n.subtreeSize ??=
      1 + n.children.reduce((sum, c) => sum + subtreeSize(c), 0));
  const sortKey = {
    qty: (n) => -n.quantity,
    cost: (n) => -(n.effectiveCost ?? -1),
    complexity: (n) => -subtreeSize(n),
    rarity: (n) =>
      -RARITY_ORDER.indexOf(gameData.getEntity(n.kind, n.entityId).rarity),
    name: (n) => gameData.getEntity(n.kind, n.entityId).name.toLowerCase(),
  }[order];
  if (!sortKey) return treeNode.children;
  return [...treeNode.children].sort((a, b) => {
    const ka = sortKey(a),
      kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// ---------------------------------------------------------------- node classification (tree + graph nodes)

/**
 * True only for items this tree actually makes in the Mystic Forge. Materials that merely *have* a forge
 * promotion recipe (T6 mats, lodestones…) and sit collapsed as inputs count as raw materials.
 */
export function isForgeResult(node) {
  return (
    node.recipe?.source === RecipeSource.mysticForge &&
    !node.isCycle &&
    !(node.isCollapsed && node.recipe.isPromotion)
  );
}

/** Category for "Craft source" colouring and the legend. @returns {keyof typeof import('../config/constants.js').SOURCE_COLORS} */
export function getSourceCategory(node) {
  if (node.isRoot) return "root";
  if (node.kind === EntityKind.currency) return "currency";
  if (node.kind === EntityKind.named) return "generic";
  if (
    !node.recipe ||
    node.isCycle ||
    (node.isCollapsed && node.recipe.isPromotion)
  )
    return "raw";
  return isForgeResult(node) ? "mf" : "craft";
}

/** Primary discipline, or 'none' when uncrafted / unknown. */
export function getDisciplineKey(node) {
  const discipline = node.recipe?.disciplines[0];
  return discipline && DISCIPLINE_COLORS[discipline] ? discipline : "none";
}
