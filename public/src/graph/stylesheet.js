import { LAYOUT_BASE, FORGE_COLOR, UI_COLORS } from "../config/constants.js";
import {
  isDirectionalLayout,
  treeDirection,
  usesComputedCurves,
} from "./layout-geometry.js";

/** Label anchor per position: [text-valign, text-halign, margin-x, margin-y]. */
const LABEL_ANCHORS = {
  below: ["bottom", "center", 0, 4],
  above: ["top", "center", 0, -4],
  right: ["center", "right", 6, 0],
  left: ["center", "left", -6, 0],
  center: ["center", "center", 0, 0],
};
/** Edges run product → ingredient, i.e. along the tree direction. */
const TAXI_DIRECTIONS = {
  TB: "downward",
  BT: "upward",
  LR: "rightward",
  RL: "leftward",
};

/**
 * Cytoscape stylesheet for the current settings. Element state comes from classes set by NodeAppearance
 * (root, hiddenKids, cycle, cheaper, mf) and by GraphView (faded, path, pathdown, lg-hl, lg-dim, hl, ghost, label-focus).
 * @param {typeof import('../config/settings-schema.js').DEFAULT_SETTINGS} s
 * @param {{ labelOpacity?: number }} [view]  label opacity for the current zoom (see GraphView label fading)
 */
export function buildStylesheet(s, { labelOpacity = 1 } = {}) {
  const nodeSize = LAYOUT_BASE.nodeSize * s.nodeSizeScale;
  const fontSize = LAYOUT_BASE.fontSize * s.labelFontScale;
  const backdropOpacity = s.labelBackdrop ? 0.8 : 0;
  // Faded-out labels: skip text rendering entirely (a huge min font size) instead of drawing invisible text.
  const labelVisibility =
    labelOpacity === 0
      ? { "min-zoomed-font-size": 1000 }
      : {
          "text-opacity": labelOpacity,
          "text-outline-opacity": labelOpacity,
          "min-zoomed-font-size": s.labelFadeZoom ? 3 : 0,
        };
  const directional = isDirectionalLayout(s);

  let labelPosition = s.labelPosition;
  if (labelPosition === "auto")
    labelPosition =
      directional && treeDirection(s.direction) === "LR"
        ? "right"
        : directional && treeDirection(s.direction) === "RL"
          ? "left"
          : "below";
  const [textValign, textHalign, textMarginX, textMarginY] =
    LABEL_ANCHORS[labelPosition];

  const curveStyle = usesComputedCurves(s) ? "unbundled-bezier" : s.edgeRouting;
  const showEdgeLabels =
    s.edgeQuantityLabels === "on" ||
    (s.edgeQuantityLabels === "auto" &&
      s.showQuantities &&
      s.viewMode === "merged");
  const edgeColor =
    s.edgeColorMode === "child"
      ? "data(targetColor)"
      : s.edgeColorMode === "parent"
        ? "data(sourceColor)"
        : s.edgeColor;
  const fadeDuration = `${s.animationsEnabled ? Math.round(s.animationDuration / 3) : 0}ms`;
  const showForgeRing =
    s.forgeIndicator === "outline" || s.forgeIndicator === "both";
  const showForgeBadge =
    s.forgeIndicator === "badge" || s.forgeIndicator === "both";
  // Edges run product → ingredient, so the "source" end is the product.
  const arrowShape = s.showArrows ? s.arrowShape : "none";
  const arrowAtProduct = s.arrowEnd !== "ingredient" ? arrowShape : "none";
  const arrowAtIngredient = s.arrowEnd !== "product" ? arrowShape : "none";
  const arrowColors = (color) => ({
    "source-arrow-color": color,
    "target-arrow-color": color,
  });
  const lineStyle =
    s.edgeLineStyle === "solid"
      ? { "line-style": "solid" }
      : {
          "line-style": s.edgeLineStyle,
          "line-dash-pattern": s.edgeLineStyle === "dotted" ? [1.5, 4] : [8, 5],
          "line-cap": s.edgeLineStyle === "dotted" ? "round" : "butt",
        };
  const flowDashes = s.animateFlow
    ? { "line-style": "dashed", "line-dash-pattern": [9, 5] }
    : {};
  const underlayShape = {
    "underlay-shape": s.nodeShape === "ellipse" ? "ellipse" : "round-rectangle",
  };

  return [
    {
      selector: "node",
      style: {
        shape: s.nodeShape,
        width: nodeSize,
        height: nodeSize,
        "background-color": s.tintNodeFill ? "data(color)" : UI_COLORS.nodeFill,
        "background-opacity": s.tintNodeFill ? 0.3 : 1,
        "border-width": s.nodeBorderWidth,
        "border-color": "data(color)",
        "background-fit": "cover",
        "background-clip": "node",
        "background-image-crossorigin": "anonymous",
        "background-width": "100%",
        "background-height": "100%",
        "background-image-opacity": s.showIcons ? 1 : 0,
        label: s.showLabels ? "data(label)" : "",
        color: UI_COLORS.text,
        "font-size": fontSize,
        "text-wrap": s.labelOverflow,
        "text-max-width": LAYOUT_BASE.labelWidth * s.labelWrapScale,
        "text-valign": textValign,
        "text-halign": textHalign,
        "text-margin-x": textMarginX,
        "text-margin-y": textMarginY,
        "text-background-color": UI_COLORS.labelBackdrop,
        "text-background-opacity": backdropOpacity * labelOpacity,
        "text-background-padding": 2,
        "text-background-shape": "roundrectangle",
        "text-outline-color": UI_COLORS.labelBackdrop,
        "text-outline-width": s.labelBackdrop ? 0 : 2,
        ...labelVisibility,
        "transition-property": "opacity, border-color, background-color",
        "transition-duration": fadeDuration,
      },
    },
    { selector: "node[icon]", style: { "background-image": "data(icon)" } },
    {
      selector: "node.root",
      style: {
        "border-width": s.nodeBorderWidth + 2,
        width: nodeSize * s.rootSizeScale,
        height: nodeSize * s.rootSizeScale,
        "font-size": fontSize * 1.2,
        "font-weight": 700,
      },
    },
    {
      selector: "node.hiddenKids",
      style: {
        "border-style": "double",
        "border-width": Math.max(4, s.nodeBorderWidth * 2),
      },
    },
    {
      selector: "node.cycle",
      style: { "border-color": UI_COLORS.danger, "border-style": "dotted" },
    },
    {
      selector: "node.cheaper",
      style: s.showBuyCheaperHint
        ? {
            "border-style": "dashed",
            "underlay-color": UI_COLORS.good,
            "underlay-opacity": 0.35,
            "underlay-padding": 5,
            ...underlayShape,
          }
        : {},
    },

    // Mystic Forge results: glow ring and/or ✦ corner badge (second background layer from data(bgs)).
    {
      selector: "node.mf",
      style: showForgeRing
        ? {
            "outline-width": 3,
            "outline-color": FORGE_COLOR,
            "outline-offset": 3,
            "outline-opacity": 0.85,
          }
        : {},
    },
    {
      selector: "node.mf[icon]",
      style: showForgeBadge
        ? {
            "background-image": "data(bgs)",
            "background-width": ["100%", "42%"],
            "background-height": ["100%", "42%"],
            "background-position-x": ["50%", "104%"],
            "background-position-y": ["50%", "-4%"],
            "background-clip": ["node", "none"],
            "background-image-containment": ["inside", "over"],
            "background-fit": ["cover", "none"],
            "background-image-opacity": [s.showIcons ? 1 : 0, 1],
          }
        : {},
    },
    {
      selector: "node.mf[!icon]",
      style: showForgeBadge
        ? {
            "background-image": "data(bgs)",
            "background-width": "42%",
            "background-height": "42%",
            "background-position-x": "104%",
            "background-position-y": "-4%",
            "background-clip": "none",
            "background-image-containment": "over",
            "background-image-opacity": 1,
          }
        : {},
    },

    // Legend highlight. Dimming is instant so a PNG exported right after a click is never caught mid-fade.
    {
      selector: "node.lg-hl",
      style: {
        "underlay-color": UI_COLORS.highlight,
        "underlay-opacity": 0.7,
        "underlay-padding": 9,
        ...underlayShape,
        "font-weight": 700,
        "z-index": 20,
      },
    },
    {
      selector: ".lg-dim",
      style: {
        opacity: Math.max(0.08, s.dimOpacity),
        "transition-duration": "0ms",
      },
    },
    {
      selector: "node:selected",
      style: {
        "underlay-color": UI_COLORS.accentLight,
        "underlay-opacity": 0.6,
        "underlay-padding": 7,
        ...underlayShape,
      },
    },
    {
      selector: "node.hl",
      style: {
        "underlay-color": UI_COLORS.focus,
        "underlay-opacity": 0.55,
        "underlay-padding": 6,
        ...underlayShape,
      },
    },
    { selector: "node.ghost", style: { events: "no", label: "" } },
    // These nodes keep their labels however far you zoom out.
    {
      selector: "node.root, node:selected, node.lg-hl, node.label-focus",
      style: {
        "text-opacity": 1,
        "text-outline-opacity": 1,
        "text-background-opacity": backdropOpacity,
        "min-zoomed-font-size": 0,
        "z-index": 30,
      },
    },

    {
      selector: "edge",
      style: {
        width: s.edgeWidth,
        "line-color": edgeColor,
        "curve-style": curveStyle,
        "taxi-direction": directional
          ? TAXI_DIRECTIONS[treeDirection(s.direction)]
          : "auto",
        "taxi-turn": "50%",
        "taxi-turn-min-distance": 6,
        "taxi-radius": s.edgeCornerRadius,
        "control-point-distances": "data(controlPointDistances)",
        "control-point-weights": "data(controlPointWeights)",
        "edge-distances": "node-position",
        "source-arrow-shape": arrowAtProduct,
        "target-arrow-shape": arrowAtIngredient,
        ...arrowColors(edgeColor),
        "arrow-scale": s.arrowScale,
        ...lineStyle,
        opacity: s.edgeOpacity,
        label: showEdgeLabels ? "data(label)" : "",
        "font-size": fontSize - 1,
        color: UI_COLORS.muted,
        "text-background-color": UI_COLORS.canvas,
        "text-background-opacity": 0.9 * labelOpacity,
        "text-background-padding": 1,
        "text-opacity": labelOpacity,
        "min-zoomed-font-size": labelOpacity === 0 ? 1000 : 8,
        "transition-property": "opacity, line-color, width",
        "transition-duration": fadeDuration,
      },
    },
    {
      selector: "edge.mf",
      style: s.highlightForgeEdges
        ? {
            "line-color": FORGE_COLOR,
            ...arrowColors(FORGE_COLOR),
            "line-style": "dashed",
            "line-dash-pattern": [6, 3],
          }
        : {},
    },

    // Hover lineage: dim everything, then colour the path to the root (up) and the ingredients (down).
    { selector: ".faded", style: { opacity: s.dimOpacity } },
    {
      selector: "edge.path",
      style: {
        "line-color": s.lineageUpColor,
        ...arrowColors(s.lineageUpColor),
        width: s.edgeWidth + 1.2,
        "z-index": 9,
        opacity: 1,
        ...flowDashes,
      },
    },
    {
      selector: "edge.pathdown",
      style: {
        "line-color": s.lineageDownColor,
        ...arrowColors(s.lineageDownColor),
        width: s.edgeWidth + 0.6,
        "z-index": 8,
        opacity: 1,
        ...flowDashes,
      },
    },
  ];
}
