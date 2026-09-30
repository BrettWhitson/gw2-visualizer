import { LAYOUT_BASE } from "../config/constants.js";
import {
  isHorizontalDirection,
  treeDirection,
} from "../graph/layout-geometry.js";
import { layeredLayout } from "./layered.js";
import { simulateForces } from "./physics.js";
import { radialTreeLayout, tidyTreeLayout } from "./trees.js";

/** The force settings' defaults: the seed layouts scale label room and gaps relative to these. */
const FORCE_REFERENCE = { repel: 8 };

/**
 * Position every node for the current layout settings, synchronously (the renderer animates).
 *
 * Two stages:
 *  1. a deterministic seed: tidy tree (tree view), our layered layout (merged view) or a radial tree; the force
 *     engine starts from the previous positions (or the radial seed on a new graph);
 *  2. the physics (physics.js) with the four force sliders, acting in every direction, plus a pull toward each
 *     node's level (layered) or ring (radial).
 * Positions end up in graph.x / graph.y. Returns the simulation, kept so dragging a node moves the others.
 * @param {import('./layout-graph.js').LayoutGraph} graph
 * @param {typeof import('../config/settings-schema.js').DEFAULT_SETTINGS} s
 * @param {{ hasPreviousPositions: boolean }} context
 */
export function runLayout(graph, s, { hasPreviousPositions }) {
  const forces = {
    center: s.centerForce,
    repel: s.repelForce,
    link: s.linkForce,
    distance: s.linkDistance,
  };
  // Seeds space siblings in proportion to repel; collision boxes reserve that share of each label's width
  // (low repel packs tighter and lets labels overlap).
  const labelShare = Math.min(1, s.repelForce / FORCE_REFERENCE.repel);
  const siblingGap = s.repelForce * 3;
  const levelGap = Math.max(0, s.linkDistance - LAYOUT_BASE.nodeSize);
  const horizontal = isHorizontalDirection(s.direction);
  const growth = treeDirection(s.direction); // root → ingredients
  const sizeOf = (i) => graph.footprint(i, labelShare, 1);

  if (s.layoutEngine === "force") {
    if (!hasPreviousPositions)
      radialTreeLayout(graph, { siblingGap, ringStep: s.linkDistance });
    return simulateForces(graph, { mode: "free", ...forces, sizeOf });
  }
  if (s.direction === "radial") {
    const tree = radialTreeLayout(graph, {
      siblingGap,
      ringStep: s.linkDistance,
    });
    if (!tree) return null;
    return simulateForces(graph, {
      mode: "radial",
      ...forces,
      depthById: tree.depthById,
      rootId: tree.rootId,
      sizeOf,
    });
  }

  // Layered: seed with the tidy tree (tree view) or the layered layout (merged view is a DAG), then simulate.
  const seeded =
    s.viewMode === "tree" &&
    tidyTreeLayout(graph, {
      direction: growth,
      alignment: s.treeAlignment,
      siblingGap,
      levelGap,
      breadthLabelShare: labelShare,
    });
  if (!seeded) {
    const [widthLabelShare, heightLabelShare] = horizontal
      ? [1, labelShare]
      : [labelShare, 1];
    layeredLayout(graph, {
      direction: growth,
      nodeSep: siblingGap,
      rankSep: levelGap,
      ranker: s.dagreRanker,
      align: s.treeAlignment,
      widthLabelShare,
      heightLabelShare,
    });
  }
  return simulateForces(graph, {
    mode: "layered",
    axis: horizontal ? "x" : "y",
    ...forces,
    sizeOf,
  });
}
