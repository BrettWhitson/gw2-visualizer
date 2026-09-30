import { FORGE_COLOR, LAYOUT_BASE, UI_COLORS } from "../config/constants.js";
import {
  isDirectionalLayout,
  isHorizontalDirection,
  treeDirection,
  usesComputedCurves,
} from "../graph/layout-geometry.js";

/**
 * The WebGL renderer's look: an element's classes + the settings → the plain values the engine draws. This is the
 * renderer's own visual language, not a copy of the Cytoscape stylesheet: state an item is in (owned, a better buy,
 * a Mystic Forge result, collapsed) reads as an aura, a ring, a badge or a card stack; interaction states (hover,
 * selection, lineage, highlights) aren't here at all: the engine animates those itself. Pure: no DOM.
 *
 * Classes come from NodeAppearance (root, hiddenKids, cycle, cheaper, owned, mf) and from pages (setClassStyles).
 */

/** "auto" puts labels where the layout leaves room: beside horizontal trees, below everything else. */
export function resolveLabelPosition(s) {
  if (s.labelPosition !== "auto") return s.labelPosition;
  if (!isDirectionalLayout(s)) return "below";
  const growth = treeDirection(s.direction);
  return growth === "LR" ? "right" : growth === "RL" ? "left" : "below";
}

/**
 * Edge routing: "straight", "taxi" (right angles), "round-taxi", "s-curve" (bends along the flow) or "arc".
 * Orthogonal routing needs a direction, so radial and force layouts get arcs.
 */
export function resolveRouting(s) {
  if (s.edgeRouting === "straight") return "straight";
  if (usesComputedCurves(s))
    return isDirectionalLayout(s) && s.edgeRouting === "bezier"
      ? "s-curve"
      : "arc";
  return s.edgeRouting === "round-taxi" ? "round-taxi" : "taxi";
}

/** The axis a directional layout spreads its levels along. */
export function resolveFlowAxis(s) {
  return isHorizontalDirection(s.direction) ? "x" : "y";
}

/**
 * @param {Set<string>} classes
 * @param {{ color?: string, label?: string }} data
 * @param {object} s  settings values
 * @param {{ nodes?: Record<string, NodeRule> }} [extra]  page rules per class, applied last
 * @typedef {{ pattern?: string, border?: string, borderWidth?: number, fillAlpha?: number, aura?: string }} NodeRule
 */
export function resolveNodeStyle(classes, data, s, extra = {}) {
  const color = data.color ?? UI_COLORS.muted;
  const style = {
    shape: s.nodeShape,
    fill: s.tintNodeFill ? color : UI_COLORS.nodeFill,
    fillAlpha: s.tintNodeFill ? 0.3 : 1,
    border: color,
    borderWidth: s.nodeBorderWidth,
    /** solid | dashed | dotted | stack (a card peeking out behind: there's more inside) */
    pattern: "solid",
    iconAlpha: s.showIcons ? 1 : 0,
    /** A soft glow around the node for a standing state (owned, a better buy), or null. */
    aura: null,
    /** A thin ring just outside the border, or null. */
    ring: null,
    badge: false,
    label: s.showLabels ? (data.label ?? "") : "",
    fontSize: LAYOUT_BASE.fontSize * s.labelFontScale,
    bold: false,
    /** Labels that stay when zoomed out and win label collisions. */
    labelPriority: 0,
  };
  const has = (name) => classes.has(name);
  if (has("root")) {
    style.borderWidth += 1.5;
    style.fontSize *= 1.2;
    style.bold = true;
    style.labelPriority = 3;
  }
  if (has("hiddenKids")) style.pattern = "stack";
  if (has("cycle")) {
    style.border = UI_COLORS.danger;
    style.pattern = "dotted";
  }
  if (has("cheaper") && s.showBuyCheaperHint) {
    style.pattern = "dashed";
    style.aura = UI_COLORS.good;
  }
  if (has("owned")) style.aura = UI_COLORS.owned;
  if (has("mf")) {
    const indicator = s.forgeIndicator;
    if (indicator === "outline" || indicator === "both")
      style.ring = FORGE_COLOR;
    if (indicator === "badge" || indicator === "both") style.badge = true;
  }
  for (const [name, rule] of Object.entries(extra.nodes ?? {}))
    if (has(name)) {
      if (rule.pattern) style.pattern = rule.pattern;
      if (rule.border) style.border = rule.border;
      if (rule.borderWidth != null) style.borderWidth = rule.borderWidth;
      if (rule.fillAlpha != null) style.fillAlpha = rule.fillAlpha;
      if (rule.aura) style.aura = rule.aura;
      if (rule.labelPriority != null) style.labelPriority = rule.labelPriority;
    }
  return style;
}

/**
 * @param {Set<string>} classes
 * @param {{ label?: string, sourceColor?: string, targetColor?: string }} data
 * @param {object} s  settings values
 * @param {{ edges?: Record<string, EdgeRule> }} [extra]
 * @typedef {{ color?: string, width?: number, glow?: boolean }} EdgeRule
 * Edges run product → ingredient on the crafting page, so "source" is the product end.
 */
export function resolveEdgeStyle(classes, data, s, extra = {}) {
  const pick = (mode) =>
    mode === "child"
      ? (data.targetColor ?? s.edgeColor)
      : mode === "parent"
        ? (data.sourceColor ?? s.edgeColor)
        : s.edgeColor;
  const arrow = s.showArrows ? s.arrowShape : null;
  const style = {
    color: pick(s.edgeColorMode),
    width: s.edgeWidth,
    alpha: s.edgeOpacity,
    /** null | "dashed" | "dotted" */
    pattern:
      s.edgeLineStyle === "dashed" || s.edgeLineStyle === "dotted"
        ? s.edgeLineStyle
        : null,
    arrowAtSource: s.arrowEnd !== "ingredient" ? arrow : null,
    arrowAtTarget: s.arrowEnd !== "product" ? arrow : null,
    arrowScale: s.arrowScale,
    label:
      s.edgeQuantityLabels === "on" ||
      (s.edgeQuantityLabels === "auto" &&
        s.showQuantities &&
        s.viewMode === "merged")
        ? (data.label ?? "")
        : "",
    fontSize: LAYOUT_BASE.fontSize * s.labelFontScale - 1,
    /** A soft glow under the line (standing emphasis such as a best route). */
    glow: false,
  };
  if (classes.has("mf") && s.highlightForgeEdges) {
    style.color = FORGE_COLOR;
    style.pattern = "dashed";
  }
  for (const [name, rule] of Object.entries(extra.edges ?? {}))
    if (classes.has(name)) {
      if (rule.color != null) style.color = rule.color;
      if (rule.width != null) style.width = rule.width;
      if (rule.glow != null) style.glow = rule.glow;
    }
  return style;
}
