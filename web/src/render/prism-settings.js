import { FORGE_COLOR, UI_COLORS, ZOOM_LIMITS } from "../config/constants.js";

/**
 * The app's settings and item states in Prism's terms (the prism package, a general graphing engine that knows
 * nothing of Guild Wars 2): its options, its theme, and class rules for the states the crafting pages mark. Pure: no
 * DOM.
 */

const HOVER_MODES = {
  lineage: "both",
  subtree: "descendants",
  ancestors: "ancestors",
  none: "none",
};
// Edges run product → ingredient, so the product is an edge's source.
const ARROW_ENDS = { product: "source", ingredient: "target", both: "both" };
// "source" (where the ingredient comes from) is drawn by class rules (render/edge-sources.js) over neutral edges.
const EDGE_COLOR_MODES = { child: "target", parent: "source" };

/**
 * The layout and physics settings in Tether's terms (the tether package), for runLayout and Prism.
 * @param {object} s  settings values
 */
export function layoutSettings(s) {
  return {
    direction: s.direction,
    // Tree view seeds with a tidy tree; the merged view (shared ingredients) needs the layered layout.
    layered: s.viewMode !== "tree",
    physicsMode: s.physicsMode,
    linkForce: s.linkForce,
    centerForce: s.centerForce,
    repelForce: s.repelForce,
    linkDistance: s.linkDistance,
  };
}

/** @param {object} s  settings values */
export function prismOptions(s) {
  return {
    ...layoutSettings(s),

    nodeSizeScale: s.nodeSizeScale,
    rootSizeScale: s.rootSizeScale,
    nodeShape: s.nodeShape,
    tintNodeFill: s.tintNodeFill,
    nodeBorderWidth: s.nodeBorderWidth,
    showIcons: s.showIcons,

    showLabels: s.showLabels,
    labelFontScale: s.labelFontScale,
    labelPosition: s.labelPosition,
    labelBackdrop: s.labelBackdrop,
    labelFadeZoom: s.labelFadeZoom,
    labelWrapScale: s.labelWrapScale,
    labelOverflow: s.labelOverflow,

    edgeRouting: s.edgeRouting === "bezier" ? "curved" : s.edgeRouting,
    edgeCornerRadius: s.edgeCornerRadius,
    edgeCurvature: s.edgeCurvature ?? 1,
    edgeWidth: s.edgeWidth,
    edgeOpacity: s.edgeOpacity,
    edgeLineStyle: s.edgeLineStyle,
    edgeColorMode: EDGE_COLOR_MODES[s.edgeColorMode] ?? "neutral",
    showArrows: s.showArrows,
    arrowShape: s.arrowShape,
    arrowEnd: ARROW_ENDS[s.arrowEnd] ?? "source",
    arrowScale: s.arrowScale,
    // Edge labels are quantities: "auto" shows them where they add something, in the merged view.
    edgeLabels:
      s.edgeQuantityLabels === "on" ||
      (s.edgeQuantityLabels === "auto" &&
        s.showQuantities &&
        s.viewMode === "merged"),

    hoverMode: HOVER_MODES[s.hoverMode] ?? "both",
    pinSelectionLineage: s.pinSelectionLineage,
    // TODO(prism 0.3.0): lineageColor: "edge", so a lit lineage keeps each edge's own colour (the "Where it comes
    // from" edge colours) instead of repainting it in the lineage colours.
    animateFlow: s.animateFlow,
    // Flow runs from ingredient to product: against the edges on the crafting page, along them where a page's edges
    // run ingredient → product (flowToward: "target").
    flowToward: s.flowToward === "target" ? "target" : "source",
    flowSpeed: s.flowSpeed,
    dimOpacity: s.dimOpacity,
    smoothZoom: s.smoothZoom,
    zoomSpeed: s.zoomSpeed,
    minZoom: ZOOM_LIMITS.min,
    maxZoom: ZOOM_LIMITS.max,
    maxFitZoom: ZOOM_LIMITS.maxFitZoom,
    canvasBackground: s.canvasBackground,

    animationsEnabled: s.animationsEnabled,
    nodeLook: s.nodeLook,
    cardConnectors: s.cardConnectors,
    animationDuration: s.animationDuration,
    animationEasing: s.animationEasing,
    growNewGraphs: s.growNewTrees,
  };
}

/**
 * The theme colours the settings choose. The rest follow the design tokens (render/theme-tokens.js).
 * @param {object} s  settings values
 */
export function prismTheme(s) {
  return {
    edge: s.edgeColor,
    ancestors: s.lineageUpColor,
    descendants: s.lineageDownColor,
    highlight: UI_COLORS.highlight,
    focus: UI_COLORS.focus,
  };
}

/**
 * The item states NodeAppearance marks (cycle, cheaper, owned, mf), as Prism class rules, in the order they apply;
 * a page's own rules go after these.
 * @param {object} s  settings values
 */
export function gw2ClassRules(s) {
  const nodes = {
    cycle: { border: UI_COLORS.danger, pattern: "dotted" },
  };
  if (s.showBuyCheaperHint)
    nodes.cheaper = { pattern: "dashed", aura: UI_COLORS.good };
  nodes.owned = { aura: UI_COLORS.owned };
  const indicator = s.forgeIndicator;
  const forge = {};
  if (indicator === "outline" || indicator === "both") forge.ring = FORGE_COLOR;
  if (indicator === "badge" || indicator === "both") forge.badge = true;
  if (Object.keys(forge).length) nodes.mf = forge;
  const edges = {};
  if (s.highlightForgeEdges)
    edges.mf = { color: FORGE_COLOR, pattern: "dashed" };
  return { nodes, edges };
}

/** The app's class names for Prism: "hiddenKids" (collapsed children) is Prism's built-in "collapsed". */
export function prismClasses(classes) {
  const list = Array.isArray(classes)
    ? classes
    : String(classes ?? "")
        .split(" ")
        .filter(Boolean);
  return list.map((name) => (name === "hiddenKids" ? "collapsed" : name));
}
