import { LAYOUT_BASE } from "../config/constants.js";
import {
  isDirectionalLayout,
  isHorizontalDirection,
  treeDirection,
} from "../graph/layout-geometry.js";
import { layeredLayout } from "./layered.js";
import { ForceSimulation, simulateForces } from "./physics.js";
import { radialTreeLayout, tidyTreeLayout } from "./trees.js";

/** The force settings' defaults: the seed layouts scale label room and gaps relative to these. */
const FORCE_REFERENCE = { repel: 8 };

/**
 * Tether, the app's layout and physics engine (src/layout/). Its entry point: position every node for the current
 * layout settings, synchronously (the renderer animates).
 *
 * Two layouts, each in two stages:
 *  - directional tree: a tidy tree (tree view) or our layered layout (merged view, where items have several
 *    parents), then the physics with a pull toward each node's level;
 *  - radial: a radial tree (the result in the centre, one ring per depth), then the physics with a pull toward each
 *    node's ring.
 * The physics (physics.js) uses the four force sliders and the tuning (tuning.js). For the Floating physics mode the
 * result is left exactly at rest (no final polish), so waking it only moves what's disturbed.
 * Positions end up in graph.x / graph.y. Returns the simulation (kept for Floating drags, Shake and Scatter).
 * @param {import('./layout-graph.js').LayoutGraph} graph
 * @param {typeof import('../config/settings-schema.js').DEFAULT_SETTINGS} s
 * @param {{ hasPreviousPositions?: boolean, tuning?: object, settle?: boolean }} [context]
 *   settle: false returns the seed layout with its simulation not yet run (to animate it live)
 */
export function runLayout(graph, s, { tuning, settle = true } = {}) {
  const physics = {
    center: s.centerForce,
    repel: s.repelForce,
    link: s.linkForce,
    distance: s.linkDistance,
    tuning,
    // Floating graphs start truly at rest (see ForceSimulation.equilibrate), with no final polish to unbalance them.
    polish: s.physicsMode !== "floating",
    equilibrate: s.physicsMode === "floating",
    softCollisions: s.physicsMode === "floating",
  };
  // Seeds space siblings in proportion to repel; collision boxes reserve that share of each label's width
  // (low repel packs tighter and lets labels overlap).
  const labelShare = Math.min(1, s.repelForce / FORCE_REFERENCE.repel);
  const siblingGap = s.repelForce * 3;
  const levelGap = Math.max(0, s.linkDistance - LAYOUT_BASE.nodeSize);
  const sizeOf = (i) => graph.footprint(i, labelShare, 1);
  const finish = (options) =>
    settle
      ? simulateForces(graph, options)
      : new ForceSimulation(graph, options);

  if (!isDirectionalLayout(s)) {
    const tree = radialTreeLayout(graph, {
      siblingGap,
      ringStep: s.linkDistance,
    });
    if (!tree) return null;
    return finish({
      mode: "radial",
      ...physics,
      depthById: tree.depthById,
      rootId: tree.rootId,
      sizeOf,
    });
  }

  // Directional tree: seed with the tidy tree (tree view) or the layered layout (merged view is a DAG).
  const horizontal = isHorizontalDirection(s.direction);
  const growth = treeDirection(s.direction); // root → ingredients
  const seeded =
    s.viewMode === "tree" &&
    tidyTreeLayout(graph, {
      direction: growth,
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
      widthLabelShare,
      heightLabelShare,
    });
  }
  return finish({
    mode: "layered",
    axis: horizontal ? "x" : "y",
    ...physics,
    sizeOf,
  });
}
