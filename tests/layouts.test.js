// Layout regressions on plain data (no renderer): direction semantics, the force controls, radial rings, spacing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutGraph } from "tether/layout-graph.js";
import { runLayout as layOut } from "tether/run-layout.js";
import { layoutSettings } from "../web/src/render/prism-settings.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";
import { stepRange } from "../web/src/ui/range-stepper.js";

/** Tether's runLayout with the app's settings, the way the pages call it. */
const runLayout = (graph, settings, context) =>
  layOut(graph, layoutSettings(settings), context);

// result ← a ← (a1, a2); result ← b ← b1. Edges run product → ingredient, as in the app.
const ELEMENTS = [
  { data: { id: "result" }, classes: "root" },
  ...["a", "b", "a1", "a2", "b1"].map((id) => ({ data: { id } })),
  ...[
    ["result", "a"],
    ["result", "b"],
    ["a", "a1"],
    ["a", "a2"],
    ["b", "b1"],
  ].map(([source, target]) => ({
    data: { id: `${source}->${target}`, source, target },
  })),
];
const RAW = ["a1", "a2", "b1"];

/** The layout graph for elements in the app's shape (nodes `size` × `size`, or `w` × `h`). */
function graphOf(elements, { w = 40, h = 40 } = {}) {
  return new LayoutGraph(
    elements
      .filter((e) => !e.data.source)
      .map((e) => ({
        id: e.data.id,
        w,
        h,
        root: String(e.classes ?? "").includes("root"),
      })),
    elements
      .filter((e) => e.data.source)
      .map((e) => ({ source: e.data.source, target: e.data.target })),
  );
}

/** Lay a tree (the sample one by default) out with these settings; returns positions by id. */
function layout(overrides, elements = ELEMENTS) {
  const graph = graphOf(elements);
  runLayout(
    graph,
    { ...DEFAULT_SETTINGS, ...overrides },
    { hasPreviousPositions: false },
  );
  return Object.fromEntries(graph.positions());
}

const width = (positions) => {
  const xs = Object.values(positions).map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
};

for (const viewMode of ["tree", "merged"]) {
  test(`direction names the crafting flow, raw materials → result (${viewMode} view)`, () => {
    // For each direction: which axis, and whether the result has the larger coordinate.
    const cases = {
      LR: ["x", true],
      RL: ["x", false],
      TB: ["y", true],
      BT: ["y", false],
    };
    for (const [direction, [axis, resultIsGreater]] of Object.entries(cases)) {
      const p = layout({ viewMode, direction });
      for (const id of RAW)
        assert.equal(
          p.result[axis] > p[id][axis],
          resultIsGreater,
          `${direction}: the result should be ${resultIsGreater ? "after" : "before"} ${id} on ${axis}`,
        );
    }
  });
}

test("radial: result in the centre, every level on a wider ring", () => {
  const p = layout({ direction: "radial" });
  const radius = (id) => Math.hypot(p[id].x - p.result.x, p[id].y - p.result.y);
  assert.ok(radius("a") > 0 && radius("b") > 0);
  for (const id of RAW)
    assert.ok(
      radius(id) > radius("a"),
      `${id} is further out than its product`,
    );
  // Nodes on one ring don't overlap (40px nodes).
  assert.ok(Math.hypot(p.a1.x - p.a2.x, p.a1.y - p.a2.y) >= 40);
});

test("repel is the spacing control: stronger repel spreads siblings further", () => {
  for (const viewMode of ["tree", "merged"]) {
    const widths = [2, 8, 16].map((repelForce) =>
      width(layout({ viewMode, direction: "TB", repelForce })),
    );
    assert.ok(
      widths[0] < widths[1] && widths[1] < widths[2],
      `${viewMode}: ${widths.map(Math.round)}`,
    );
  }
});

test("layered: levels sit about one link distance apart", () => {
  const p = layout({ direction: "TB", linkDistance: 150 });
  for (const [upper, lower] of [
    ["a1", "a"],
    ["a", "result"],
  ]) {
    const gap = p[lower].y - p[upper].y;
    assert.ok(
      Math.abs(gap - 150) < 15,
      `${upper} → ${lower}: ${Math.round(gap)}`,
    );
  }
});

test("link strength pulls links toward the link distance (stronger = closer)", () => {
  const edgeError = (linkForce) => {
    const p = layout({ direction: "radial", linkDistance: 150, linkForce });
    const lengths = ELEMENTS.filter((e) => e.data.source).map((e) =>
      Math.hypot(
        p[e.data.source].x - p[e.data.target].x,
        p[e.data.source].y - p[e.data.target].y,
      ),
    );
    return (
      lengths.reduce((sum, length) => sum + Math.abs(length - 150), 0) /
      lengths.length
    );
  };
  assert.ok(
    edgeError(1) < edgeError(0.1),
    `strong ${edgeError(1).toFixed(1)} vs weak ${edgeError(0.1).toFixed(1)}`,
  );
});

test("dragging a node pulls its neighbours along (live physics)", () => {
  const graph = graphOf(ELEMENTS);
  // Floating on a tree: levels hold the vertical, so a sideways drag shows the pull clearly.
  const settings = {
    ...DEFAULT_SETTINGS,
    direction: "TB",
    physicsMode: "floating",
  };
  const simulation = runLayout(graph, settings, {
    hasPreviousPositions: false,
  });
  const before = Object.fromEntries(graph.positions());
  const target = { x: before.a1.x + 600, y: before.a1.y };
  simulation.fix("a1", target); // grab a1 and drag it far to the right
  simulation.reheat(0.3);
  for (let i = 0; i < 80; i++) simulation.tick();
  const moved = (id) =>
    simulation.x[simulation.indexById.get(id)] - before[id].x;
  assert.ok(
    moved("a") > 100,
    `a1's product follows (${Math.round(moved("a"))}px)`,
  );
  assert.ok(
    moved("a") > moved("b1"),
    "direct neighbours move more than distant nodes",
  );
  simulation.release("a1");
  simulation.reheat(0);
  for (let i = 0; i < 400 && simulation.isActive; i++) simulation.tick();
  assert.ok(!simulation.isActive, "it settles after release");
});

test("siblings never overlap, even with no repel", () => {
  const p = layout({ direction: "TB", repelForce: 0, centerForce: 1 });
  assert.ok(Math.abs(p.a1.x - p.a2.x) >= 40 - 0.01);
  assert.ok(Math.abs(p.a.x - p.b.x) >= 40 - 0.01);
});

test("radial rings are evenly spaced by link distance, even when outer rings are crowded", () => {
  // result → 3 products → 6 ingredients each → 3 raw materials each: 54 nodes on the outer ring.
  const elements = [{ data: { id: "r" }, classes: "root" }];
  const link = (source, target) =>
    elements.push(
      { data: { id: target }, classes: "" },
      { data: { id: `${source}>${target}`, source, target } },
    );
  for (let a = 0; a < 3; a++) {
    link("r", `a${a}`);
    for (let b = 0; b < 6; b++) {
      link(`a${a}`, `a${a}b${b}`);
      for (let c = 0; c < 3; c++) link(`a${a}b${b}`, `a${a}b${b}c${c}`);
    }
  }
  const p = layout({ direction: "radial", linkDistance: 150 }, elements);
  const meanRadius = (depth) => {
    const ids = Object.keys(p).filter(
      (id) => id !== "r" && (id.match(/[abc]/g) ?? []).length === depth,
    );
    return (
      ids.reduce(
        (sum, id) => sum + Math.hypot(p[id].x - p.r.x, p[id].y - p.r.y),
        0,
      ) / ids.length
    );
  };
  const rings = [1, 2, 3].map(meanRadius);
  // Each ring within 15% of depth × distance (busy rings bulge a little), and evenly stepped: no ring flung outward.
  const steps = rings.map((radius, i) => radius - (rings[i - 1] ?? 0));
  assert.ok(
    Math.max(...steps) / Math.min(...steps) < 1.3,
    `even steps (${steps.map(Math.round)})`,
  );
  for (const [i, radius] of rings.entries())
    assert.ok(
      Math.abs(radius - (i + 1) * 150) < (i + 1) * 150 * 0.15,
      `ring ${i + 1} at ${Math.round(radius)}, expected about ${(i + 1) * 150} (${rings.map(Math.round)})`,
    );
});

test("both layouts, both physics modes: the same input always gives the same layout", () => {
  for (const direction of ["TB", "radial"])
    for (const physicsMode of ["elastic", "floating"])
      assert.deepEqual(
        layout({ direction, physicsMode }),
        layout({ direction, physicsMode }),
        `${direction}, ${physicsMode}`,
      );
});

test("−/+ steps land exactly on the slider's grid and stop at its ends", () => {
  const input = { min: "0", max: "6", step: "0.05", value: "0.7" };
  assert.ok(stepRange(input, 1));
  assert.equal(input.value, "0.75", "no floating-point drift (0.7 + 0.05)");
  input.value = "6";
  assert.equal(stepRange(input, 1), false, "already at the maximum");
  assert.equal(input.value, "6");
});

test("left-right layouts with wide nodes: levels make room, and nothing overlaps", () => {
  // A root with 3 products, each with 30: wider nodes (standing in for labels beside them) than the level gap.
  const ids = ["r"];
  const edges = [];
  for (let a = 0; a < 3; a++) {
    ids.push(`a${a}`);
    edges.push(["r", `a${a}`]);
    for (let b = 0; b < 30; b++) {
      ids.push(`a${a}b${b}`);
      edges.push([`a${a}`, `a${a}b${b}`]);
    }
  }
  const elements = [
    ...ids.map((id) => ({ data: { id }, classes: id === "r" ? "root" : "" })),
    ...edges.map(([source, target]) => ({
      data: { id: `${source}->${target}`, source, target },
    })),
  ];
  const graph = graphOf(elements, { w: 200, h: 40 });
  runLayout(
    graph,
    {
      ...DEFAULT_SETTINGS,
      viewMode: "tree",
      direction: "RL",
      linkDistance: 120,
    },
    { hasPreviousPositions: false },
  );
  const boxes = graph.ids.map((id, i) => ({
    id,
    x1: graph.x[i] - 100,
    x2: graph.x[i] + 100,
    y1: graph.y[i] - 20,
    y2: graph.y[i] + 20,
  }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const overlaps =
        Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 1 &&
        Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 1;
      assert.ok(!overlaps, `${a.id} overlaps ${b.id}`);
    }
  const x = (id) => graph.positionOf(id).x;
  assert.ok(
    x("a0b0") - x("a0") >= 200,
    "levels are at least a node's width apart, not the 120 px link distance",
  );
});

test("waking the physics (a drag, a tap) doesn't slide the graph", () => {
  // Layouts don't centre on the origin; when the physics wakes up it must not care where the graph sits. (It used
  // to pull toward (0, 0), so a tap slid a graph lying far from it across the screen.)
  const drift = (overrides, offset) => {
    const graph = graphOf(ELEMENTS);
    const simulation = runLayout(
      graph,
      { ...DEFAULT_SETTINGS, ...overrides },
      { hasPreviousPositions: false },
    );
    simulation.setPositions((id) => {
      const p = graph.positionOf(id);
      return { x: p.x + offset, y: p.y + offset / 2 };
    });
    const middle = () =>
      simulation.x.reduce((sum, x) => sum + x, 0) / simulation.count;
    const before = middle();
    simulation.reheat(0.3);
    for (let i = 0; i < 120; i++) simulation.tick();
    return middle() - before;
  };
  for (const overrides of [
    { direction: "TB" },
    { viewMode: "merged", direction: "LR" },
    { direction: "radial", physicsMode: "floating" },
  ]) {
    const near = drift(overrides, 0),
      far = drift(overrides, 3000);
    assert.ok(
      Math.abs(far - near) < 1,
      `${JSON.stringify(overrides)}: ${far.toFixed(1)} far away vs ${near.toFixed(1)} at the origin`,
    );
    // Nor does it slide on its own (uneven link pulls and the approximate repulsion used to push it along). Radial
    // pins the result in the middle, and its rings pull on the rest from there: a little more give.
    const allowed = overrides.direction === "radial" ? 5 : 2;
    assert.ok(Math.abs(far) < allowed, `${JSON.stringify(overrides)}: ${far}`);
  }
});

test("floating: grabbing a node moves nothing by itself, a small nudge is absorbed, and a real drag pulls its product", () => {
  // result → 3 products → 6 ingredients each.
  const elements = [{ data: { id: "r" }, classes: "root" }];
  for (let a = 0; a < 3; a++) {
    elements.push(
      { data: { id: `a${a}` } },
      { data: { id: `r>a${a}`, source: "r", target: `a${a}` } },
    );
    for (let b = 0; b < 6; b++)
      elements.push(
        { data: { id: `a${a}b${b}` } },
        { data: { id: `a${a}>b${b}`, source: `a${a}`, target: `a${a}b${b}` } },
      );
  }
  const grab = (direction, nudge) => {
    const graph = graphOf(elements, { w: 60, h: 40 });
    const simulation = runLayout(graph, {
      ...DEFAULT_SETTINGS,
      direction,
      physicsMode: "floating",
    });
    const before = new Map(graph.positions());
    // What the view does on a floating drag: start from what's on screen, heat up, hold that as rest, fix the node.
    simulation.setPositions((id) => graph.positionOf(id));
    simulation.reheat(simulation.tuning.dragHeat);
    simulation.holdRest();
    const leaf = simulation.indexById.get("a0b0");
    simulation.fix("a0b0", {
      x: simulation.x[leaf] + nudge,
      y: simulation.y[leaf],
    });
    for (let i = 0; i < 90; i++) simulation.tick();
    return new Map(
      simulation.ids.map((id, i) => [
        id,
        Math.hypot(
          simulation.x[i] - before.get(id).x,
          simulation.y[i] - before.get(id).y,
        ),
      ]),
    );
  };
  for (const direction of ["TB", "radial"]) {
    const held = grab(direction, 0);
    assert.ok(
      Math.max(...held.values()) < 1e-6,
      `${direction}: grabbing alone moved something ${Math.max(...held.values())}`,
    );
    // Tether's dead zone keeps barely-pushed nodes still, so a small nudge stays in the leaf's own branch.
    const nudged = grab(direction, 8);
    const elsewhere = [...nudged].filter(([id]) => !id.startsWith("a0"));
    const most = Math.max(...elsewhere.map(([, d]) => d));
    assert.ok(
      most < 1,
      `${direction}: a nudge moved other branches up to ${most.toFixed(2)}`,
    );
    const dragged = grab(direction, 40);
    assert.ok(
      dragged.get("a0") > 0.1,
      `${direction}: a real drag reaches the leaf's product`,
    );
  }
});
