import { LayoutGraph } from "../../lib/tether/layout-graph.js";
import { runLayout as layOut } from "../../lib/tether/run-layout.js";
import { layoutSettings } from "../render/prism-settings.js";
import { isDirectionalLayout, usesComputedCurves } from "./layout-geometry.js";

/**
 * The classic (Cytoscape) renderer's side of the layouts: it hands the graph to the renderer-free layouts in
 * Tether (public/lib/tether/) and writes the positions back. Node sizes, with and without labels, come from Cytoscape's stylesheet.
 *
 * Returns the simulation wrapped for Cytoscape (syncFromGraph / apply), kept so dragging a node moves the others.
 * @param {import('cytoscape').Core} cy
 * @param {typeof import('../config/settings-schema.js').DEFAULT_SETTINGS} s
 * @param {{ hasPreviousPositions: boolean }} context
 */
export function runLayout(cy, s, context) {
  const nodes = cy.nodes();
  const graph = new LayoutGraph(
    nodes.map((node) => {
      const box = node.layoutDimensions({ nodeDimensionsIncludeLabels: false });
      const full = node.layoutDimensions({ nodeDimensionsIncludeLabels: true });
      const { x, y } = node.position();
      return {
        id: node.id(),
        w: box.w,
        h: box.h,
        fullW: full.w,
        fullH: full.h,
        x,
        y,
        root: node.hasClass("root"),
        ghost: node.hasClass("ghost"),
      };
    }),
    cy.edges().map((edge) => ({
      source: edge.data("source"),
      target: edge.data("target"),
    })),
  );
  const simulation = layOut(graph, layoutSettings(s), context);
  cy.batch(() =>
    nodes.forEach((node, i) => node.position({ x: graph.x[i], y: graph.y[i] })),
  );
  return simulation && bindToCytoscape(simulation, cy);
}

/** The simulation, plus reading positions from and writing them to Cytoscape. */
function bindToCytoscape(simulation, cy) {
  const nodes = simulation.ids.map((id) => cy.getElementById(id));
  return Object.assign(simulation, {
    /** Re-read positions from Cytoscape (nodes may have been moved by hand since the simulation ran). */
    syncFromGraph() {
      simulation.setPositions((id) => {
        const node = nodes[simulation.indexById.get(id)];
        return node && !node.removed() ? node.position() : null;
      });
    },
    /** Write positions back to Cytoscape, optionally skipping one node (the one under the pointer). */
    apply(skipId = null) {
      cy.batch(() =>
        nodes.forEach((node, i) => {
          if (simulation.ids[i] !== skipId && !node.removed())
            node.position({ x: simulation.x[i], y: simulation.y[i] });
        }),
      );
    },
  });
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
