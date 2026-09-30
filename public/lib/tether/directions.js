/** Direction helpers shared by the layouts. */

/** Node size the seed layouts measure level gaps against (link distance minus this is the gap between levels). */
export const NODE_SIZE = 48;

/** Directional trees (as opposed to the radial layout). */
export function isDirectionalLayout(settings) {
  return settings.direction !== "radial";
}

/**
 * The direction setting describes the flow, leaves → root ("LR" = leaves on the left, root on the right). Layouts
 * grow the other way, from the root out to the leaves, so they use the opposite: the tree direction.
 */
const TREE_DIRECTION = { TB: "BT", BT: "TB", LR: "RL", RL: "LR" };
export function treeDirection(flowDirection) {
  return TREE_DIRECTION[flowDirection] ?? flowDirection;
}

export function isHorizontalDirection(direction) {
  return direction === "LR" || direction === "RL";
}
