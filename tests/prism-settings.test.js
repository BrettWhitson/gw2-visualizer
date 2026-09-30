// The app's settings and item states in Prism's terms: GW2 items must look the way they did before Prism was its own
// project, now that its style system knows nothing of GW2.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gw2ClassRules,
  layoutSettings,
  prismClasses,
  prismOptions,
  prismTheme,
} from "../web/src/render/prism-settings.js";
import {
  resolveEdgeStyle,
  resolveNodeStyle,
  resolveRouting,
} from "prism/style.js";
import { tokenTheme } from "../web/src/render/theme-tokens.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";
import { FORGE_COLOR, UI_COLORS } from "../web/src/config/constants.js";

const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });

/** A node or edge style the way the crafting page gets it. */
function nodeStyle(classes, data = {}, s = settings()) {
  return resolveNodeStyle(
    new Set(prismClasses(classes)),
    data,
    prismOptions(s),
    { ...tokenTheme(), ...prismTheme(s) }, // as WebGLGraphView composes it
    gw2ClassRules(s),
  );
}
function edgeStyle(classes, data = {}, s = settings()) {
  return resolveEdgeStyle(
    new Set(prismClasses(classes)),
    data,
    prismOptions(s),
    { ...tokenTheme(), ...prismTheme(s) }, // as WebGLGraphView composes it
    gw2ClassRules(s),
  );
}

test("item states: owned, cheaper, cycle, collapsed and Mystic Forge look as they did", () => {
  assert.equal(nodeStyle(["owned"]).aura, UI_COLORS.owned);
  assert.equal(nodeStyle(["hiddenKids"]).pattern, "stack");
  const cycle = nodeStyle(["cycle"]);
  assert.deepEqual([cycle.border, cycle.pattern], [UI_COLORS.danger, "dotted"]);

  const cheaper = nodeStyle(
    ["cheaper"],
    {},
    settings({ showBuyCheaperHint: true }),
  );
  assert.deepEqual([cheaper.pattern, cheaper.aura], ["dashed", UI_COLORS.good]);
  assert.equal(
    nodeStyle(["cheaper"], {}, settings({ showBuyCheaperHint: false })).aura,
    null,
  );
  // Owned wins over cheaper, as before (it's applied later).
  assert.equal(
    nodeStyle(["cheaper", "owned"], {}, settings({ showBuyCheaperHint: true }))
      .aura,
    UI_COLORS.owned,
  );

  const forge = (forgeIndicator) =>
    nodeStyle(["mf"], {}, settings({ forgeIndicator }));
  assert.deepEqual(
    [forge("both").ring, forge("both").badge],
    [FORGE_COLOR, true],
  );
  assert.deepEqual([forge("badge").ring, forge("badge").badge], [null, true]);
  assert.deepEqual(
    [forge("outline").ring, forge("outline").badge],
    [FORGE_COLOR, false],
  );
  assert.deepEqual([forge("off").ring, forge("off").badge], [null, false]);

  const root = nodeStyle(["root"]);
  assert.ok(root.bold && root.labelPriority > 0);
  assert.equal(nodeStyle([]).border, UI_COLORS.muted);
});

test("edges: Mystic Forge edges, arrows at the product end, quantity labels in the merged view", () => {
  const data = { label: "×3", sourceColor: "#111111", targetColor: "#222222" };
  const forge = edgeStyle(
    ["mf"],
    data,
    settings({ highlightForgeEdges: true }),
  );
  assert.deepEqual([forge.color, forge.pattern], [FORGE_COLOR, "dashed"]);
  assert.equal(
    edgeStyle(["mf"], data, settings({ highlightForgeEdges: false })).color,
    DEFAULT_SETTINGS.edgeColor,
  );

  const product = edgeStyle([], data, settings({ arrowEnd: "product" }));
  assert.deepEqual(
    [product.arrowAtSource, product.arrowAtTarget],
    [DEFAULT_SETTINGS.arrowShape, null],
  );
  const ingredient = edgeStyle([], data, settings({ arrowEnd: "ingredient" }));
  assert.deepEqual(
    [ingredient.arrowAtSource, ingredient.arrowAtTarget],
    [null, DEFAULT_SETTINGS.arrowShape],
  );

  assert.equal(
    edgeStyle([], data, settings({ edgeColorMode: "child" })).color,
    "#222222",
  );
  assert.equal(
    edgeStyle([], data, settings({ edgeColorMode: "parent" })).color,
    "#111111",
  );

  const label = (overrides) => edgeStyle([], data, settings(overrides)).label;
  assert.equal(label({ edgeQuantityLabels: "on", viewMode: "tree" }), "×3");
  assert.equal(label({ edgeQuantityLabels: "off", viewMode: "merged" }), "");
  assert.equal(
    label({
      edgeQuantityLabels: "auto",
      viewMode: "merged",
      showQuantities: true,
    }),
    "×3",
  );
  assert.equal(
    label({
      edgeQuantityLabels: "auto",
      viewMode: "tree",
      showQuantities: true,
    }),
    "",
  );
});

test("options: views, hover modes, routing, flow and the layout settings for Tether", () => {
  assert.equal(layoutSettings(settings({ viewMode: "tree" })).layered, false);
  assert.equal(layoutSettings(settings({ viewMode: "merged" })).layered, true);
  const hover = (hoverMode) => prismOptions(settings({ hoverMode })).hoverMode;
  assert.deepEqual(["lineage", "subtree", "ancestors", "none"].map(hover), [
    "both",
    "descendants",
    "ancestors",
    "none",
  ]);
  assert.equal(
    resolveRouting(
      prismOptions(settings({ edgeRouting: "bezier", direction: "BT" })),
    ),
    "s-curve",
  );
  assert.equal(prismOptions(settings()).flowToward, "source");
  assert.equal(
    prismOptions(settings({ flowToward: "target" })).flowToward,
    "target",
  );
  assert.equal(
    prismOptions(settings({ growNewTrees: false })).growNewGraphs,
    false,
  );
  const theme = prismTheme(settings({ lineageUpColor: "#abcdef" }));
  assert.equal(theme.ancestors, "#abcdef");
});

test("classes: hiddenKids becomes Prism's collapsed; strings and arrays both work", () => {
  assert.deepEqual(prismClasses("root hiddenKids owned"), [
    "root",
    "collapsed",
    "owned",
  ]);
  assert.deepEqual(prismClasses(["mf"]), ["mf"]);
  assert.deepEqual(prismClasses(undefined), []);
});
