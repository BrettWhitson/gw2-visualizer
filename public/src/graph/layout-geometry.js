/** Small geometry predicates shared by the stylesheet, layouts and viewport logic. */

/** Directional trees (as opposed to the radial layout). */
export function isDirectionalLayout(settings) {
  return settings.direction !== "radial";
}

/**
 * The Direction setting describes the crafting flow, raw materials → finished item ("LR" = raw on the left, result
 * on the right). Layouts grow the other way, from the root (the result) out to its ingredients, so they use the
 * opposite: the tree direction.
 */
const TREE_DIRECTION = { TB: "BT", BT: "TB", LR: "RL", RL: "LR" };
export function treeDirection(flowDirection) {
  return TREE_DIRECTION[flowDirection] ?? flowDirection;
}

export function isHorizontalDirection(direction) {
  return direction === "LR" || direction === "RL";
}

/**
 * Cytoscape's own 'bezier' only bends *parallel* edges, so curved mode (and orthogonal routing on
 * non-directional layouts) use per-edge control points instead.
 */
export function usesComputedCurves(settings) {
  const isOrthogonal =
    settings.edgeRouting === "taxi" || settings.edgeRouting === "round-taxi";
  return (
    settings.edgeRouting === "bezier" ||
    (isOrthogonal && !isDirectionalLayout(settings))
  );
}
