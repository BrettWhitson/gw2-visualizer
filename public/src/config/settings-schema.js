/**
 * User-facing view settings: defaults, the Customize panel definition, presets, and migrations from older saved
 * settings (so nothing a user saved is lost when keys change).
 */

import { UNLIMITED_DEPTH } from "./constants.js";

const prefersReducedMotion =
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const DEFAULT_SETTINGS = Object.freeze({
  // what you're looking at (ribbon)
  viewMode: "tree", // 'tree' = one node per occurrence, 'merged' = shared ingredients combined
  direction: "BT", // crafting flow, raw → result: TB | LR | BT | RL | radial (BT = result on top)
  settingsRevision: 2, // bumped when saved values need migrating (see migrateLegacySettings)
  maxDepth: UNLIMITED_DEPTH, // levels expanded by default; UNLIMITED_DEPTH = all
  includeForgePromotions: false, // treat Mystic Forge material promotions (T6 mats, lodestones…) as crafts
  wikiSources: true, // look up vendors & containers on the wiki when an item's details are opened
  pathMode: "standard", // standard = craft everything | cheapest = buy or craft, whichever costs less | fewest = buy whatever is tradeable
  priceBasis: "sell", // 'sell' = instant buy from sell listings, 'buy' = buy orders, 'off'
  useOwned: true, // with a connected account: use owned items first, and only buy or craft the rest
  sidebarOpen: true,
  sidebarWidth: 360, // px, dragged with the side panel's edge
  ribbonCollapsed: false,
  // layout
  layoutEngine: "layered", // layered | force
  dagreRanker: "network-simplex",
  treeAlignment: "", // '' | UL | UR | DL | DR
  // forces (layout/physics.js): like Obsidian's graph view
  centerForce: 0.2, // pull toward the middle
  repelForce: 8, // push nodes apart (spacing)
  linkForce: 0.5, // pull connected nodes together
  linkDistance: 120, // px between levels / rings; the length links settle at
  ingredientOrder: "recipe", // recipe | qty | cost | complexity | rarity | name
  preferMysticForge: false,
  // nodes
  nodeColorMode: "rarity", // rarity | source | discipline | depth | cost
  nodeShape: "round-rectangle",
  nodeSizeScale: 1,
  rootSizeScale: 1.35,
  nodeBorderWidth: 3,
  showIcons: true,
  tintNodeFill: false,
  // labels
  showLabels: true,
  showQuantities: true,
  showCostInLabel: false,
  labelPosition: "auto",
  labelFontScale: 1,
  labelWrapScale: 1,
  labelOverflow: "wrap", // wrap | ellipsis
  labelBackdrop: true,
  labelFadeZoom: 0.35, // labels fade out below this zoom level (0 = never fade)
  // edges
  edgeRouting: "taxi", // taxi | round-taxi | bezier | straight
  edgeWidth: 1.6,
  edgeColorMode: "neutral", // neutral | child | parent
  edgeColor: "#3b4558",
  edgeOpacity: 1,
  showArrows: true,
  arrowShape: "triangle",
  arrowEnd: "product", // which end gets the arrowhead: product | ingredient | both
  arrowScale: 0.8,
  edgeLineStyle: "solid", // solid | dashed | dotted
  edgeCornerRadius: 10, // rounded orthogonal routing
  edgeCurvature: 1, // curved routing: how far edges bend
  edgeQuantityLabels: "auto", // auto | on | off
  lineageUpColor: "#d6a74a", // hover/selection: path to the root
  lineageDownColor: "#62a4da", // hover/selection: ingredients
  // mystic forge
  forgeIndicator: "both", // both | badge | outline | off
  highlightForgeEdges: true,
  // hover & hints
  hoverMode: "lineage", // lineage | subtree | ancestors | none
  dimOpacity: 0.18,
  animateFlow: !prefersReducedMotion,
  flowSpeed: 1,
  pinSelectionLineage: true, // keep the selected node's lineage (and flow) highlighted after the pointer leaves
  showTooltips: true,
  dragPhysics: true, // dragging a node moves the others (live force simulation)
  showBuyCheaperHint: true,
  // filters
  hideRawMaterials: false,
  hideCurrencies: false,
  hideGenericIngredients: false,
  // animation & canvas
  animationsEnabled: !prefersReducedMotion,
  animationDuration: 450,
  animationEasing: "smooth",
  growNewTrees: true,
  canvasBackground: "gradient", // gradient | dots | grid | plain
  renderer: "classic", // classic (Cytoscape) | webgl (our own engine, src/render/)
  showLegend: true,
  smoothZoom: !prefersReducedMotion,
  zoomSpeed: 1,
});

/** Pre-1.1 setting keys → current keys. */
export const LEGACY_SETTING_KEYS = {
  mode: "viewMode",
  dir: "direction",
  spacing: "spacingScale",
  sidebar: "sidebarOpen",
  engine: "layoutEngine",
  ranker: "dagreRanker",
  align: "treeAlignment",
  nodeSepK: "siblingGapScale", // → repelForce (see migrateLegacySettings)
  rankSepK: "levelGapScale", // → linkDistance
  sortBy: "ingredientOrder",
  mfFirst: "preferMysticForge",
  colorBy: "nodeColorMode",
  shape: "nodeShape",
  nodeScale: "nodeSizeScale",
  rootScale: "rootSizeScale",
  borderW: "nodeBorderWidth",
  icons: "showIcons",
  fillTint: "tintNodeFill",
  labels: "showLabels",
  qty: "showQuantities",
  labelCost: "showCostInLabel",
  labelPos: "labelPosition",
  fontScale: "labelFontScale",
  labelWidth: "labelWrapScale",
  labelWrap: "labelOverflow",
  labelBg: "labelBackdrop",
  edgeStyle: "edgeRouting",
  edgeW: "edgeWidth",
  edgeColorBy: "edgeColorMode",
  arrows: "showArrows",
  edgeLabels: "edgeQuantityLabels",
  mfIndicator: "forgeIndicator",
  mfEdges: "highlightForgeEdges",
  fadeOpacity: "dimOpacity",
  flow: "animateFlow",
  tooltips: "showTooltips",
  cheaper: "showBuyCheaperHint",
  hideRaw: "hideRawMaterials",
  hideCurrency: "hideCurrencies",
  hideGeneric: "hideGenericIngredients",
  animate: "animationsEnabled",
  animMs: "animationDuration",
  easing: "animationEasing",
  grow: "growNewTrees",
  bg: "canvasBackground",
  legend: "showLegend",
};

/**
 * The old Compact/Cozy/Spacious density presets (and a global spacing multiplier) were replaced by the spacing and
 * size sliders. These factors convert a saved density into equivalent slider values.
 */
const LEGACY_DENSITY_FACTORS = {
  compact: {
    nodeSizeScale: 0.7,
    siblingGapScale: 0.45,
    levelGapScale: 0.55,
    labelFontScale: 0.82,
  },
  cozy: {
    nodeSizeScale: 1,
    siblingGapScale: 1,
    levelGapScale: 1,
    labelFontScale: 1,
  },
  spacious: {
    nodeSizeScale: 1.37,
    siblingGapScale: 1.9,
    levelGapScale: 1.64,
    labelFontScale: 1.18,
  },
};

/** Fold settings that no longer exist into their replacements. Mutates and returns `saved`. */
export function migrateLegacySettings(saved) {
  const density = LEGACY_DENSITY_FACTORS[saved.density];
  const spacing =
    typeof saved.spacingScale === "number" ? saved.spacingScale : 1;
  if (density || "spacingScale" in saved) {
    const round = (value) => Math.round(value * 100) / 100;
    const factors = density ?? LEGACY_DENSITY_FACTORS.cozy;
    saved.nodeSizeScale = round(
      (saved.nodeSizeScale ?? 1) * factors.nodeSizeScale,
    );
    saved.labelFontScale = round(
      (saved.labelFontScale ?? 1) * factors.labelFontScale,
    );
    saved.siblingGapScale = round(
      (saved.siblingGapScale ?? 1) * factors.siblingGapScale * spacing,
    );
    saved.levelGapScale = round(
      (saved.levelGapScale ?? 1) * factors.levelGapScale * spacing,
    );
  }
  delete saved.density;
  delete saved.spacingScale;
  // The node / level spacing sliders became forces: node spacing → repel, level spacing → link distance.
  if ("siblingGapScale" in saved || "levelGapScale" in saved) {
    const sibling = saved.siblingGapScale ?? 1,
      level = saved.levelGapScale ?? 1;
    saved.repelForce ??= Math.min(20, Math.round(sibling * 8 * 2) / 2);
    saved.linkDistance ??= Math.min(
      400,
      Math.max(20, Math.round((level * 120) / 5) * 5),
    );
    delete saved.siblingGapScale;
    delete saved.levelGapScale;
  }
  // Revision 2: Direction now names the crafting flow (raw → result), the opposite of the old tree-growth meaning.
  // Flip saved directions so everyone keeps the layout they had.
  if ((saved.settingsRevision ?? 1) < 2 && saved.direction) {
    const flipped = { TB: "BT", BT: "TB", LR: "RL", RL: "LR" };
    saved.direction = flipped[saved.direction] ?? saved.direction;
  }
  saved.settingsRevision = 2;
  // The Breadth-first engine duplicated Layered and was removed.
  if (saved.layoutEngine === "tree") saved.layoutEngine = "layered";
  // The "Concentric rings" engine was folded into the radial direction (a spacing-aware radial tree).
  if (saved.layoutEngine === "concentric") {
    saved.layoutEngine = "layered";
    saved.direction = "radial";
  }
  // The depth select offered up to 8 levels plus "All" (99); the slider tops out at UNLIMITED_DEPTH.
  if (typeof saved.maxDepth === "number" && saved.maxDepth > UNLIMITED_DEPTH)
    saved.maxDepth = UNLIMITED_DEPTH;
  return saved;
}

/**
 * How much of the view must be redrawn after a setting changes:
 *  - fit:      rebuild + re-layout, then fit the whole graph
 *  - relayout: rebuild + re-layout, keeping the current node anchored on screen
 *  - restyle:  stylesheet only (no layout)
 *  - none:     read lazily (e.g. on next hover)
 */
export const Redraw = Object.freeze({
  fit: "fit",
  relayout: "relayout",
  restyle: "restyle",
  none: "none",
});

/**
 * Option definitions, split between two panels:
 *  - CUSTOMIZE_GROUPS (side panel "Customize"): how the graph *looks*. Presets only ever touch these.
 *  - SETTINGS_GROUPS (the Settings dialog): how the app *behaves*: recipes & prices, interaction, animation.
 * `visibleWhen` hides options that don't apply; `hint` becomes the tooltip. The ribbon reuses these definitions for
 * any setting it shows (labels, ranges, redraw level).
 */
export const CUSTOMIZE_GROUPS = [
  {
    id: "layout",
    title: "Layout",
    options: [
      {
        key: "layoutEngine",
        label: "Engine",
        type: "select",
        redraw: Redraw.fit,
        hint: "Layered: levels along the flow direction (or rings when radial). Force-directed: free-floating, no direction.",
        choices: [
          ["layered", "Layered"],
          ["force", "Force-directed"],
        ],
      },
      {
        key: "direction",
        label: "Direction",
        type: "select",
        redraw: Redraw.fit,
        visibleWhen: (s) => s.layoutEngine !== "force",
        choices: [
          ["BT", "Upward (result on top)"],
          ["TB", "Downward (result at the bottom)"],
          ["LR", "Left → right (result on the right)"],
          ["RL", "Right → left (result on the left)"],
          ["radial", "Radial (result in the centre)"],
        ],
      },
      {
        key: "dagreRanker",
        label: "Ranking",
        type: "select",
        redraw: Redraw.fit,
        visibleWhen: (s) =>
          s.layoutEngine === "layered" && s.viewMode === "merged",
        choices: [
          ["network-simplex", "Balanced"],
          ["tight-tree", "Tight"],
          ["longest-path", "Longest path"],
        ],
      },
      {
        key: "treeAlignment",
        label: "Alignment",
        type: "select",
        redraw: Redraw.fit,
        visibleWhen: (s) =>
          s.layoutEngine === "layered" && s.direction !== "radial",
        choices: [
          ["", "Centered"],
          ["UL", "Up-left"],
          ["UR", "Up-right"],
          ["DL", "Down-left"],
          ["DR", "Down-right"],
        ],
      },
      {
        key: "ingredientOrder",
        label: "Order ingredients",
        type: "select",
        redraw: Redraw.relayout,
        choices: [
          ["recipe", "Recipe order"],
          ["qty", "Quantity"],
          ["cost", "Cost"],
          ["complexity", "Sub-tree size"],
          ["rarity", "Rarity"],
          ["name", "Name"],
        ],
      },
    ],
  },
  {
    id: "forces",
    title: "Forces",
    options: [
      {
        key: "centerForce",
        label: "Center",
        hint: "Pulls everything toward the middle, keeping the graph compact. In radial layouts: how tightly nodes keep to their ring (low = organic, high = crisp rings).",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        redraw: Redraw.relayout,
        unit: "force",
      },
      {
        key: "repelForce",
        label: "Repel",
        hint: "Pushes nodes apart: the main spacing control. Low values pack nodes tightly (labels may overlap).",
        type: "range",
        min: 0,
        max: 20,
        step: 0.5,
        redraw: Redraw.relayout,
        unit: "force",
      },
      {
        key: "linkForce",
        label: "Link strength",
        hint: "How strongly each ingredient is pulled toward the item it's used for (in layered layouts: under it).",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        redraw: Redraw.relayout,
        unit: "force",
      },
      {
        key: "linkDistance",
        label: "Link distance",
        hint: "Length links settle at: the gap between levels, or between rings in radial layouts.",
        type: "range",
        min: 20,
        max: 400,
        step: 5,
        redraw: Redraw.relayout,
        unit: "px",
      },
    ],
  },
  {
    id: "nodes",
    title: "Nodes",
    options: [
      {
        key: "nodeColorMode",
        label: "Color by",
        type: "select",
        redraw: Redraw.relayout,
        choices: [
          ["rarity", "Rarity"],
          ["source", "Craft source"],
          ["discipline", "Discipline"],
          ["depth", "Tier / depth"],
          ["cost", "Cost heatmap"],
        ],
      },
      {
        key: "nodeShape",
        label: "Shape",
        type: "select",
        redraw: Redraw.restyle,
        choices: [
          ["round-rectangle", "Rounded square"],
          ["rectangle", "Square"],
          ["ellipse", "Circle"],
          ["hexagon", "Hexagon"],
          ["octagon", "Octagon"],
          ["round-diamond", "Diamond"],
        ],
      },
      {
        key: "nodeSizeScale",
        label: "Node size",
        type: "range",
        min: 0.4,
        max: 2.5,
        step: 0.05,
        redraw: Redraw.relayout,
        unit: "×",
      },
      {
        key: "rootSizeScale",
        label: "Root size",
        hint: "Size of the top item relative to other nodes",
        type: "range",
        min: 1,
        max: 3,
        step: 0.05,
        redraw: Redraw.relayout,
        unit: "×",
      },
      {
        key: "nodeBorderWidth",
        label: "Border",
        type: "range",
        min: 0,
        max: 10,
        step: 0.5,
        redraw: Redraw.restyle,
        unit: "px",
      },
      {
        key: "showIcons",
        label: "Item icons",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
      {
        key: "tintNodeFill",
        label: "Tinted fill",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
    ],
  },
  {
    id: "labels",
    title: "Labels",
    options: [
      {
        key: "showLabels",
        label: "Show labels",
        type: "checkbox",
        redraw: Redraw.relayout,
      },
      {
        key: "showQuantities",
        label: "Quantities",
        type: "checkbox",
        redraw: Redraw.relayout,
      },
      {
        key: "showCostInLabel",
        label: "Cost line",
        type: "checkbox",
        redraw: Redraw.relayout,
      },
      {
        key: "labelFadeZoom",
        label: "Fade below zoom",
        hint: "Labels fade out when zoomed out past this level (0% = always shown). The root, selected, highlighted and hovered nodes stay labelled.",
        type: "range",
        min: 0,
        max: 1.2,
        step: 0.05,
        redraw: Redraw.restyle,
        unit: "%",
      },
      {
        key: "labelPosition",
        label: "Position",
        type: "select",
        redraw: Redraw.relayout,
        choices: [
          ["auto", "Auto"],
          ["below", "Below"],
          ["above", "Above"],
          ["right", "Right"],
          ["left", "Left"],
          ["center", "On icon"],
        ],
      },
      {
        key: "labelFontScale",
        label: "Font size",
        type: "range",
        min: 0.6,
        max: 2.2,
        step: 0.05,
        redraw: Redraw.relayout,
        unit: "×",
      },
      {
        key: "labelWrapScale",
        label: "Wrap width",
        type: "range",
        min: 0.5,
        max: 3,
        step: 0.1,
        redraw: Redraw.relayout,
        unit: "×",
      },
      {
        key: "labelOverflow",
        label: "Long names",
        type: "select",
        redraw: Redraw.relayout,
        choices: [
          ["wrap", "Wrap"],
          ["ellipsis", "Truncate…"],
        ],
      },
      {
        key: "labelBackdrop",
        label: "Label backdrop",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
    ],
  },
  {
    id: "edges",
    title: "Edges",
    options: [
      {
        key: "edgeRouting",
        label: "Routing",
        type: "select",
        redraw: Redraw.restyle,
        choices: [
          ["taxi", "Orthogonal"],
          ["round-taxi", "Rounded orthogonal"],
          ["bezier", "Curved"],
          ["straight", "Straight"],
        ],
      },
      {
        key: "edgeWidth",
        label: "Width",
        type: "range",
        min: 0.5,
        max: 6,
        step: 0.1,
        redraw: Redraw.restyle,
        unit: "px",
      },
      {
        key: "edgeColorMode",
        label: "Color",
        type: "select",
        redraw: Redraw.restyle,
        choices: [
          ["neutral", "Single color"],
          ["child", "Ingredient color"],
          ["parent", "Product color"],
        ],
      },
      {
        key: "edgeColor",
        label: "Base color",
        type: "color",
        redraw: Redraw.restyle,
        visibleWhen: (s) => s.edgeColorMode === "neutral",
      },
      {
        key: "edgeOpacity",
        label: "Opacity",
        type: "range",
        min: 0.1,
        max: 1,
        step: 0.05,
        redraw: Redraw.restyle,
        unit: "%",
      },
      {
        key: "edgeLineStyle",
        label: "Line style",
        type: "select",
        redraw: Redraw.restyle,
        choices: [
          ["solid", "Solid"],
          ["dashed", "Dashed"],
          ["dotted", "Dotted"],
        ],
      },
      {
        key: "edgeCornerRadius",
        label: "Corner radius",
        type: "range",
        min: 0,
        max: 40,
        step: 1,
        redraw: Redraw.restyle,
        unit: "px",
        visibleWhen: (s) => s.edgeRouting === "round-taxi",
      },
      {
        key: "edgeCurvature",
        label: "Curvature",
        hint: "How far curved edges bend (0 = straight). Applies to Curved routing, and to all edges in radial and force-directed layouts.",
        type: "range",
        min: 0,
        max: 2,
        step: 0.05,
        redraw: Redraw.restyle,
        unit: "×",
        visibleWhen: (s) =>
          s.edgeRouting === "bezier" ||
          s.direction === "radial" ||
          s.layoutEngine === "force",
      },
      {
        key: "showArrows",
        label: "Arrowheads",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
      {
        key: "arrowShape",
        label: "Arrow shape",
        type: "select",
        redraw: Redraw.restyle,
        visibleWhen: (s) => s.showArrows,
        choices: [
          ["triangle", "Triangle"],
          ["vee", "Vee"],
          ["chevron", "Chevron"],
          ["triangle-backcurve", "Swept"],
          ["circle", "Dot"],
          ["square", "Square"],
          ["tee", "Tee"],
        ],
      },
      {
        key: "arrowEnd",
        label: "Arrow at",
        type: "select",
        redraw: Redraw.restyle,
        visibleWhen: (s) => s.showArrows,
        choices: [
          ["product", "Product (what's made)"],
          ["ingredient", "Ingredient"],
          ["both", "Both ends"],
        ],
      },
      {
        key: "arrowScale",
        label: "Arrow size",
        type: "range",
        min: 0.3,
        max: 2.5,
        step: 0.05,
        redraw: Redraw.restyle,
        unit: "×",
        visibleWhen: (s) => s.showArrows,
      },
      {
        key: "edgeQuantityLabels",
        label: "Qty on edges",
        type: "select",
        redraw: Redraw.restyle,
        choices: [
          ["auto", "Merged view only"],
          ["on", "Always"],
          ["off", "Never"],
        ],
      },
    ],
  },
  {
    id: "forge",
    title: "Mystic Forge",
    options: [
      {
        key: "forgeIndicator",
        label: "Indicator",
        type: "select",
        redraw: Redraw.relayout,
        choices: [
          ["both", "Badge + ring"],
          ["badge", "Corner badge"],
          ["outline", "Glow ring"],
          ["off", "Off"],
        ],
      },
      {
        key: "highlightForgeEdges",
        label: "Purple forge edges",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
    ],
  },
  {
    id: "highlight",
    title: "Highlight",
    options: [
      {
        key: "dimOpacity",
        label: "Dim others to",
        hint: "Opacity of everything outside the hovered lineage",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        redraw: Redraw.restyle,
        unit: "%",
      },
      {
        key: "animateFlow",
        label: "Animated flow",
        hint: "Marching dashes along highlighted edges, from ingredient to product",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
      {
        key: "flowSpeed",
        label: "Flow speed",
        type: "range",
        min: 0.1,
        max: 4,
        step: 0.1,
        redraw: Redraw.none,
        unit: "×",
        visibleWhen: (s) => s.animateFlow,
      },
      {
        key: "lineageUpColor",
        label: "Path to root",
        hint: "Edge colour for the hovered or selected node's path up to the root",
        type: "color",
        redraw: Redraw.restyle,
      },
      {
        key: "lineageDownColor",
        label: "Ingredients",
        hint: "Edge colour for the hovered or selected node's ingredients",
        type: "color",
        redraw: Redraw.restyle,
      },
      {
        key: "showBuyCheaperHint",
        label: "Buy-cheaper hint",
        hint: "Dashed green border where buying is cheaper than crafting",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
    ],
  },
  {
    id: "filter",
    title: "Filter",
    options: [
      {
        key: "hideRawMaterials",
        label: "Hide raw materials",
        type: "checkbox",
        redraw: Redraw.fit,
      },
      {
        key: "hideCurrencies",
        label: "Hide currencies",
        type: "checkbox",
        redraw: Redraw.fit,
      },
      {
        key: "hideGenericIngredients",
        label: "Hide generic ingredients",
        type: "checkbox",
        redraw: Redraw.fit,
      },
    ],
  },
  {
    id: "canvas",
    title: "Canvas",
    options: [
      {
        key: "canvasBackground",
        label: "Background",
        type: "select",
        redraw: Redraw.none,
        choices: [
          ["gradient", "Vignette"],
          ["dots", "Dot grid"],
          ["grid", "Blueprint grid"],
          ["plain", "Plain"],
        ],
      },
      {
        key: "showLegend",
        label: "Legend",
        type: "checkbox",
        redraw: Redraw.none,
      },
      {
        key: "renderer",
        label: "Renderer",
        type: "select",
        redraw: Redraw.none,
        hint: "Fast draws with the GPU: smooth with thousands of items, with gliding motion and flowing lineages. The page reloads to switch.",
        choices: [
          ["classic", "Classic"],
          ["webgl", "Fast (WebGL, preview)"],
        ],
      },
    ],
  },
];

export const SETTINGS_GROUPS = [
  {
    id: "recipes",
    title: "Recipes & prices",
    options: [
      {
        key: "priceBasis",
        label: "Price basis",
        hint: "Which trading post price costs use",
        type: "select",
        redraw: Redraw.relayout,
        choices: [
          ["sell", "Instant buy (sell listings)"],
          ["buy", "Buy orders"],
          ["off", "Off (no prices)"],
        ],
      },
      {
        key: "useOwned",
        label: "Use what I own",
        hint: "With a connected account: take ingredients from your bank, material storage, shared slots, bags and Trading Post pickup first, and only buy or craft the rest",
        type: "checkbox",
        redraw: Redraw.relayout,
      },
      {
        key: "preferMysticForge",
        label: "Prefer Mystic Forge recipes",
        hint: "When an item has both a crafting and a Mystic Forge recipe, start with the forge one",
        type: "checkbox",
        redraw: Redraw.fit,
      },
      {
        key: "wikiSources",
        label: "Vendor & container info",
        hint: "When you open an item's details, look up which vendors sell it and which containers drop it on the Guild Wars 2 Wiki (cached for a week).",
        type: "checkbox",
        redraw: Redraw.none,
      },
      {
        key: "includeForgePromotions",
        label: "Include promotions",
        hint: "Mystic Forge material promotions (T6 materials, lodestones…). Off: those items are raw materials to buy. On: they expand into their forge inputs.",
        type: "checkbox",
        redraw: Redraw.fit,
      },
    ],
  },
  {
    id: "interaction",
    title: "Interaction",
    options: [
      {
        key: "hoverMode",
        label: "On hover",
        type: "select",
        redraw: Redraw.none,
        choices: [
          ["lineage", "Ingredients + path to root"],
          ["subtree", "Ingredients only"],
          ["ancestors", "Path to root only"],
          ["none", "Nothing"],
        ],
      },
      {
        key: "pinSelectionLineage",
        label: "Keep on selection",
        hint: "The selected node keeps its highlighted lineage and animated flow after the pointer leaves",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
      {
        key: "dragPhysics",
        label: "Physics on drag",
        hint: "Dragging a node pulls its neighbours along and pushes others aside; the graph settles when you let go",
        type: "checkbox",
        redraw: Redraw.none,
      },
      {
        key: "showTooltips",
        label: "Tooltips",
        type: "checkbox",
        redraw: Redraw.none,
      },
      {
        key: "smoothZoom",
        label: "Smooth zoom",
        hint: "Mouse-wheel and pinch zoom glide instead of jumping",
        type: "checkbox",
        redraw: Redraw.none,
      },
      {
        key: "zoomSpeed",
        label: "Zoom speed",
        type: "range",
        min: 0.25,
        max: 3,
        step: 0.05,
        redraw: Redraw.none,
        unit: "×",
        visibleWhen: (s) => s.smoothZoom,
      },
    ],
  },
  {
    id: "animation",
    title: "Animation",
    options: [
      {
        key: "animationsEnabled",
        label: "Animate",
        hint: "Off by default when your system asks for reduced motion",
        type: "checkbox",
        redraw: Redraw.restyle,
      },
      {
        key: "animationDuration",
        label: "Duration",
        type: "range",
        min: 100,
        max: 1500,
        step: 50,
        redraw: Redraw.restyle,
        unit: "ms",
        visibleWhen: (s) => s.animationsEnabled,
      },
      {
        key: "animationEasing",
        label: "Easing",
        type: "select",
        redraw: Redraw.none,
        visibleWhen: (s) => s.animationsEnabled,
        choices: [
          ["smooth", "Smooth"],
          ["snappy", "Snappy"],
          ["bouncy", "Bouncy"],
          ["linear", "Linear"],
        ],
      },
      {
        key: "growNewTrees",
        label: "Grow new trees",
        type: "checkbox",
        redraw: Redraw.none,
        visibleWhen: (s) => s.animationsEnabled,
      },
    ],
  },
];

/** Every panel option (Customize + Settings). */
export const VIEW_OPTION_GROUPS = [...CUSTOMIZE_GROUPS, ...SETTINGS_GROUPS];

/** Settings changed only from the ribbon. */
const RIBBON_ONLY_OPTIONS = [
  { key: "viewMode", label: "View", redraw: Redraw.fit },
  {
    key: "maxDepth",
    label: "Depth",
    type: "range",
    min: 1,
    max: UNLIMITED_DEPTH,
    step: 1,
    unit: "levels",
    redraw: Redraw.fit,
  },
  { key: "pathMode", label: "Path", redraw: Redraw.fit },
];

/** Ribbon "Path" choices (see PathPlanner). */
export const PATH_MODES = {
  standard: {
    label: "Craft all",
    hint: "Craft every ingredient with its default recipe",
  },
  cheapest: {
    label: "Cheapest",
    hint: "For each item, pick the cheapest of buying it or any of its recipes (needs prices)",
  },
  fewest: {
    label: "Fewest crafts",
    hint: "Buy everything tradeable; only craft what can't be bought",
  },
};

const OPTIONS_BY_KEY = new Map(
  [
    ...VIEW_OPTION_GROUPS.flatMap((group) => group.options),
    ...RIBBON_ONLY_OPTIONS,
  ].map((o) => [o.key, o]),
);

/** The option definition for a setting key (label, type, range, redraw level), or undefined. */
export const getOptionDefinition = (key) => OPTIONS_BY_KEY.get(key);

/** Format a setting value the way sliders display it. */
export function formatOptionValue(option, value) {
  const number = Number(value);
  switch (option?.unit) {
    case "ms":
      return `${number}ms`;
    case "px":
      return `${number}px`;
    case "%":
      return number === 0 && option.key === "labelFadeZoom"
        ? "never"
        : `${Math.round(number * 100)}%`;
    case "force":
      return number.toFixed(number >= 2 || number === 0 ? 1 : 2);
    case "×":
      return `${number.toFixed(2)}×`;
    case "levels":
      return number >= UNLIMITED_DEPTH ? "All" : String(number);
    default:
      return number.toFixed(2);
  }
}

/**
 * Presets come in two independent kinds, each owning a slice of the Customize options:
 *  - layout: the Layout and Forces sections (engine, direction, alignment, ordering; center / repel / link forces);
 *  - style:  how things look (Nodes, Labels, Edges, Mystic Forge, Highlight, Canvas).
 * Applying a preset resets its slice to defaults, then applies its values; the other slice is untouched. Filters,
 * what you're viewing (ribbon: view, depth, path) and app behaviour (Settings) are never part of a preset.
 */
const groupKeys = (...ids) =>
  CUSTOMIZE_GROUPS.filter((group) => ids.includes(group.id)).flatMap((group) =>
    group.options.map((option) => option.key),
  );

export const PRESET_KINDS = {
  layout: {
    label: "Layout",
    keys: groupKeys("layout", "forces"),
    presets: {
      Standard: { description: "Layered, top to bottom.", values: {} },
      "Left to right": {
        description: "Layered, flowing left to right.",
        values: { direction: "LR" },
      },
      Compact: {
        description: "Tight spacing for big trees (labels may overlap).",
        values: { repelForce: 3, linkDistance: 70 },
      },
      Spacious: {
        description: "Room to breathe: generous gaps between nodes and levels.",
        values: { repelForce: 15, linkDistance: 190 },
      },
      Radial: {
        description: "Root in the middle, one ring per level.",
        values: { direction: "radial" },
      },
      "Force web": {
        description: "Physics simulation: related items pull together.",
        values: { layoutEngine: "force" },
      },
    },
  },
  style: {
    label: "Style",
    keys: groupKeys("nodes", "labels", "edges", "forge", "highlight", "canvas"),
    presets: {
      Standard: {
        description: "Balanced defaults: rarity colours, orthogonal edges.",
        values: {},
      },
      Compact: {
        description: "Small nodes and text; labels appear as you zoom in.",
        values: {
          nodeSizeScale: 0.7,
          labelFontScale: 0.85,
          labelFadeZoom: 0.75,
          nodeBorderWidth: 2,
          edgeRouting: "straight",
          edgeWidth: 1,
          showArrows: false,
        },
      },
      Presentation: {
        description: "Large, colourful and airy: good for screenshots.",
        values: {
          nodeSizeScale: 1.35,
          rootSizeScale: 1.7,
          labelFontScale: 1.25,
          labelFadeZoom: 0.15,
          tintNodeFill: true,
          edgeRouting: "bezier",
          edgeColorMode: "child",
          edgeWidth: 2.2,
          canvasBackground: "dots",
        },
      },
      Blueprint: {
        description: "Technical drawing: craft-source colours on a grid.",
        values: {
          canvasBackground: "grid",
          nodeColorMode: "source",
          nodeShape: "rectangle",
          tintNodeFill: true,
          nodeBorderWidth: 2,
          edgeColor: "#4a8fd9",
          edgeWidth: 1.4,
          edgeLineStyle: "dashed",
          showArrows: false,
          labelBackdrop: false,
          forgeIndicator: "outline",
        },
      },
      "Cost analysis": {
        description: "Heatmap of where the gold goes, with costs on labels.",
        values: {
          nodeColorMode: "cost",
          tintNodeFill: true,
          showCostInLabel: true,
          edgeColorMode: "child",
          edgeWidth: 2.4,
          showBuyCheaperHint: true,
          labelFadeZoom: 0.25,
        },
      },
      "Forge focus": {
        description: "Mystic Forge crafts stand out; everything else recedes.",
        values: {
          nodeColorMode: "source",
          tintNodeFill: true,
          forgeIndicator: "both",
          highlightForgeEdges: true,
          edgeColor: "#2a3140",
          edgeOpacity: 0.75,
          edgeRouting: "round-taxi",
          showBuyCheaperHint: false,
        },
      },
      Galaxy: {
        description: "Round nodes coloured by tier, soft curved links on dots.",
        values: {
          nodeShape: "ellipse",
          nodeColorMode: "depth",
          tintNodeFill: true,
          edgeRouting: "bezier",
          edgeColorMode: "child",
          edgeOpacity: 0.5,
          showArrows: false,
          canvasBackground: "dots",
          labelFadeZoom: 0.55,
        },
      },
      Minimal: {
        description: "Quiet and clean: thin lines, no extras.",
        values: {
          nodeShape: "ellipse",
          nodeBorderWidth: 1.5,
          labelBackdrop: false,
          edgeRouting: "straight",
          edgeWidth: 1,
          edgeOpacity: 0.6,
          showArrows: false,
          canvasBackground: "plain",
          forgeIndicator: "outline",
          highlightForgeEdges: false,
          showBuyCheaperHint: false,
          animateFlow: false,
          showLegend: false,
        },
      },
    },
  },
};

/** Name of the preset of this kind the current settings exactly match, or null ("Custom"). */
export function findMatchingPreset(values, kind) {
  const { keys, presets } = PRESET_KINDS[kind];
  for (const [name, preset] of Object.entries(presets)) {
    const expected = { ...DEFAULT_SETTINGS, ...preset.values };
    if (keys.every((key) => values[key] === expected[key])) return name;
  }
  return null;
}
