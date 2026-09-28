// Layout regressions, run against real (headless) Cytoscape: direction semantics, radial rings, spacing behaviour,
// and transitions finishing cleanly.
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

/** Lay the sample tree out with these settings; returns positions by id. */
function layout(overrides) {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: structuredClone(ELEMENTS),
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

test("node spacing is linear in the slider: equal steps, no jumps", () => {
  for (const viewMode of ["tree", "merged"]) {
    const widths = [0.5, 0.75, 1, 1.25, 1.5].map((siblingGapScale) =>
      width(
        layout({
          viewMode,
          direction: "TB",
          siblingGapScale,
          levelGapScale: 0.15,
        }),
      ),
    );
    const steps = widths.slice(1).map((w, i) => w - widths[i]);
    assert.ok(
      steps.every((step) => step > 0),
      `${viewMode}: wider with more spacing`,
    );
    const spread = Math.max(...steps) - Math.min(...steps);
    assert.ok(
      spread < 1,
      `${viewMode}: equal steps (got ${steps.map((s) => s.toFixed(1))})`,
    );
  }
});

test("zero spacing packs siblings edge to edge without overlapping", () => {
  const p = layout({ direction: "TB", siblingGapScale: 0, levelGapScale: 0 });
  assert.ok(Math.abs(p.a1.x - p.a2.x) >= 40 - 0.01);
  assert.ok(Math.abs(p.a.y - p.a1.y) >= 40 - 0.01);
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
