// Layout regressions, run against real (headless) Cytoscape: direction semantics, the force controls, radial
// rings, and transitions finishing cleanly.
import { test } from "node:test";
import assert from "node:assert/strict";
import cytoscape from "cytoscape";
import cytoscapeDagre from "cytoscape-dagre";
import { runLayout } from "../public/src/graph/layouts.js";
import { GraphTransition } from "../public/src/graph/graph-transition.js";
import { DEFAULT_SETTINGS } from "../public/src/config/settings-schema.js";
import { stepRange } from "../public/src/ui/range-stepper.js";

cytoscape.use(cytoscapeDagre);
// GraphTransition schedules frames with the browser's animation-frame API.
globalThis.requestAnimationFrame ??= (callback) =>
  setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame ??= clearTimeout;

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

/** Lay a tree (the sample one by default) out with these settings; returns positions by id. */
function layout(overrides, elements = ELEMENTS) {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: structuredClone(elements),
    style: [{ selector: "node", style: { width: 40, height: 40 } }],
  });
  try {
    runLayout(
      cy,
      { ...DEFAULT_SETTINGS, ...overrides },
      { hasPreviousPositions: false },
    );
    return Object.fromEntries(
      cy.nodes().map((node) => [node.id(), { ...node.position() }]),
    );
  } finally {
    cy.destroy();
  }
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
    const p = layout({ layoutEngine: "force", linkDistance: 150, linkForce });
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
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: structuredClone(ELEMENTS),
    style: [{ selector: "node", style: { width: 40, height: 40 } }],
  });
  try {
    const settings = { ...DEFAULT_SETTINGS, layoutEngine: "force" };
    const simulation = runLayout(cy, settings, { hasPreviousPositions: false });
    const before = Object.fromEntries(
      cy.nodes().map((n) => [n.id(), { ...n.position() }]),
    );
    const target = { x: before.a1.x + 600, y: before.a1.y };
    simulation.fix("a1", target); // grab a1 and drag it far to the right
    simulation.reheat(0.3);
    for (let i = 0; i < 80; i++) simulation.tick();
    simulation.apply("a1");
    const moved = (id) => cy.getElementById(id).position().x - before[id].x;
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
  } finally {
    cy.destroy();
  }
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

test("force layout: deterministic, and a stronger center force gathers it tighter", () => {
  const loose = layout({ layoutEngine: "force", centerForce: 0 });
  assert.deepEqual(
    layout({ layoutEngine: "force", centerForce: 0 }),
    loose,
    "same input, same layout",
  );
  const tight = layout({ layoutEngine: "force", centerForce: 1 });
  assert.ok(width(tight) < width(loose));
});

test("an interrupted transition leaves every node at its final position, fully visible", () => {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: structuredClone(ELEMENTS),
  });
  try {
    const transition = new GraphTransition(cy, {
      duration: 400,
      easing: "smooth",
    });
    cy.nodes().forEach((node, i) =>
      transition.moveNode(
        node,
        { x: 0, y: 0 },
        { x: i * 50, y: i * 10 },
        { fadeIn: true },
      ),
    );
    cy.edges().forEach((edge) => transition.revealEdge(edge, 100));
    transition.finish(); // e.g. a new render arrives mid-animation
    cy.nodes().forEach((node, i) => {
      assert.deepEqual(node.position(), { x: i * 50, y: i * 10 });
      assert.equal(node.style("opacity"), "1", `${node.id()} not left faded`);
    });
    cy.edges().forEach((edge) => assert.equal(edge.style("opacity"), "1"));
  } finally {
    cy.destroy();
  }
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
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    style: [{ selector: "node", style: { width: 200, height: 40 } }],
  });
  try {
    runLayout(
      cy,
      {
        ...DEFAULT_SETTINGS,
        viewMode: "tree",
        direction: "RL",
        linkDistance: 120,
      },
      { hasPreviousPositions: false },
    );
    const boxes = cy.nodes().map((node) => {
      const { x, y } = node.position();
      return {
        id: node.id(),
        x1: x - 100,
        x2: x + 100,
        y1: y - 20,
        y2: y + 20,
      };
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        const overlaps =
          Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 1 &&
          Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 1;
        assert.ok(!overlaps, `${a.id} overlaps ${b.id}`);
      }
    const x = (id) => cy.getElementById(id).position("x");
    assert.ok(
      x("a0b0") - x("a0") >= 200,
      "levels are at least a node's width apart, not the 120 px link distance",
    );
  } finally {
    cy.destroy();
  }
});
