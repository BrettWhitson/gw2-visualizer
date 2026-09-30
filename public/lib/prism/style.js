import {
  isDirectionalLayout,
  isHorizontalDirection,
  treeDirection,
} from "../tether/directions.js";
import { STYLE_BASE } from "./options.js";

/**
 * Prism's look: an element's classes + data + the options + the theme → the plain values the renderer draws. States
 * read as an aura, a ring, a badge or a card stack; interaction states (hover, selection, lineage, highlights) aren't
 * here at all: the renderer animates those itself. Pure: no DOM.
 *
 * Two classes are built in: "root" (bigger, bold, its label wins) and "collapsed" (a card stack: there's more
 * inside). Every other class means whatever the caller's rules say (GraphView.setClassStyles).
 */

/** Default colours. Pass a partial theme to GraphView to change any of them. */
export const DEFAULT_THEME = {
  /** A node's colour (border, tint) when its data has none. */
  node: "#8a93a6",
  nodeFill: "#1a2030",
  edge: "#3b4558",
  ancestors: "#d6a74a",
  descendants: "#62a4da",
  /** setHighlightedNodes() glow. */
  highlight: "#ffd166",
  /** flash() glow. */
  focus: "#62a4da",
};

/**
 * @typedef {{ pattern?: "solid" | "dashed" | "dotted" | "stack", border?: string, borderWidth?: number,
 *             fillAlpha?: number, aura?: string, ring?: string, badge?: boolean, labelPriority?: number,
 *             events?: boolean }} NodeRule
 * @typedef {{ color?: string, width?: number, glow?: boolean, pattern?: "dashed" | "dotted" | null }} EdgeRule
 * @typedef {{ nodes?: Record<string, NodeRule>, edges?: Record<string, EdgeRule> }} ClassRules
 */

/** "auto" puts labels where the layout leaves room: beside horizontal trees, below everything else. */
export function resolveLabelPosition(o) {
  if (o.labelPosition !== "auto") return o.labelPosition;
  if (!isDirectionalLayout(o)) return "below";
  const growth = treeDirection(o.direction);
  return growth === "LR" ? "right" : growth === "RL" ? "left" : "below";
}

/**
 * The renderer's routing: "straight", "taxi", "round-taxi", "s-curve" (bends along the flow) or "arc".
 * Right angles need a direction, so the radial layout gets arcs instead.
 */
export function resolveRouting(o) {
  if (o.edgeRouting === "straight") return "straight";
  const radial = !isDirectionalLayout(o);
  if (o.edgeRouting === "curved") return radial ? "arc" : "s-curve";
  if (radial) return "arc";
  return o.edgeRouting === "round-taxi" ? "round-taxi" : "taxi";
}

/** The axis a directional layout spreads its levels along. */
export function resolveFlowAxis(o) {
  return isHorizontalDirection(o.direction) ? "x" : "y";
}

/**
 * @param {Set<string>} classes
 * @param {{ color?: string, label?: string }} data
 * @param {typeof import('./options.js').DEFAULT_OPTIONS} o
 * @param {typeof DEFAULT_THEME} theme
 * @param {ClassRules} [rules]  per class, applied last in their own order
 */
export function resolveNodeStyle(classes, data, o, theme, rules = {}) {
  const color = data.color ?? theme.node;
  const style = {
    /** Width and height, before any scaling for hover or drag. */
    size: STYLE_BASE.nodeSize * o.nodeSizeScale,
    shape: o.nodeShape,
    fill: o.tintNodeFill ? color : theme.nodeFill,
    fillAlpha: o.tintNodeFill ? 0.3 : 1,
    border: color,
    borderWidth: o.nodeBorderWidth,
    /** solid | dashed | dotted | stack (a card peeking out behind: there's more inside) */
    pattern: "solid",
    iconAlpha: o.showIcons ? 1 : 0,
    /** A soft glow around the node for a standing state, or null. */
    aura: null,
    /** A thin ring just outside the border, or null. */
    ring: null,
    /** The renderer's badge image in the corner (its badgeUrl). */
    badge: false,
    label: o.showLabels ? (data.label ?? "") : "",
    fontSize: STYLE_BASE.fontSize * o.labelFontScale,
    bold: false,
    /** Labels that stay when zoomed out and win label collisions. */
    labelPriority: 0,
    /** false: the pointer passes through the node (no hover, tap or drag); it's still drawn and labelled. */
    events: true,
  };
  if (classes.has("root")) {
    style.size *= o.rootSizeScale;
    style.borderWidth += 1.5;
    style.fontSize *= 1.2;
    style.bold = true;
    style.labelPriority = 3;
  }
  if (classes.has("collapsed")) style.pattern = "stack";
  for (const [name, rule] of Object.entries(rules.nodes ?? {}))
    if (classes.has(name)) {
      if (rule.pattern) style.pattern = rule.pattern;
      if (rule.border) style.border = rule.border;
      if (rule.borderWidth != null) style.borderWidth = rule.borderWidth;
      if (rule.fillAlpha != null) style.fillAlpha = rule.fillAlpha;
      if (rule.aura) style.aura = rule.aura;
      if (rule.ring) style.ring = rule.ring;
      if (rule.badge != null) style.badge = rule.badge;
      if (rule.labelPriority != null) style.labelPriority = rule.labelPriority;
      if (rule.events != null) style.events = rule.events;
    }
  return style;
}

/**
 * @param {Set<string>} classes
 * @param {{ label?: string, sourceColor?: string, targetColor?: string }} data
 * @param {typeof import('./options.js').DEFAULT_OPTIONS} o
 * @param {typeof DEFAULT_THEME} theme
 * @param {ClassRules} [rules]
 */
export function resolveEdgeStyle(classes, data, o, theme, rules = {}) {
  const color =
    o.edgeColorMode === "target"
      ? (data.targetColor ?? theme.edge)
      : o.edgeColorMode === "source"
        ? (data.sourceColor ?? theme.edge)
        : theme.edge;
  const arrow = o.showArrows ? o.arrowShape : null;
  const style = {
    color,
    width: o.edgeWidth,
    alpha: o.edgeOpacity,
    /** null | "dashed" | "dotted" */
    pattern:
      o.edgeLineStyle === "dashed" || o.edgeLineStyle === "dotted"
        ? o.edgeLineStyle
        : null,
    arrowAtSource: o.arrowEnd !== "target" ? arrow : null,
    arrowAtTarget: o.arrowEnd !== "source" ? arrow : null,
    arrowScale: o.arrowScale,
    label: o.edgeLabels ? (data.label ?? "") : "",
    fontSize: STYLE_BASE.fontSize * o.labelFontScale - 1,
    /** A soft glow under the line (standing emphasis). */
    glow: false,
  };
  for (const [name, rule] of Object.entries(rules.edges ?? {}))
    if (classes.has(name)) {
      if (rule.color != null) style.color = rule.color;
      if (rule.width != null) style.width = rule.width;
      if (rule.glow != null) style.glow = rule.glow;
      if (rule.pattern !== undefined) style.pattern = rule.pattern;
    }
  return style;
}
