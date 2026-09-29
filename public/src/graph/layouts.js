import { LAYOUT_BASE } from "../config/constants.js";
import { simulateForces } from "./force-simulation.js";
import {
  isDirectionalLayout,
  isHorizontalDirection,
  treeDirection,
  usesComputedCurves,
} from "./layout-geometry.js";

/**
 * Position every node for the current layout settings (synchronously, no animation — GraphView animates).
 *
 * Two stages:
 *  1. a deterministic seed: tidy tree (tree view), dagre (merged view) or a radial tree; the force engine starts
 *     from the previous positions (or the radial seed on a new tree);
 *  2. the force simulation (force-simulation.js) with the four force sliders, acting in every direction, plus a
 *     pull toward each node's level (layered) or ring (radial).
 * Returns the simulation, which GraphView keeps so dragging a node moves the others.
 * @param {import('cytoscape').Core} cy
 * @param {typeof import('../config/settings-schema.js').DEFAULT_SETTINGS} s
 * @param {{ hasPreviousPositions: boolean }} context
 */
export function runLayout(cy, s, { hasPreviousPositions }) {
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
  const sizeById = (id) => footprint(cy.getElementById(id), labelShare, 1);

  if (s.layoutEngine === "force") {
    if (!hasPreviousPositions)
      radialTreeLayout(cy, { siblingGap, ringStep: s.linkDistance });
    return simulateForces(cy, { mode: "free", ...forces, sizeById });
  }
  if (s.direction === "radial") {
    const tree = radialTreeLayout(cy, { siblingGap, ringStep: s.linkDistance });
    if (!tree) return null;
    return simulateForces(cy, {
      mode: "radial",
      ...forces,
      depthById: tree.depthById,
      rootId: tree.rootId,
      sizeById,
    });
  }

  // Layered: seed with the tidy tree (tree view) or dagre (merged view is a DAG), then simulate.
  const seeded =
    s.viewMode === "tree" &&
    tidyTreeLayout(cy, {
      direction: growth,
      alignment: s.treeAlignment,
      siblingGap,
      levelGap,
      breadthLabelShare: labelShare,
    });
  if (!seeded) {
    const shares = horizontal ? [1, labelShare] : [labelShare, 1];
    withFootprints(cy, ...shares, () =>
      cy
        .layout({
          name: "dagre",
          animate: false,
          fit: false,
          nodeDimensionsIncludeLabels: true,
          rankDir: growth,
          nodeSep: siblingGap,
          rankSep: levelGap,
          edgeSep: 6,
          ranker: s.dagreRanker,
          align: s.treeAlignment || undefined,
        })
        .run(),
    );
  }
  return simulateForces(cy, {
    mode: "layered",
    axis: horizontal ? "x" : "y",
    ...forces,
    sizeById,
  });
}

/** The force settings' defaults: the seed layouts scale label room and gaps relative to these. */
const FORCE_REFERENCE = { repel: 8 };

/**
 * Run `layout` while every node reports its partial-label footprint from layoutDimensions() (patched on the shared
 * collection prototype for the duration of this synchronous call only).
 */
function withFootprints(cy, widthLabelShare, heightLabelShare, layout) {
  const prototype = Object.getPrototypeOf(cy.collection());
  const measure = prototype.layoutDimensions;
  prototype.layoutDimensions = function (options) {
    return options?.nodeDimensionsIncludeLabels
      ? footprint(this, widthLabelShare, heightLabelShare, measure)
      : measure.call(this, options);
  };
  try {
    layout();
  } finally {
    prototype.layoutDimensions = measure;
  }
}

/**
 * Space a node takes up for layout: the node itself plus a share of its label's overhang on each axis.
 * @returns {{ w: number, h: number }}
 */
function footprint(
  node,
  widthLabelShare,
  heightLabelShare,
  measure = node.layoutDimensions,
) {
  const full = measure.call(node, { nodeDimensionsIncludeLabels: true });
  if (widthLabelShare === 1 && heightLabelShare === 1) return full;
  const box = measure.call(node, { nodeDimensionsIncludeLabels: false });
  return {
    w: box.w + (full.w - box.w) * widthLabelShare,
    h: box.h + (full.h - box.h) * heightLabelShare,
  };
}

/**
 * The graph as a tree rooted at `.root`: breadth-first, each node under the first parent that reaches it (merged
 * graphs are DAGs with cycles; tree view already is a tree). Returns the pre-order and a children lookup.
 */
function spanningTree(cy) {
  const root = cy.nodes(".root")[0];
  if (!root) return null;
  const childIdsByParentId = new Map();
  cy.edges().forEach((edge) => {
    const parentId = edge.data("source");
    if (!childIdsByParentId.has(parentId)) childIdsByParentId.set(parentId, []);
    childIdsByParentId.get(parentId).push(edge.data("target"));
  });
  const children = new Map(),
    depthById = new Map([[root.id(), 0]]);
  for (const queue = [root.id()]; queue.length;) {
    const id = queue.shift();
    const own = [];
    for (const childId of childIdsByParentId.get(id) ?? []) {
      if (depthById.has(childId)) continue;
      depthById.set(childId, depthById.get(id) + 1);
      own.push(childId);
      queue.push(childId);
    }
    children.set(id, own);
  }
  const preOrder = [];
  for (const stack = [root.id()]; stack.length;) {
    const id = stack.pop();
    preOrder.push(id);
    for (const childId of [...children.get(id)].reverse()) stack.push(childId);
  }
  return {
    rootId: root.id(),
    preOrder,
    depthById,
    childrenOf: (id) => children.get(id) ?? [],
  };
}

/** Post-order band widths: each subtree needs at least its own breadth + gap, or the sum of its children's bands. */
function computeBands({ preOrder, childrenOf }, breadthOf, siblingGap) {
  const bandById = new Map();
  for (let i = preOrder.length - 1; i >= 0; i--) {
    const id = preOrder[i];
    const childrenWidth = childrenOf(id).reduce(
      (sum, childId) => sum + bandById.get(childId),
      0,
    );
    bandById.set(id, Math.max(breadthOf(id) + siblingGap, childrenWidth));
  }
  return bandById;
}

/**
 * Layered tree layout in O(n): each subtree gets a band as wide as its children need, parents centre over their
 * children, and every depth gets its own rank. Replaces dagre for tree view, where crossing minimisation is
 * pointless (trees have no crossings) and costs seconds on big trees.
 * @returns {boolean} false when there's no root to lay out
 */
export function tidyTreeLayout(
  cy,
  {
    direction,
    siblingGap,
    levelGap,
    alignment,
    breadthLabelShare = 1,
    extentLabelShare = 1,
  },
) {
  const tree = spanningTree(cy);
  if (!tree) return false;
  const horizontal = isHorizontalDirection(direction);

  // Size of each node (incl. its share of the label) across the layout ("breadth") and along it ("extent").
  const sizeById = new Map();
  cy.nodes().forEach((node) => {
    const { w, h } = horizontal
      ? footprint(node, extentLabelShare, breadthLabelShare)
      : footprint(node, breadthLabelShare, extentLabelShare);
    sizeById.set(
      node.id(),
      horizontal ? { breadth: h, extent: w } : { breadth: w, extent: h },
    );
  });

  const levelExtents = [];
  for (const id of tree.preOrder) {
    const depth = tree.depthById.get(id);
    levelExtents[depth] = Math.max(
      levelExtents[depth] || 0,
      sizeById.get(id).extent,
    );
  }
  const levelCenters = [];
  levelExtents.reduce((offset, extent, level) => {
    levelCenters[level] = offset + extent / 2;
    return offset + extent + levelGap;
  }, 0);

  const bandById = computeBands(
    tree,
    (id) => sizeById.get(id).breadth,
    siblingGap,
  );

  // Pre-order: lay children left→right inside the parent's band; the parent sits over its children.
  const crossPositionById = new Map();
  for (const stack = [[tree.rootId, 0]]; stack.length;) {
    const [id, bandStart] = stack.pop();
    const children = tree.childrenOf(id);
    const childrenWidth = children.reduce(
      (sum, childId) => sum + bandById.get(childId),
      0,
    );
    let cursor = bandStart + (bandById.get(id) - childrenWidth) / 2;
    const childCenters = [];
    for (const childId of children) {
      childCenters.push(cursor + bandById.get(childId) / 2);
      stack.push([childId, cursor]);
      cursor += bandById.get(childId);
    }
    let center;
    if (!children.length) center = bandStart + bandById.get(id) / 2;
    else if (alignment.endsWith("L")) center = childCenters[0];
    else if (alignment.endsWith("R"))
      center = childCenters[childCenters.length - 1];
    else center = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    crossPositionById.set(id, center);
  }

  cy.batch(() =>
    cy.nodes().forEach((node) => {
      const across = crossPositionById.get(node.id());
      if (across == null) return;
      const along = levelCenters[tree.depthById.get(node.id())];
      node.position(
        direction === "BT"
          ? { x: across, y: -along }
          : direction === "LR"
            ? { x: along, y: across }
            : direction === "RL"
              ? { x: -along, y: across }
              : { x: across, y: along },
      );
    }),
  );
  return true;
}

/**
 * Radial seed: the root in the centre, depth n on the ring at n × ringStep, and every subtree in an angular wedge
 * proportional to the band it needs (so big branches get more of the circle). Rings are evenly spaced; the force
 * simulation then resolves crowding on busy rings by letting them bulge slightly.
 * @returns {{ rootId: string, depthById: Map<string, number> } | null}
 */
export function radialTreeLayout(cy, { siblingGap, ringStep }) {
  const tree = spanningTree(cy);
  if (!tree) return null;
  const sizeById = new Map();
  cy.nodes().forEach((node) => {
    const { w, h } = node.layoutDimensions({
      nodeDimensionsIncludeLabels: false,
    });
    sizeById.set(node.id(), Math.max(w, h));
  });
  const bandById = computeBands(tree, (id) => sizeById.get(id), siblingGap);
  const totalBand = bandById.get(tree.rootId);

  const centerById = new Map();
  for (const stack = [[tree.rootId, 0]]; stack.length;) {
    const [id, start] = stack.pop();
    const children = tree.childrenOf(id);
    const childrenWidth = children.reduce(
      (sum, childId) => sum + bandById.get(childId),
      0,
    );
    let cursor = start + (bandById.get(id) - childrenWidth) / 2;
    for (const childId of children) {
      stack.push([childId, cursor]);
      cursor += bandById.get(childId);
    }
    centerById.set(id, start + bandById.get(id) / 2);
  }

  cy.batch(() =>
    cy.nodes().forEach((node) => {
      const center = centerById.get(node.id());
      if (center == null) return;
      const radius = tree.depthById.get(node.id()) * ringStep;
      const angle = (center / totalBand) * 2 * Math.PI - Math.PI / 2;
      node.position({
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    }),
  );
  return { rootId: tree.rootId, depthById: tree.depthById };
}

/**
 * Control points for curved edges, in Cytoscape's (distance, weight) form relative to the source→target line.
 * Directional layouts get an S-curve bending along the layout direction; others a gentle arc.
 * Distances are absolute, so this must re-run whenever nodes move.
 */
export function updateCurvedEdges(cy, s, edges = cy.edges()) {
  if (!usesComputedCurves(s)) return;
  const directional = isDirectionalLayout(s);
  const vertical = s.direction === "TB" || s.direction === "BT";
  cy.batch(() =>
    edges.forEach((edge) => {
      const source = edge.source().position(),
        target = edge.target().position();
      const dx = target.x - source.x,
        dy = target.y - source.y,
        length = Math.hypot(dx, dy);
      if (length < 1) return;
      if (!directional) {
        edge.data({
          controlPointDistances: [length * 0.15 * s.edgeCurvature],
          controlPointWeights: [0.5],
        });
        return;
      }
      const mid = vertical
        ? (source.y + target.y) / 2
        : (source.x + target.x) / 2;
      const controlPoints = vertical
        ? [
            { x: source.x, y: mid },
            { x: target.x, y: mid },
          ]
        : [
            { x: mid, y: source.y },
            { x: mid, y: target.y },
          ];
      const distances = [],
        weights = [];
      for (const point of controlPoints) {
        const vx = point.x - source.x,
          vy = point.y - source.y;
        weights.push((vx * dx + vy * dy) / (length * length));
        distances.push(((vy * dx - vx * dy) / length) * s.edgeCurvature);
      }
      edge.data({
        controlPointDistances: distances,
        controlPointWeights: weights,
      });
    }),
  );
}
