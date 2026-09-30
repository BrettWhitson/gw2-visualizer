import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../public/src/render/camera.js";
import { SpatialGrid } from "../public/src/render/spatial-grid.js";
import { AtlasPacker } from "../public/src/render/atlas-packer.js";
import {
  arrowHead,
  boxExit,
  edgePoints,
  pointsBounds,
} from "../public/src/render/edge-geometry.js";

const close = (actual, expected, message, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${message}: ${actual} ≠ ${expected}`,
  );

test("camera: screen ↔ world, zooming around a point keeps it still", () => {
  const camera = new Camera();
  camera.panBy(100, 50);
  assert.deepEqual(camera.toScreen(10, 10), { x: 110, y: 60 });
  const before = camera.toWorld(300, 200);
  camera.zoomAround(2, 300, 200);
  const after = camera.toWorld(300, 200);
  close(after.x, before.x, "x");
  close(after.y, before.y, "y");
  assert.equal(camera.zoom, 2);
  camera.zoomAround(1e9, 0, 0);
  assert.equal(camera.zoom, camera.maxZoom, "zoom is limited");
});

test("camera: fit centres the box and caps the zoom", () => {
  const camera = new Camera();
  camera.fit({ x1: 0, y1: 0, x2: 1000, y2: 500 }, 600, 400, { padding: 50 });
  close(camera.zoom, 0.5, "the wider side decides");
  const centre = camera.toScreen(500, 250);
  close(centre.x, 300, "centred x");
  close(centre.y, 200, "centred y");
  camera.fit({ x1: 0, y1: 0, x2: 10, y2: 10 }, 600, 400);
  assert.equal(camera.zoom, 1.6, "a tiny graph isn't blown up");
});

test("camera: the clip matrix maps the viewport corners to clip space", () => {
  const camera = new Camera();
  camera.panBy(20, 10);
  camera.zoom = 2;
  const m = camera.clipMatrix(400, 200);
  const clip = (x, y) => [
    m[0] * x + m[3] * y + m[6],
    m[1] * x + m[4] * y + m[7],
  ];
  const topLeft = camera.toWorld(0, 0);
  const bottomRight = camera.toWorld(400, 200);
  const [ax, ay] = clip(topLeft.x, topLeft.y);
  const [bx, by] = clip(bottomRight.x, bottomRight.y);
  close(ax, -1, "left", 1e-6); // 32-bit floats
  close(ay, 1, "top", 1e-6); // 32-bit floats
  close(bx, 1, "right", 1e-6); // 32-bit floats
  close(by, -1, "bottom", 1e-6); // 32-bit floats
});

test("spatial grid: queries find overlapping boxes once; hits prefer the topmost", () => {
  const grid = new SpatialGrid(100);
  grid.insert(0, { x1: 0, y1: 0, x2: 50, y2: 50 });
  grid.insert(1, { x1: 40, y1: 40, x2: 260, y2: 90 }); // spans three cells
  grid.insert(2, { x1: 1000, y1: 1000, x2: 1050, y2: 1050 });
  assert.deepEqual(
    [...grid.query({ x1: 30, y1: 30, x2: 300, y2: 300 })].sort(),
    [0, 1],
  );
  assert.equal(grid.hit(45, 45), 1, "the later box is on top");
  assert.equal(grid.hit(10, 10), 0);
  assert.equal(grid.hit(500, 500), -1);
  assert.deepEqual(
    [...grid.query({ x1: -1e6, y1: -1e6, x2: 1e6, y2: 1e6 })].sort(),
    [0, 1, 2],
    "zoomed far out: everything",
  );
});

test("atlas packer: rows, then new shelves, then new pages", () => {
  const packer = new AtlasPacker(100, 0);
  assert.deepEqual(packer.place(40, 20), { page: 0, x: 0, y: 0 });
  assert.deepEqual(packer.place(40, 30), { page: 0, x: 40, y: 0 });
  assert.deepEqual(
    packer.place(40, 10),
    { page: 0, x: 0, y: 30 },
    "a new shelf under the tallest",
  );
  packer.place(100, 60); // fills the page
  assert.deepEqual(packer.place(10, 10), { page: 1, x: 0, y: 0 });
  assert.equal(packer.place(200, 10), null, "too big for any page");
});

test("edges attach to box borders; taxi edges bend in the middle; arrows point at the tip", () => {
  assert.deepEqual(boxExit(0, 0, 10, 5, 100, 0), { x: 10, y: 0 });
  assert.deepEqual(boxExit(0, 0, 10, 5, 0, -100), { x: 0, y: -5 });
  const a = { x: 0, y: 0, hw: 10, hh: 10 },
    b = { x: 100, y: 100, hw: 10, hh: 10 };
  assert.deepEqual(edgePoints(a, b, "taxi", "y"), [
    { x: 0, y: 10 },
    { x: 0, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 90 },
  ]);
  assert.deepEqual(edgePoints(a, b, "taxi", "x"), [
    { x: 10, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 100 },
    { x: 90, y: 100 },
  ]);
  const [tip, left, right] = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
  assert.deepEqual(tip, { x: 10, y: 0 });
  assert.deepEqual([left.x, right.x], [6, 6]);
  assert.deepEqual(
    pointsBounds(
      [
        { x: 1, y: 5 },
        { x: -2, y: 3 },
      ],
      1,
    ),
    { x1: -3, y1: 2, x2: 2, y2: 6 },
  );
});

test("spatial grid: moving a box in place answers like a freshly built grid", () => {
  const boxAt = (x, y) => ({ x1: x - 10, y1: y - 10, x2: x + 10, y2: y + 10 });
  const positions = [...Array(40).keys()].map((i) => [
    (i % 8) * 30,
    Math.floor(i / 8) * 30,
  ]);
  const moved = new SpatialGrid(50);
  positions.forEach(([x, y], i) => moved.insert(i, boxAt(x, y)));
  // Move a few, one of them on top of another (index order decides which is on top).
  positions[3] = [500, 500];
  positions[12] = positions[13];
  positions[39] = [-200, 35];
  for (const i of [3, 12, 39]) moved.move(i, boxAt(...positions[i]));
  const fresh = new SpatialGrid(50);
  positions.forEach(([x, y], i) => fresh.insert(i, boxAt(x, y)));
  for (const area of [
    { x1: -300, y1: -300, x2: 600, y2: 600 },
    { x1: 0, y1: 0, x2: 60, y2: 60 },
    { x1: 480, y1: 480, x2: 520, y2: 520 },
  ])
    assert.deepEqual(
      [...moved.query(area)].sort((a, b) => a - b),
      [...fresh.query(area)].sort((a, b) => a - b),
    );
  for (const [x, y] of [positions[13], [500, 500], [-200, 35], [90, 0]])
    assert.equal(moved.hit(x, y), fresh.hit(x, y));
  assert.equal(moved.hit(...positions[13]), 13, "the higher index is on top");
});
