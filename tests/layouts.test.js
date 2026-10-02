// The layouts the settings ask for, laid out by Prismatrix without a screen (prismatrix/layout): which way the
// crafting flow runs, radial rings, the merged view sharing ingredients, room for labels, and the same drawing every
// time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph } from "prismatrix/layout";
import {
  layoutSettings,
  modelOptions,
} from "../web/src/render/prism-settings.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";

const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });

/** result → gift, ingot; gift → ore, ingot (the ingot is shared); ingot → ore */
const RECIPE = {
  nodes: ["result", "gift", "ingot", "ore"].map((id) => ({
    id,
    label: `${id} with a long enough name`,
  })),
  edges: [
    ["result", "gift"],
    ["result", "ingot"],
    ["gift", "ore"],
    ["gift", "ingot"],
    ["ingot", "ore"],
  ].map(([source, target]) => ({ source, target })),
};

/** A tree (no sharing): result → a, b, c; a → a1, a2 */
const TREE = {
  nodes: ["result", "a", "b", "c", "a1", "a2"].map((id) => ({
    id,
    label: `Item ${id} with a name`,
  })),
  edges: [
    ["result", "a"],
    ["result", "b"],
    ["result", "c"],
    ["a", "a1"],
    ["a", "a2"],
  ].map(([source, target]) => ({ source, target })),
};

function laidOut(graph, overrides) {
  const s = settings(overrides);
  const { layout, layoutOptions } = layoutSettings(s);
  const { node, edge } = modelOptions(s);
  return layoutGraph(graph, { layout, layoutOptions, node, edge });
}

test("directions name the crafting flow: raw materials toward the result", () => {
  const at = (direction) => {
    const { positions } = laidOut(TREE, { direction });
    return { result: positions.get("result"), raw: positions.get("a1") };
  };
  let p = at("BT");
  assert.ok(p.result.y < p.raw.y, "BT: the result on top");
  p = at("TB");
  assert.ok(p.result.y > p.raw.y, "TB: the result at the bottom");
  p = at("LR");
  assert.ok(p.result.x > p.raw.x, "LR: the result on the right");
  p = at("RL");
  assert.ok(p.result.x < p.raw.x, "RL: the result on the left");
});

test("radial: the result in the middle, one ring per level", () => {
  const { positions } = laidOut(TREE, { direction: "radial" });
  const centre = positions.get("result");
  const ring = (id) => {
    const p = positions.get(id);
    return Math.hypot(p.x - centre.x, p.y - centre.y);
  };
  assert.ok(Math.abs(ring("a") - ring("b")) < 1, "level 1 on one ring");
  assert.ok(ring("a1") > ring("a") + 10, "level 2 further out");
});

test("the merged view draws a shared ingredient once, below everything that uses it", () => {
  const { positions } = laidOut(RECIPE, { viewMode: "merged" });
  assert.equal(positions.size, 4);
  const y = (id) => positions.get(id).y;
  assert.ok(
    y("result") < y("gift") && y("gift") < y("ingot") && y("ingot") < y("ore"),
  );
});

test("long names have room: no two nodes' labels overlap, in any direction", () => {
  for (const direction of ["BT", "LR"]) {
    const { positions, model } = laidOut(TREE, { direction });
    const widths = model.labelWidths();
    const ids = [...positions.keys()];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions.get(ids[i]),
          b = positions.get(ids[j]);
        // Far enough apart along one axis for a label (or a node) each.
        const apartX =
          Math.abs(a.x - b.x) >= Math.min(widths[i], widths[j]) / 2;
        const apartY = Math.abs(a.y - b.y) >= model.labelHeight;
        assert.ok(apartX || apartY, `${direction}: ${ids[i]} and ${ids[j]}`);
      }
  }
});

test("cards: spaced as whole cards", () => {
  const { positions } = laidOut(TREE, { nodeLook: "card", direction: "BT" });
  const a = positions.get("a"),
    b = positions.get("b");
  assert.ok(Math.abs(a.x - b.x) >= 222 - 1e-6, "siblings a card's width apart");
});

test("the same graph and settings always give the same drawing", () => {
  for (const overrides of [
    {},
    { viewMode: "merged" },
    { direction: "radial" },
  ]) {
    const one = laidOut(RECIPE, overrides).positions;
    const two = laidOut(RECIPE, overrides).positions;
    assert.deepEqual([...one], [...two]);
  }
});
