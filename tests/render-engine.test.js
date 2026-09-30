import { test } from "node:test";
import assert from "node:assert/strict";
import { Spring, springFor, stepSpring } from "../public/src/render/spring.js";
import {
  resolveEdgeStyle,
  resolveLabelPosition,
  resolveNodeStyle,
  resolveRouting,
} from "../public/src/render/style-resolver.js";
import {
  arrowTemplate,
  edgeRoute,
  pointAlong,
  polylineLength,
  roundCorners,
} from "../public/src/render/edge-geometry.js";
import { planTransition } from "../public/src/render/transition-plan.js";
import { parseColor, wrapLabel } from "../public/src/render/webgl-graph.js";
import { DEFAULT_SETTINGS } from "../public/src/config/settings-schema.js";
import { FORGE_COLOR, UI_COLORS } from "../public/src/config/constants.js";

const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });

test("springs settle on their target in about the requested time, and keep velocity when retargeted", () => {
  const params = springFor(500, "smooth");
  const spring = new Spring(0, params, 0.05); // positions: 0.05 world units
  spring.set(100);
  let time = 0;
  while (spring.step(1 / 60)) time += 1 / 60;
  assert.equal(spring.value, 100);
  assert.ok(time > 0.3 && time < 0.9, `settled after ${time}s`);

  // Smooth never overshoots; bouncy does.
  const peak = (feel) => {
    const state = { value: 0, velocity: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(state, 1, 1 / 60, springFor(500, feel));
      max = Math.max(max, state.value);
    }
    return max;
  };
  assert.ok(peak("smooth") <= 1 + 1e-9);
  assert.ok(peak("bouncy") > 1.05);

  // Retargeting mid-flight bends the motion instead of restarting it.
  const moving = new Spring(0, params);
  moving.set(100);
  for (let i = 0; i < 10; i++) moving.step(1 / 60);
  const velocity = moving.velocity;
  moving.set(-100);
  assert.equal(moving.velocity, velocity);
  moving.snap(5);
  assert.equal(moving.moving, false);
});

test("springs stay stable with long frames (a background tab)", () => {
  const state = { value: 0, velocity: 0 };
  stepSpring(state, 10, 0.5, springFor(100, "snappy"));
  assert.ok(Number.isFinite(state.value) && Math.abs(state.value - 10) < 1);
});

test("node style: standing states become aura, ring, badge and card stack; page rules apply last", () => {
  const base = resolveNodeStyle(
    new Set(),
    { color: "#ff0000", label: "A" },
    settings(),
  );
  assert.equal(base.border, "#ff0000");
  assert.equal(base.pattern, "solid");
  assert.equal(base.aura, null);
  assert.equal(base.label, "A");

  const owned = resolveNodeStyle(new Set(["owned"]), {}, settings());
  assert.equal(owned.aura, UI_COLORS.owned);
  const collapsed = resolveNodeStyle(new Set(["hiddenKids"]), {}, settings());
  assert.equal(collapsed.pattern, "stack");
  const forge = resolveNodeStyle(
    new Set(["mf"]),
    {},
    settings({ forgeIndicator: "both" }),
  );
  assert.equal(forge.ring, FORGE_COLOR);
  assert.equal(forge.badge, true);
  const badgeOnly = resolveNodeStyle(
    new Set(["mf"]),
    {},
    settings({ forgeIndicator: "badge" }),
  );
  assert.equal(badgeOnly.ring, null);
  const root = resolveNodeStyle(new Set(["root"]), {}, settings());
  assert.ok(root.bold && root.labelPriority > 0);
  assert.equal(
    resolveNodeStyle(new Set(), { label: "A" }, settings({ showLabels: false }))
      .label,
    "",
  );
  const page = resolveNodeStyle(
    new Set(["owned", "overflow"]),
    {},
    settings(),
    {
      nodes: {
        overflow: { pattern: "dashed", fillAlpha: 0.4, aura: "#123456" },
      },
    },
  );
  assert.deepEqual(
    [page.pattern, page.fillAlpha, page.aura],
    ["dashed", 0.4, "#123456"],
  );
});

test("edge style: colour mode, arrows per end, forge edges, quantity labels, page rules", () => {
  const data = { label: "×3", sourceColor: "#111111", targetColor: "#222222" };
  assert.equal(
    resolveEdgeStyle(new Set(), data, settings({ edgeColorMode: "child" }))
      .color,
    "#222222",
  );
  assert.equal(
    resolveEdgeStyle(new Set(), data, settings({ edgeColorMode: "parent" }))
      .color,
    "#111111",
  );
  const productEnd = resolveEdgeStyle(
    new Set(),
    data,
    settings({ arrowEnd: "product" }),
  );
  assert.equal(productEnd.arrowAtSource, DEFAULT_SETTINGS.arrowShape);
  assert.equal(productEnd.arrowAtTarget, null);
  const both = resolveEdgeStyle(
    new Set(),
    data,
    settings({ arrowEnd: "both" }),
  );
  assert.ok(both.arrowAtSource && both.arrowAtTarget);
  assert.equal(
    resolveEdgeStyle(new Set(), data, settings({ showArrows: false }))
      .arrowAtSource,
    null,
  );
  const forge = resolveEdgeStyle(
    new Set(["mf"]),
    data,
    settings({ highlightForgeEdges: true }),
  );
  assert.deepEqual([forge.color, forge.pattern], [FORGE_COLOR, "dashed"]);
  assert.equal(
    resolveEdgeStyle(new Set(), data, settings({ edgeQuantityLabels: "on" }))
      .label,
    "×3",
  );
  assert.equal(
    resolveEdgeStyle(new Set(), data, settings({ edgeQuantityLabels: "off" }))
      .label,
    "",
  );
  const best = resolveEdgeStyle(new Set(["best-route"]), data, settings(), {
    edges: { "best-route": { color: "#e5b83b", width: 3, glow: true } },
  });
  assert.deepEqual([best.color, best.width, best.glow], ["#e5b83b", 3, true]);
});

test("labels sit where the layout leaves room; routing follows the layout", () => {
  assert.equal(
    resolveLabelPosition(settings({ labelPosition: "auto", direction: "RL" })),
    "right",
  );
  assert.equal(
    resolveLabelPosition(settings({ labelPosition: "auto", direction: "LR" })),
    "left",
  );
  assert.equal(
    resolveLabelPosition(settings({ labelPosition: "auto", direction: "BT" })),
    "below",
  );
  assert.equal(
    resolveLabelPosition(settings({ labelPosition: "above" })),
    "above",
  );
  assert.equal(
    resolveRouting(settings({ edgeRouting: "taxi", direction: "BT" })),
    "taxi",
  );
  assert.equal(
    resolveRouting(settings({ edgeRouting: "round-taxi", direction: "BT" })),
    "round-taxi",
  );
  assert.equal(
    resolveRouting(settings({ edgeRouting: "bezier", direction: "BT" })),
    "s-curve",
  );
  assert.equal(
    resolveRouting(settings({ edgeRouting: "taxi", direction: "radial" })),
    "arc",
  );
  assert.equal(
    resolveRouting(settings({ edgeRouting: "straight", direction: "radial" })),
    "straight",
  );
});

test("edge routes: rounded corners, s-curves and arcs start and end on the node borders", () => {
  const a = { x: 0, y: 0, hw: 10, hh: 10 },
    b = { x: 100, y: 60, hw: 10, hh: 10 };
  for (const routing of ["round-taxi", "s-curve"]) {
    const points = edgeRoute(a, b, { routing, flowAxis: "x", cornerRadius: 8 });
    assert.deepEqual(points[0], { x: 10, y: 0 }, routing);
    assert.deepEqual(points.at(-1), { x: 90, y: 60 }, routing);
    assert.ok(points.length > 4, `${routing} is curved`);
  }
  const arc = edgeRoute(a, b, { routing: "arc" });
  const middle = pointAlong(arc, polylineLength(arc) / 2);
  const chord = { x: 50, y: 30 };
  assert.ok(
    Math.hypot(middle.x - chord.x, middle.y - chord.y) > 5,
    "an arc bows off the straight line",
  );

  // Short pieces get smaller corners, never overlapping ones.
  const rounded = roundCorners(
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 100 },
    ],
    20,
  );
  assert.ok(rounded.every((p) => p.x >= 0 && p.x <= 4));
  assert.deepEqual(
    pointAlong(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      99,
    ),
    { x: 10, y: 0 },
  );
});

test("arrowheads: every shape is whole triangles with its tip at the origin", () => {
  for (const shape of [
    "triangle",
    "vee",
    "chevron",
    "triangle-backcurve",
    "circle",
    "square",
    "tee",
    "unknown",
  ]) {
    const { triangles, inset } = arrowTemplate(shape);
    assert.equal(triangles.length % 3, 0, shape);
    assert.ok(inset >= 0 && inset <= 1, shape);
    assert.ok(
      triangles.every(([back]) => back >= -0.05),
      `${shape} stays behind the tip`,
    );
  }
});

test("transition plan: new nodes grow out of their nearest shown ancestor; removed ones fold into theirs", () => {
  const previous = new Map([
    ["r", { x: 0, y: 0 }],
    ["r/0", { x: 10, y: 0 }],
    ["r/0/1", { x: 20, y: 0 }],
    ["gone", { x: 99, y: 99 }],
  ]);
  const parentOf = new Map([
    ["r/0", "r"],
    ["r/0/5", "r/0"],
    ["r/0/5/2", "r/0/5"],
  ]);
  const plan = planTransition({
    previous,
    nodeIds: ["r", "r/0", "r/0/5", "r/0/5/2"],
    parentOf,
    previousParentOf: new Map([["gone", "r/0"]]),
    rootId: "r",
  });
  assert.deepEqual(
    plan.startOf("r/0"),
    { x: 10, y: 0 },
    "survivors start where they are",
  );
  assert.deepEqual(
    plan.startOf("r/0/5/2"),
    { x: 10, y: 0 },
    "grandchildren grow from the nearest shown ancestor",
  );
  const final = new Map([
    ["r", { x: 0, y: 50 }],
    ["r/0", { x: 10, y: 50 }],
  ]);
  const ghosts = plan.ghostDestinations(final);
  assert.deepEqual(ghosts.get("r/0/1"), { x: 10, y: 50 }, "by tree path");
  assert.deepEqual(
    ghosts.get("gone"),
    { x: 10, y: 50 },
    "by the old graph's links",
  );
  assert.ok(!ghosts.has("r/0"), "survivors aren't ghosts");

  const cyclic = planTransition({
    previous: new Map(),
    nodeIds: ["a", "b"],
    parentOf: new Map([
      ["a", "b"],
      ["b", "a"],
    ]),
  });
  assert.equal(cyclic.startOf("a"), null, "cycles end the walk");
});

test("labels wrap by width, keep their own line breaks, or are cut with an ellipsis", () => {
  const measure = (text) => text.length * 6;
  assert.deepEqual(wrapLabel("250 × Mithril Ingot", 60, "wrap", measure), [
    "250 ×",
    "Mithril",
    "Ingot",
  ]);
  assert.deepEqual(wrapLabel("short\n(have 3)", 100, "wrap", measure), [
    "short",
    "(have 3)",
  ]);
  const [cut] = wrapLabel("A very long item name", 60, "ellipsis", measure);
  assert.ok(cut.endsWith("…") && measure(cut) <= 60);
  assert.deepEqual(wrapLabel("no limit", 0, "wrap", measure), ["no limit"]);
});

test("colours parse from #rrggbb and #rgb", () => {
  assert.deepEqual(parseColor("#ff0000"), [1, 0, 0]);
  assert.deepEqual(parseColor("#0f0"), [0, 1, 0]);
  assert.equal(parseColor("nonsense").length, 3);
});
