/**
 * Everything a GraphView can be told, with its defaults. Pass any subset to the constructor or to setOptions();
 * layout and physics options (direction, layered, physicsMode and the forces) take effect on the next render().
 */
export const DEFAULT_OPTIONS = {
  // ---------------------------------------------------------------- layout (Tether)
  /** Which way the graph flows, leaves → root: "TB", "BT", "LR", "RL", or "radial" (the root in the centre). */
  direction: "BT",
  /** Always use the layered layout (for graphs with shared nodes); otherwise a tidy tree when the graph is one. */
  layered: false,
  /** "elastic": the layout holds and a dragged node pulls its neighbours; "floating": the whole graph is live. */
  physicsMode: "elastic",
  linkForce: 0.5,
  centerForce: 0.2,
  repelForce: 8,
  linkDistance: 120,

  // ---------------------------------------------------------------- nodes
  nodeSizeScale: 1,
  /** The root is this much bigger than other nodes. */
  rootSizeScale: 1.35,
  /** "round-rectangle", "rectangle", "ellipse", "diamond", "hexagon"… (see render/shaders.js) */
  nodeShape: "round-rectangle",
  /** Fill nodes with a tint of their colour instead of the theme's node fill. */
  tintNodeFill: false,
  nodeBorderWidth: 3,
  showIcons: true,

  // ---------------------------------------------------------------- labels
  showLabels: true,
  labelFontScale: 1,
  /** "auto" (where the layout leaves room), "below", "above", "left" or "right". */
  labelPosition: "auto",
  labelBackdrop: true,
  /** Labels fade out below this zoom (except focused and high-priority ones). */
  labelFadeZoom: 0.35,
  labelWrapScale: 1,
  /** "wrap" or "ellipsis". */
  labelOverflow: "wrap",

  // ---------------------------------------------------------------- edges
  /** "straight", "taxi" (right angles), "round-taxi" or "curved". */
  edgeRouting: "taxi",
  edgeCornerRadius: 10,
  edgeCurvature: 1,
  edgeWidth: 1.6,
  edgeOpacity: 1,
  /** "solid", "dashed" or "dotted". */
  edgeLineStyle: "solid",
  /** "neutral" (the theme's edge colour), "source" or "target" (the colour of the node at that end). */
  edgeColorMode: "neutral",
  showArrows: true,
  /** "triangle", "vee", "circle"… (see render/edge-geometry.js) */
  arrowShape: "triangle",
  /** Which end of an edge gets the arrowhead: "target", "source" or "both". */
  arrowEnd: "target",
  arrowScale: 0.8,
  /** Draw edge labels (an edge's `label`). */
  edgeLabels: true,

  // ---------------------------------------------------------------- interaction
  /** What hovering a node lights up: "both", "ancestors", "descendants" or "none". */
  hoverMode: "both",
  /** Keep the selected node's lineage lit after the pointer leaves it. */
  pinSelectionLineage: true,
  /** Light pulses travel along lit edges, toward each edge's "target" or its "source". */
  animateFlow: true,
  flowToward: "target",
  flowSpeed: 1,
  /** How visible everything outside a lit lineage stays. */
  dimOpacity: 0.18,
  smoothZoom: true,
  zoomSpeed: 1,
  minZoom: 0.005,
  maxZoom: 4,
  /** Fitting the view never zooms in past this. */
  maxFitZoom: 1.6,
  /** "dots" or "grid" follow pan and zoom on the canvas wrapper (see GraphView.syncBackground); anything else is left alone. */
  canvasBackground: "none",

  // ---------------------------------------------------------------- motion
  animationsEnabled: true,
  animationDuration: 450,
  /** "smooth", "snappy", "bouncy"… (see render/spring.js) */
  animationEasing: "smooth",
  /** A brand-new graph grows out of its root level by level. */
  growNewGraphs: true,
};

/** Base sizes in graph units; the scale options multiply these. */
export const STYLE_BASE = {
  nodeSize: 48,
  fontSize: 11,
  labelWidth: 120,
};
