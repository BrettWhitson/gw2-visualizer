import {
  FORGE_BADGE_URI,
  FORGE_COLOR,
  UI_COLORS,
} from "../config/constants.js";

/**
 * The app's settings and item states in Prismatrix's terms (a general graph engine that knows nothing of Guild Wars
 * 2): the controller's layout, physics and animation, the model's node and edge options, the theme, and each node's
 * and edge's own style, worked out from the classes the pages give their elements. Pure: no DOM.
 */

/** A node's size at 1× (world px), and a card's. */
export const NODE_SIZE = 48;
export const CARD_SIZE = { width: 222, height: 64 };

/** The app's directions name the crafting flow (raw → result); Prismatrix's name the way a tree grows from its root. */
const TREE_DIRECTIONS = { BT: "TB", TB: "BT", LR: "RL", RL: "LR" };

const SHAPES = {
  "round-rectangle": "rounded",
  rectangle: "square",
  ellipse: "circle",
  hexagon: "hexagon",
  octagon: "hexagon",
  "round-diamond": "diamond",
};

const HOVER = {
  lineage: "both",
  subtree: "descendants",
  ancestors: "ancestors",
  none: "none",
};

const EASINGS = {
  smooth: "smooth",
  snappy: "out",
  bouncy: "back",
  linear: "linear",
};

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * Where node labels go: "auto" beside the node in a sideways tree, outward in a radial one, below otherwise.
 * Prismatrix puts labels below, to the right or outward; above, left and on the icon fall back to the nearest.
 */
function labelPlacement(s) {
  if (!s.showLabels) return "off";
  if (s.labelPosition === "right" || s.labelPosition === "left") return "right";
  if (s.labelPosition !== "auto") return "below";
  if (s.direction === "radial") return "outward";
  return s.direction === "LR" || s.direction === "RL" ? "right" : "below";
}

/**
 * The layout and physics the settings ask for: tree (or merged, for shared ingredients) in the crafting flow's
 * direction, or radial; spacing from the repel and link-distance sliders; the physics mode and its forces. A
 * page can force some of the settings (`overrides`: the craftable page's own layouts).
 * @param {object} s settings values
 */
export function layoutSettings(s) {
  const radial = s.direction === "radial";
  const layout = radial
    ? "radial"
    : s.viewMode === "merged"
      ? "merged"
      : "tree";
  const spacing = s.repelForce / 8; // 1 at the default
  // Link distance is the gap between levels; cards are taller than icons, so they get a little more.
  const levelGap = clamp(
    s.linkDistance + (s.nodeLook === "card" ? 24 : 0),
    20,
    300,
  );
  const layoutOptions =
    layout === "radial"
      ? { ringGap: clamp((s.linkDistance * 2) / 3, 20, 300) }
      : layout === "merged"
        ? {
            direction: TREE_DIRECTIONS[s.direction] ?? "TB",
            levelGap,
            nodeGap: clamp(16 * spacing, 0, 120),
          }
        : {
            direction: TREE_DIRECTIONS[s.direction] ?? "TB",
            levelGap,
            siblingGap: clamp(16 * spacing, 0, 120),
            subtreeGap: clamp(28 * spacing, 0, 200),
          };
  // Floating needs room to float in: only the radial layout offers it; the trees hold their shape elastically.
  const physics =
    s.physicsMode === "floating" && radial ? "floating" : "elastic";
  const physicsOptions =
    physics === "floating"
      ? {
          repulsion: clamp(s.repelForce * 10, 0, 400),
          links: clamp(s.linkForce * 50, 0, 200),
          memory: clamp(s.centerForce * 5, 0, 30),
        }
      : {
          anchor: clamp(20 + s.centerForce * 200, 0, 200),
          links: clamp(s.linkForce * 80, 0, 200),
        };
  return { layout, layoutOptions, physics, physicsOptions };
}

/**
 * The model's node and edge options for the settings.
 * @param {object} s settings values
 */
export function modelOptions(s) {
  const card = s.nodeLook === "card";
  const showArrows = s.showArrows || (card && s.cardConnectors !== "dots");
  return {
    node: {
      look: card ? "card" : "node",
      cardWidth: CARD_SIZE.width,
      cardHeight: CARD_SIZE.height,
      shape: SHAPES[s.nodeShape] ?? "rounded",
      size: clamp(NODE_SIZE * s.nodeSizeScale, 4, 60),
      colorBy: "single",
      strokeWidth: clamp(s.nodeBorderWidth || 2, 0, 12),
      labels: labelPlacement(s),
      labelSize: clamp(11 * s.labelFontScale, 6, 24),
      labelMaxWidth: clamp(Math.round(160 * s.labelWrapScale), 0, 400),
    },
    edge: {
      shape:
        s.edgeRouting === "bezier"
          ? "curve"
          : s.edgeRouting === "straight"
            ? "straight"
            : "step",
      corner: s.edgeRouting === "round-taxi" ? s.edgeCornerRadius : 0,
      width: clamp(s.edgeWidth, 0.25, 8),
      // Coloured by an end ("child", "parent"), each edge gets that end's colour as its own style (edgeJSON): a
      // node's fill is its dark face unless it's tinted.
      colorBy: "single",
      color: s.edgeColor,
      opacity: clamp(s.edgeOpacity, 0.05, 1),
      dash: s.edgeLineStyle,
      arrow: !showArrows
        ? "none"
        : card && s.cardConnectors === "dots"
          ? "dot"
          : s.arrowShape === "circle"
            ? "dot"
            : "arrow",
      // Edges run product → ingredient: the product is an edge's source.
      arrowAt:
        card && s.cardConnectors === "both"
          ? "both"
          : s.arrowEnd === "ingredient"
            ? "target"
            : s.arrowEnd === "both"
              ? "both"
              : "source",
      arrowSize: clamp(8 * s.arrowScale, 2, 16),
      // Edge labels are quantities: "auto" shows them where they add something, in the merged view.
      labels:
        s.edgeQuantityLabels === "on" ||
        (s.edgeQuantityLabels === "auto" &&
          s.showQuantities &&
          s.viewMode === "merged")
          ? "target"
          : "off",
    },
  };
}

/**
 * How the view moves and what a hover lights, for the settings. `flowToward` is the page's: pulses run from
 * ingredient to product, against the edges on the crafting page (product → ingredient) and along them where a
 * page's edges run ingredient → product.
 * @param {object} s settings values
 * @param {{ flowToward?: "source" | "target" }} [page]
 */
export function animationOptions(s, { flowToward = "source" } = {}) {
  const on = s.animationsEnabled;
  return {
    transition: on ? s.animationDuration : 0,
    camera: on ? s.animationDuration : 0,
    easing: EASINGS[s.animationEasing] ?? "smooth",
    enter: !on ? "none" : s.growNewTrees ? "grow" : "fade",
    hoverFade: on ? 180 : 0,
    hoverDim: clamp(1 - s.dimOpacity, 0, 1),
    hoverLineage: HOVER[s.hoverMode] ?? "both",
    selectionLineage: s.pinSelectionLineage,
    // Edges coloured by where the ingredient comes from keep that colour when lit; the others light by direction.
    lineageColor: s.edgeColorMode === "source" ? "off" : "direction",
    flow: s.animateFlow ? flowToward : "off",
    flowSpeed: s.flowSpeed,
  };
}

/**
 * The theme: the page's design tokens (render/theme-tokens.js, `tokens`) and the colours the settings choose.
 * @param {object} s settings values
 * @param {Record<string, string>} tokens
 */
export function themeOptions(s, tokens) {
  return {
    base: "dark",
    ...tokens,
    edge: s.edgeColor,
    ancestors: s.lineageUpColor,
    descendants: s.lineageDownColor,
    highlight: UI_COLORS.highlight,
    focus: UI_COLORS.focus,
  };
}

/**
 * The item states NodeAppearance marks, as node and edge style patches by class, in the order they apply (a page's
 * own go after these): cycle, cheaper, owned, Mystic Forge (mf), and "hiddenKids" (children folded away).
 * @param {object} s settings values
 * @returns {{ nodes: Record<string, object>, edges: Record<string, object> }}
 */
export function gw2ClassStyles(s) {
  const nodes = {
    hiddenKids: { stack: true },
    cycle: { stroke: UI_COLORS.danger, strokeStyle: "dotted" },
  };
  if (s.showBuyCheaperHint)
    nodes.cheaper = { strokeStyle: "dashed", aura: UI_COLORS.good };
  nodes.owned = { aura: UI_COLORS.owned };
  const indicator = s.forgeIndicator;
  const forge = {};
  if (indicator === "outline" || indicator === "both") forge.ring = FORGE_COLOR;
  if (indicator === "badge" || indicator === "both")
    forge.badgeIcon = FORGE_BADGE_URI;
  if (Object.keys(forge).length) nodes.mf = forge;
  const edges = {};
  if (s.highlightForgeEdges) edges.mf = { color: FORGE_COLOR, dash: "dashed" };
  return { nodes, edges };
}

/** A page element's classes as a list ("a b" or ["a", "b"]). */
export function classList(classes) {
  return Array.isArray(classes)
    ? classes
    : String(classes ?? "")
        .split(" ")
        .filter(Boolean);
}

/** Patches for the classes in `names`, in the rules' own order, over `style`. */
function applyClasses(style, names, rules) {
  for (const [name, patch] of Object.entries(rules ?? {}))
    if (names.includes(name)) Object.assign(style, patch);
  return style;
}

/**
 * A node's label for Prismatrix (one line): the page's label, its lines joined.
 * @param {string} label
 */
export const oneLine = (label) =>
  String(label ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("  ·  ");

/**
 * A page's node element (`{ data, classes }`) as a Prismatrix node: its id, its label (a card's title), and its
 * style: its colour as the fill (dark with a coloured border, or a tint), its icon, the root's size, card text, then
 * the class patches (`rules`, gw2ClassStyles and the page's own).
 * @param {{ data: Record<string, any>, classes?: string | string[] }} element
 * @param {object} s settings values
 * @param {{ nodes: Record<string, object> }} rules
 * @param {string} nodeFill the face of an untinted node ("#rrggbb")
 */
export function nodeJSON({ data, classes }, s, rules, nodeFill) {
  const names = classList(classes);
  const card = s.nodeLook === "card";
  const root = names.includes("root");
  const colour = data.color;
  const style = {};
  if (card || s.tintNodeFill) style.color = colour;
  else style.color = nodeFill;
  if (!card && s.tintNodeFill) style.opacity = 0.3;
  if (!card && s.nodeBorderWidth > 0 && colour) {
    style.stroke = colour;
    style.strokeWidth = s.nodeBorderWidth;
  }
  if (!card)
    style.size = clamp(
      NODE_SIZE * s.nodeSizeScale * (root ? s.rootSizeScale : 1),
      1,
      400,
    );
  if (s.showIcons && data.icon) style.icon = data.icon;
  if (root) style.pinLabel = true;
  if (card) {
    if (data.subtitle) style.subtitle = data.subtitle;
    if (data.value) style.value = data.value;
    if (data.tag) style.tag = data.tag;
  }
  applyClasses(style, names, rules.nodes);
  if (!style.color) delete style.color;
  return {
    id: data.id,
    label: card ? (data.cardTitle ?? oneLine(data.label)) : oneLine(data.label),
    style,
  };
}

/**
 * A page's edge element as a Prismatrix edge: its ends, its label (a quantity), its colour when edges take an end's
 * ("child": the edge's target, "parent": its source; the page gives both colours), and the class patches (where the
 * ingredient comes from, the Mystic Forge's, the page's own).
 * @param {{ data: Record<string, any>, classes?: string | string[] }} element
 * @param {{ edges: Record<string, object> }} rules
 * @param {object} [s] settings values
 */
export function edgeJSON({ data, classes }, rules, s = {}) {
  const end =
    s.edgeColorMode === "child"
      ? data.targetColor
      : s.edgeColorMode === "parent"
        ? data.sourceColor
        : null;
  const style = applyClasses(
    end ? { color: end } : {},
    classList(classes),
    rules.edges,
  );
  return {
    id: data.id,
    source: data.source,
    target: data.target,
    label: data.label ?? "",
    ...(Object.keys(style).length && { style }),
  };
}
