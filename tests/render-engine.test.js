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
import {
  InstanceData,
  NODE_FLOATS,
} from "../public/src/render/instance-data.js";
import {
  flickVelocity,
  parseColor,
  wrapLabel,
} from "../public/src/render/webgl-graph.js";
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

test("colour fades: nodes and edges blend from the old colours to the new ones", () => {
  const value = (v) => ({ value: v });
  const node = {
    id: "n",
    px: value(0),
    py: value(0),
    alpha: value(1),
    scale: value(1),
    glow: value(0),
    hw: 20,
    hh: 20,
    fill: [1, 0, 0, 1],
    border: [1, 1, 1, 1],
    aura: [0, 0, 0, 0],
    ring: [0, 0, 0, 0],
    glowColor: [1, 1, 1],
    style: {},
    colorFrom: {
      fill: [0, 0, 1, 1],
      border: [1, 1, 1, 1],
      aura: [0, 0, 0, 0],
      ring: [0, 0, 0, 0],
    },
    colorMix: value(0.25),
  };
  const other = { ...node, id: "m", colorFrom: null, colorMix: null };
  const edge = {
    id: "e",
    source: node,
    target: other,
    alpha: value(1),
    emphasis: value(0),
    color: [0, 1, 0],
    colorFrom: { color: [1, 0, 0] },
    colorMix: value(0.5),
    style: { width: 2 },
  };
  const data = new InstanceData();
  data.rebuild({
    ghosts: [],
    nodes: [node, other],
    edges: [edge],
    top: [],
    layout: { routing: "straight" },
    iconUv: () => null,
  });
  const fill = [...data.nodes.data.subarray(4, 8)];
  assert.deepEqual(fill, [0.25, 0, 0.75, 1], "a quarter of the way to red");
  const edgeColor = [...data.edges.data.subarray(4, 7)];
  assert.deepEqual(edgeColor, [0.5, 0.5, 0], "halfway to green");
});

test("a flick glides at the speed of the last moves; holding still before letting go does not", () => {
  const moves = [0, 16, 32, 48, 64].map((at) => ({ at, dx: 20, dy: -5 }));
  const { vx, vy } = flickVelocity(moves, 70);
  assert.ok(
    Math.abs(vx - 1250) < 1 && Math.abs(vy + 312.5) < 1,
    `${vx}, ${vy}`,
  );
  // Same moves, let go 400 ms later: they're stale.
  assert.equal(flickVelocity(moves, 464), null);
  // A slow drag or a single move stops without a glide.
  const slow = [0, 40, 80].map((at) => ({ at, dx: 1, dy: 0 }));
  assert.equal(flickVelocity(slow, 85), null);
  assert.equal(flickVelocity([{ at: 0, dx: 50, dy: 0 }], 5), null);
});

test("instance data: moving a few records rewrites them in place, matching a full rebuild", () => {
  const value = (v) => ({ value: v });
  const node = (id, x, y) => ({
    id,
    px: value(x),
    py: value(y),
    alpha: value(1),
    scale: value(1),
    glow: value(0),
    hw: 20,
    hh: 20,
    fill: [0.1, 0.1, 0.2, 1],
    border: [1, 0.5, 0, 1],
    aura: [0, 0, 0, 0],
    ring: [0, 0, 0, 0],
    glowColor: [1, 1, 1],
    style: { shape: "round-rectangle", icon: "a.png" },
  });
  const edge = (id, source, target) => ({
    id,
    source,
    target,
    alpha: value(1),
    emphasis: value(0),
    emphasisState: null,
    color: [0.3, 0.3, 0.4],
    style: { width: 1.6, arrowAtTarget: "triangle" },
  });
  const [root, a, b, c] = [
    node("root", 0, 0),
    node("a", 200, -80),
    node("b", 200, 80),
    node("c", 400, 80),
  ];
  const edges = [edge("e1", root, a), edge("e2", root, b), edge("e3", b, c)];
  const layout = { routing: "round-taxi", flowAxis: "x", cornerRadius: 10 };
  const scene = {
    ghosts: [],
    nodes: [root, a, b, c],
    edges,
    top: [],
    layout,
    iconUv: (url) => (url === "a.png" ? [0, 0, 0.5, 0.5] : null),
  };
  const snapshot = (data) => ({
    nodes: [...data.nodes.data.subarray(0, data.nodes.length)],
    edges: [...data.edges.data.subarray(0, data.edges.length)],
    arrows: [...data.arrows.get("triangle").data.subarray(0, 9 * 3)],
  });

  const incremental = new InstanceData();
  incremental.rebuild(scene);
  incremental.nodes.takeDirty();
  incremental.edges.takeDirty();

  // b glows and slides right; its two edges follow. a, c and e1 stay untouched.
  b.glow.value = 0.6;
  b.scale.value = 1.06;
  b.px.value = 215;
  assert.equal(incremental.update(new Set([b]), scene), true);
  const nodesDirty = incremental.nodes.takeDirty();
  assert.deepEqual(nodesDirty, [2 * NODE_FLOATS, 3 * NODE_FLOATS]);
  assert.equal(edges[0].routeKey[2], 0, "e1 was not re-routed");

  const full = new InstanceData();
  full.rebuild(scene);
  assert.deepEqual(snapshot(incremental), snapshot(full));

  // Lifting a node (hover, selection) needs no rebuild: its slot hides it and the top run draws it last.
  const lifted = { ...scene, top: ["b"] };
  assert.equal(incremental.update(new Set(), lifted), true);
  const alphaAt = (list, slot) => list.data[slot * NODE_FLOATS + 32];
  assert.equal(alphaAt(incremental.nodes, b.slot), 0, "hidden in its slot");
  assert.equal(incremental.topNodes.length, NODE_FLOATS);
  assert.equal(incremental.topNodes.data[0], b.px.value, "drawn on top");
  const liftedFull = new InstanceData();
  liftedFull.rebuild(lifted);
  assert.deepEqual(snapshot(incremental), snapshot(liftedFull));
  // Selected and hovered being the same node is still one node on top; dropping it shows its slot again.
  assert.equal(
    incremental.update(new Set([b]), { ...scene, top: ["b", "b"] }),
    true,
  );
  assert.equal(incremental.update(new Set(), scene), true);
  assert.equal(alphaAt(incremental.nodes, b.slot), 1);
  assert.equal(incremental.topNodes.length, 0);
  // An edge bending into a different number of pieces (b→c was straight) needs a rebuild…
  b.py.value = 95;
  assert.equal(incremental.update(new Set([b]), scene), false);
  // …or fading out of sight.
  b.py.value = 80;
  incremental.rebuild(scene);
  edges[2].alpha.value = 0;
  assert.equal(incremental.update(new Set([edges[2]]), scene), false);
  // Records from an older graph are skipped.
  const gone = node("gone", 0, 0);
  assert.equal(incremental.update(new Set([gone]), scene), true);
});
