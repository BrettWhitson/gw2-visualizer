// The app's settings and item states in Prismatrix's terms: GW2 items must look the way they did, now that the engine
// knows nothing of GW2. Each node's look is worked out here (its style); Prismatrix's model checks every style and
// option we hand it, so a test that finds no issues is a test that Prismatrix accepts them.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANIMATION_OPTIONS,
  GraphModel,
  LAYOUTS,
  physicsSchema,
  resolve,
} from "prismatrix";
import {
  NODE_SIZE,
  animationOptions,
  classList,
  edgeJSON,
  gw2ClassStyles,
  layoutSettings,
  modelOptions,
  nodeJSON,
  oneLine,
} from "../web/src/render/prism-settings.js";
import { edgeSourceRules } from "../web/src/render/edge-sources.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";
import {
  FORGE_BADGE_URI,
  FORGE_COLOR,
  UI_COLORS,
} from "../web/src/config/constants.js";

const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });
const FILL = UI_COLORS.nodeFill;

/** A node's style the way the crafting page gets it. */
function nodeStyle(classes, data = {}, s = settings()) {
  const rules = { nodes: gw2ClassStyles(s).nodes };
  return nodeJSON(
    { data: { id: "n", label: "A", color: "#4a9df0", ...data }, classes },
    s,
    rules,
    FILL,
  ).style;
}

/** Every warning resolving these options against their schema gives. */
function warningsOf(schema, values) {
  const warnings = [];
  resolve(schema, values, (message) => warnings.push(message));
  return warnings;
}

test("item states: owned, cheaper, cycle, collapsed and Mystic Forge look as they did", () => {
  assert.equal(nodeStyle(["owned"]).aura, UI_COLORS.owned);
  assert.equal(nodeStyle(["hiddenKids"]).stack, true);
  const cycle = nodeStyle(["cycle"]);
  assert.deepEqual(
    [cycle.stroke, cycle.strokeStyle],
    [UI_COLORS.danger, "dotted"],
  );
  const cheaper = nodeStyle(
    ["cheaper"],
    {},
    settings({ showBuyCheaperHint: true }),
  );
  assert.deepEqual(
    [cheaper.strokeStyle, cheaper.aura],
    ["dashed", UI_COLORS.good],
  );
  assert.equal(
    nodeStyle(["cheaper"], {}, settings({ showBuyCheaperHint: false })).aura,
    undefined,
  );
  // Owned wins over cheaper, as before (it's applied later).
  assert.equal(
    nodeStyle(["cheaper", "owned"], {}, settings({ showBuyCheaperHint: true }))
      .aura,
    UI_COLORS.owned,
  );
  const forge = (forgeIndicator) =>
    nodeStyle("mf", {}, settings({ forgeIndicator }));
  assert.deepEqual(
    [forge("both").ring, forge("both").badgeIcon],
    [FORGE_COLOR, FORGE_BADGE_URI],
  );
  assert.deepEqual(
    [forge("badge").ring, forge("badge").badgeIcon],
    [undefined, FORGE_BADGE_URI],
  );
  assert.deepEqual(
    [forge("outline").ring, forge("outline").badgeIcon],
    [FORGE_COLOR, undefined],
  );
  assert.deepEqual(
    [forge("off").ring, forge("off").badgeIcon],
    [undefined, undefined],
  );
});

test("a node's face: dark with a border in its colour, or tinted; the root bigger and always labelled", () => {
  const plain = nodeStyle([]);
  assert.deepEqual(
    [plain.color, plain.stroke, plain.strokeWidth],
    [FILL, "#4a9df0", DEFAULT_SETTINGS.nodeBorderWidth],
  );
  const tinted = nodeStyle([], {}, settings({ tintNodeFill: true }));
  assert.deepEqual([tinted.color, tinted.opacity], ["#4a9df0", 0.3]);
  assert.equal(
    nodeStyle([], {}, settings({ nodeBorderWidth: 0 })).stroke,
    undefined,
  );
  const root = nodeStyle(["root"]);
  assert.equal(root.size, NODE_SIZE * DEFAULT_SETTINGS.rootSizeScale);
  assert.equal(root.pinLabel, true);
  assert.equal(nodeStyle([], { icon: "a.png" }).icon, "a.png");
  assert.equal(
    nodeStyle([], { icon: "a.png" }, settings({ showIcons: false })).icon,
    undefined,
  );
});

test("labels: one line, the page's lines joined; a card's title, subtitle, value and tag", () => {
  assert.equal(
    oneLine("2 × Gift  ▸\n(have 1)\n1g 2s 3c"),
    "2 × Gift  ▸  ·  (have 1)  ·  1g 2s 3c",
  );
  const s = settings({ nodeLook: "card" });
  const card = nodeJSON(
    {
      data: {
        id: "c",
        label: "ignored",
        cardTitle: "Gift",
        subtitle: ["×2 ", { mark: "#123456" }],
        value: [{ text: "5", color: "#e2b54f" }, { dot: "#e2b54f" }],
        tag: "✓ owned",
        color: "#4a9df0",
      },
      classes: "",
    },
    s,
    { nodes: {} },
    FILL,
  );
  assert.equal(card.label, "Gift");
  assert.deepEqual(card.style.subtitle, ["×2 ", { mark: "#123456" }]);
  assert.equal(card.style.tag, "✓ owned");
  assert.equal(card.style.color, "#4a9df0", "a card's stripe");
});

test("every style and option Prismatrix is handed passes its checks", () => {
  const s = settings({ forgeIndicator: "both", showBuyCheaperHint: true });
  const rules = {
    nodes: gw2ClassStyles(s).nodes,
    edges: { ...gw2ClassStyles(s).edges, ...edgeSourceRules(() => null).edges },
  };
  const nodes = [
    ["root", "mf"],
    ["owned", "cheaper", "cycle", "hiddenKids"],
  ].map((classes, i) =>
    nodeJSON(
      {
        data: { id: `n${i}`, label: "x", color: "#4a9df0", icon: "i.png" },
        classes,
      },
      s,
      rules,
      FILL,
    ),
  );
  const edges = [
    edgeJSON(
      {
        data: { id: "e", source: "n0", target: "n1", label: "×3" },
        classes: "mf src-currency",
      },
      rules,
    ),
  ];
  for (const look of ["icon", "card"]) {
    const model = new GraphModel(
      { nodes, edges },
      modelOptions(settings({ nodeLook: look })),
    );
    assert.deepEqual(model.issues, [], look);
  }
  for (const overrides of [
    {},
    { direction: "radial", physicsMode: "floating" },
    { viewMode: "merged" },
  ]) {
    const l = layoutSettings(settings(overrides));
    assert.deepEqual(
      warningsOf(LAYOUTS[l.layout].options, l.layoutOptions),
      [],
    );
    assert.deepEqual(
      warningsOf(physicsSchema(l.layout, l.physics), l.physicsOptions),
      [],
    );
  }
  assert.deepEqual(warningsOf(ANIMATION_OPTIONS, animationOptions(s)), []);
});

test("edges: Mystic Forge edges and where ingredients come from become each edge's own style", () => {
  const s = settings({ highlightForgeEdges: true });
  const rules = {
    edges: { ...gw2ClassStyles(s).edges, ...edgeSourceRules(() => null).edges },
  };
  const edge = (classes) =>
    edgeJSON(
      { data: { id: "e", source: "a", target: "b", label: "×3" }, classes },
      rules,
    );
  assert.deepEqual(edge("mf").style, { color: FORGE_COLOR, dash: "dashed" });
  assert.equal(edge("src-currency").style.dash, "dashed");
  assert.equal(edge("").style, undefined);
  assert.equal(edge("").label, "×3");
});

test("options: layouts by direction (the crafting flow), views, routing, arrows, quantities, hover and flow", () => {
  const layout = (overrides) => layoutSettings(settings(overrides));
  // BT: the result on top, so the tree grows down from it.
  assert.deepEqual(
    [
      layout({ direction: "BT" }).layout,
      layout({ direction: "BT" }).layoutOptions.direction,
    ],
    ["tree", "TB"],
  );
  assert.equal(layout({ direction: "LR" }).layoutOptions.direction, "RL");
  assert.equal(layout({ viewMode: "merged" }).layout, "merged");
  assert.equal(layout({ direction: "radial" }).layout, "radial");
  assert.equal(
    layout({ physicsMode: "floating" }).physics,
    "elastic",
    "trees only spring",
  );
  assert.equal(
    layout({ direction: "radial", physicsMode: "floating" }).physics,
    "floating",
  );

  const edge = (overrides) => modelOptions(settings(overrides)).edge;
  assert.equal(edge({ edgeRouting: "bezier" }).shape, "curve");
  assert.deepEqual(
    [
      edge({ edgeRouting: "round-taxi", edgeCornerRadius: 12 }).shape,
      edge({ edgeRouting: "round-taxi", edgeCornerRadius: 12 }).corner,
    ],
    ["step", 12],
  );
  assert.equal(
    edge({ arrowEnd: "product" }).arrowAt,
    "source",
    "edges run product → ingredient",
  );
  assert.equal(edge({ arrowEnd: "ingredient" }).arrowAt, "target");
  assert.equal(edge({ showArrows: false }).arrow, "none");
  // Coloured by an end: each edge's own colour, from the page's colours for its ends (a node's fill is dark).
  const ends = {
    id: "e",
    source: "a",
    target: "b",
    sourceColor: "#111111",
    targetColor: "#222222",
  };
  const coloured = (edgeColorMode) =>
    edgeJSON(
      { data: ends, classes: "" },
      { edges: {} },
      settings({ edgeColorMode }),
    ).style?.color;
  assert.equal(coloured("child"), "#222222");
  assert.equal(coloured("parent"), "#111111");
  assert.equal(coloured("neutral"), undefined, "the option's colour");
  assert.equal(edge({ edgeQuantityLabels: "on" }).labels, "target");
  assert.equal(
    edge({ edgeQuantityLabels: "auto", viewMode: "tree" }).labels,
    "off",
  );
  assert.equal(
    edge({
      edgeQuantityLabels: "auto",
      viewMode: "merged",
      showQuantities: true,
    }).labels,
    "target",
  );

  const anim = (overrides, page) => animationOptions(settings(overrides), page);
  assert.deepEqual(
    ["lineage", "subtree", "ancestors", "none"].map(
      (hoverMode) => anim({ hoverMode }).hoverLineage,
    ),
    ["both", "descendants", "ancestors", "none"],
  );
  assert.equal(
    anim({ animateFlow: true }).flow,
    "source",
    "ingredient → product",
  );
  assert.equal(
    anim({ animateFlow: true }, { flowToward: "target" }).flow,
    "target",
  );
  assert.equal(anim({ animateFlow: false }).flow, "off");
  assert.equal(anim({ animationsEnabled: false }).transition, 0);
  assert.ok(Math.abs(anim({ dimOpacity: 0.18 }).hoverDim - 0.82) < 1e-9);
  assert.equal(anim({ edgeColorMode: "source" }).lineageColor, "off");
  assert.equal(anim({ edgeColorMode: "child" }).lineageColor, "direction");
});

test("cards: Items as and Card links reach Prismatrix", () => {
  const card = modelOptions(
    settings({ nodeLook: "card", cardConnectors: "both" }),
  );
  assert.equal(card.node.look, "card");
  assert.deepEqual([card.edge.arrow, card.edge.arrowAt], ["arrow", "both"]);
  assert.equal(
    modelOptions(settings({ nodeLook: "card", cardConnectors: "dots" })).edge
      .arrow,
    "dot",
  );
  assert.equal(modelOptions(settings()).node.look, "node", "icons by default");
});

test("classes: strings and arrays both work", () => {
  assert.deepEqual(classList("root hiddenKids owned"), [
    "root",
    "hiddenKids",
    "owned",
  ]);
  assert.deepEqual(classList(["mf"]), ["mf"]);
  assert.deepEqual(classList(undefined), []);
});
