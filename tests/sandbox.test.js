// The engine sandbox's made-up graphs and the elements it hands to the renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRAPH_SHAPES,
  generateGraph,
} from "../public/src/sandbox/generate-graph.js";
import { sandboxElements } from "../public/src/sandbox/sandbox-elements.js";

test("generated graphs: the size asked for, edges always run down a level, and a seed repeats", () => {
  for (const shape of Object.keys(GRAPH_SHAPES)) {
    const graph = generateGraph({ shape, size: 300, shared: 0.2, seed: 7 });
    assert.equal(graph.nodes.length, 300, shape);
    assert.equal(graph.rootId, graph.nodes[0].id);
    const depth = new Map(graph.nodes.map((node) => [node.id, node.depth]));
    for (const edge of graph.edges)
      assert.ok(depth.get(edge.target) > depth.get(edge.source), shape);
    const keys = graph.edges.map((edge) => `${edge.source}>${edge.target}`);
    assert.equal(
      new Set(keys).size,
      keys.length,
      `${shape}: no duplicate edges`,
    );
    assert.deepEqual(
      generateGraph({ shape, size: 300, shared: 0.2, seed: 7 }),
      graph,
      `${shape}: same seed, same graph`,
    );
  }
  assert.notDeepEqual(
    generateGraph({ seed: 1 }).nodes.map((n) => n.name),
    generateGraph({ seed: 2 }).nodes.map((n) => n.name),
  );
});

test("generated graphs: sharing makes items with several parents; every item is reachable", () => {
  const graph = generateGraph({ size: 400, shared: 0.3, seed: 3 });
  const parents = new Map();
  for (const edge of graph.edges)
    parents.set(edge.target, (parents.get(edge.target) ?? 0) + 1);
  assert.ok([...parents.values()].some((count) => count > 1));
  const { nodeElements } = sandboxElements(graph);
  assert.equal(nodeElements.length, 400);
  // Big graphs stay quick to make (no quadratic steps).
  const started = performance.now();
  generateGraph({ size: 10000, shared: 0.2, seed: 5 });
  assert.ok(performance.now() - started < 1000);
});

test("sandbox elements: collapsing hides what's only reachable through it, and marks it", () => {
  const graph = generateGraph({
    shape: "tree",
    size: 21,
    branching: 4,
    seed: 1,
  });
  const first = graph.edges[0].target; // one of the root's ingredients, with its own
  const all = sandboxElements(graph);
  const folded = sandboxElements(graph, { collapsed: new Set([first]) });
  const ids = (result) => result.nodeElements.map((e) => e.data.id);
  assert.ok(ids(folded).length < ids(all).length);
  assert.ok(ids(folded).includes(first));
  const element = folded.nodeElements.find((e) => e.data.id === first);
  assert.match(element.classes, /hiddenKids/);
  for (const edge of folded.edgeElements) {
    assert.ok(ids(folded).includes(edge.data.source));
    assert.ok(ids(folded).includes(edge.data.target));
  }
  assert.match(all.nodeElements[0].classes, /root/);
  assert.equal(all.nodeElements[0].data.label, graph.nodes[0].name);
});

test("sandbox elements: colour by rarity or depth, and icons stick to an item's name", () => {
  const graph = generateGraph({ size: 50, seed: 9 });
  const icons = ["a.png", "b.png", "c.png"];
  const byRarity = sandboxElements(graph, { icons });
  const byDepth = sandboxElements(graph, { colorBy: "depth", icons });
  assert.equal(byRarity.nodeElements[0].data.color, "#9a5dff"); // legendary result
  assert.notDeepEqual(
    byRarity.nodeElements.map((e) => e.data.color),
    byDepth.nodeElements.map((e) => e.data.color),
  );
  assert.deepEqual(
    byRarity.nodeElements.map((e) => e.data.icon),
    byDepth.nodeElements.map((e) => e.data.icon),
  );
  assert.ok(byRarity.nodeElements.every((e) => icons.includes(e.data.icon)));
});
