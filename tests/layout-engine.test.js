// The layout engine's building blocks: the layered (merged view) layout, the physics' quadtree, label geometry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutGraph } from "../public/src/layout/layout-graph.js";
import { countCrossings, layeredLayout } from "../public/src/layout/layered.js";
import { CollisionGrid, Quadtree } from "../public/src/layout/physics.js";
import { labelBox, layoutLabel } from "../public/src/render/labels.js";

/** Nodes 40 × 40 unless given; the first is the root. Edges as "a>b". */
function graph(ids, edges, size = {}) {
  return new LayoutGraph(
    ids.map((id, i) => ({ id, w: 40, h: 40, ...size[id], root: i === 0 })),
    edges.map((edge) => {
      const [source, target] = edge.split(">");
      return { source, target };
    }),
  );
}

// A merged crafting graph: two products share "ecto"; "ore" is used at two depths (via "bar" and directly).
const IDS = ["result", "gift", "ingot", "bar", "ecto", "ore", "dust"];
const EDGES = [
  "result>gift",
  "result>ingot",
  "gift>ecto",
  "ingot>ecto",
  "ingot>bar",
  "bar>ore",
  "gift>dust",
  "result>ore",
];
const depthOf = (g, id) => Math.round(g.positionOf(id).y); // TB: rank along y

test("layered: every edge runs down at least one rank, whatever the ranker", () => {
  for (const ranker of ["network-simplex", "tight-tree", "longest-path"]) {
    const g = graph(IDS, EDGES);
    layeredLayout(g, { direction: "TB", ranker, rankSep: 50 });
    for (const edge of EDGES) {
      const [s, t] = edge.split(">");
      assert.ok(depthOf(g, t) > depthOf(g, s), `${ranker}: ${edge}`);
    }
  }
});

test("layered rankers: longest-path puts raw materials on the last rank, the others keep edges short", () => {
  const long = graph(IDS, EDGES);
  layeredLayout(long, { direction: "TB", ranker: "longest-path" });
  const last = Math.max(...IDS.map((id) => depthOf(long, id)));
  for (const raw of ["ecto", "ore", "dust"])
    assert.equal(depthOf(long, raw), last, `${raw} on the last rank`);

  const short = graph(IDS, EDGES);
  layeredLayout(short, { direction: "TB", ranker: "network-simplex" });
  // dust only hangs off gift, so it sits right under it rather than down with the deepest raw materials.
  assert.ok(depthOf(short, "dust") < depthOf(long, "dust"));
});

test("layered: cycles don't stop it, and the same graph always gives the same layout", () => {
  const cyclic = [...EDGES, "ecto>gift"]; // ecto → gift closes a loop
  const a = graph(IDS, cyclic),
    b = graph(IDS, cyclic);
  layeredLayout(a, { direction: "TB" });
  layeredLayout(b, { direction: "TB" });
  assert.deepEqual(a.positions(), b.positions());
  for (const id of IDS) assert.ok(Number.isFinite(a.positionOf(id).x));
});

test("layered: an avoidable crossing is removed, and nodes on a rank keep their spacing", () => {
  // Starting order puts x's children in y's order and y's in x's: the sweeps have to swap them.
  const ids = ["r", "x", "y", "x1", "y1"];
  const g = graph(ids, ["r>x", "r>y", "y>y1", "x>x1"], {
    y1: { w: 40, h: 40 },
  });
  const { crossings } = layeredLayout(g, { direction: "TB", nodeSep: 20 });
  assert.equal(crossings, 0);
  const x = (id) => g.positionOf(id).x;
  assert.equal(x("x") < x("y"), x("x1") < x("y1"), "children follow parents");
  assert.ok(Math.abs(x("x1") - x("y1")) >= 40 + 20 - 1e-9);
});

test("layered: directions follow the flow (root → ingredients)", () => {
  const cases = { TB: ["y", 1], BT: ["y", -1], LR: ["x", 1], RL: ["x", -1] };
  for (const [direction, [axis, sign]] of Object.entries(cases)) {
    const g = graph(IDS, EDGES);
    layeredLayout(g, { direction });
    const along = (id) => g.positionOf(id)[axis] * sign;
    assert.ok(along("ecto") > along("gift"), direction);
    assert.ok(along("gift") > along("result"), direction);
  }
});

test("crossings are counted exactly between neighbouring ranks", () => {
  // a─d and b─c cross; a─c doesn't cross b─c (shared end).
  const ranks = [
    ["a", "b"],
    ["c", "d"],
  ];
  const down = { a: ["d", "c"], b: ["c"], c: [], d: [] };
  const position = new Map([
    ["a", 0],
    ["b", 1],
    ["c", 0],
    ["d", 1],
  ]);
  assert.equal(countCrossings(ranks, down, position), 1);
});

test("quadtree: masses and centres of mass add up; coincident points merge", () => {
  const x = Float64Array.from([0, 10, 10, 0, 5, 5, 5]);
  const y = Float64Array.from([0, 0, 10, 10, 5, 5, 5]); // three points on (5, 5)
  const tree = new Quadtree(2); // too small on purpose: it grows
  tree.build(x, y, x.length);
  assert.equal(tree.mass[0], 7);
  assert.ok(Math.abs(tree.cx[0] - 35 / 7) < 1e-9);
  assert.ok(Math.abs(tree.cy[0] - 35 / 7) < 1e-9);
  // Rebuilt in place, with the same answer.
  tree.build(x, y, x.length);
  assert.equal(tree.mass[0], 7);
});

test("labels: the box includes padding, and sits beside, below or above the node", () => {
  const measure = (text) => text.length * 6;
  const label = layoutLabel("Mithril Ingot", { fontSize: 10 }, measure);
  assert.deepEqual(label.lines, ["Mithril Ingot"]);
  assert.equal(label.width, 13 * 6 + 8);
  assert.equal(label.height, 13 + 4);
  const right = labelBox("right", 20, 20, 100, 16);
  assert.equal(right.x1, 25);
  assert.equal(right.y1, -8);
  const below = labelBox("below", 20, 20, 100, 16);
  assert.equal(below.x1, -50);
  assert.equal(below.y1, 25);
  assert.equal(labelBox("above", 20, 20, 100, 16).y2, -25);
});

test("footprints: a share of the label's overhang on each axis", () => {
  const g = new LayoutGraph(
    [{ id: "n", w: 40, h: 40, fullW: 140, fullH: 60 }],
    [],
  );
  assert.deepEqual(g.footprint(0, 1, 1), { w: 140, h: 60 });
  assert.deepEqual(g.footprint(0, 0.5, 0), { w: 90, h: 40 });
});

test("collision grid: every point is found in its cell, negative cells and crowded tables included", () => {
  const count = 500;
  const x = new Float64Array(count),
    y = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = ((i * 37) % 101) * 13 - 600; // spread over negative and positive cells
    y[i] = ((i * 53) % 97) * 11 - 500;
  }
  const grid = new CollisionGrid(count);
  for (const cellSize of [7, 50]) {
    grid.build(x, y, count, cellSize); // rebuilt in place: the old cells mustn't leak through
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      const gx = Math.floor(x[i] / cellSize),
        gy = Math.floor(y[i] / cellSize);
      const members = [];
      for (let j = grid.first(gx, gy); j >= 0; j = grid.next[j])
        members.push(j);
      assert.ok(members.includes(i), `${i} in its cell`);
      for (const j of members) {
        assert.equal(Math.floor(x[j] / cellSize), gx);
        assert.equal(Math.floor(y[j] / cellSize), gy);
        seen.add(j);
      }
    }
    assert.equal(seen.size, count);
    assert.equal(grid.first(1e6, 1e6), -1, "an empty cell");
  }
});
