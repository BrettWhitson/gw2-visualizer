// The classic (Cytoscape) renderer's own pieces, run against headless Cytoscape. Goes when that renderer does.
import { test } from "node:test";
import assert from "node:assert/strict";
import cytoscape from "cytoscape";
import { GraphTransition } from "../web/src/graph/graph-transition.js";

// GraphTransition schedules frames with the browser's animation-frame API.
globalThis.requestAnimationFrame ??= (callback) =>
  setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame ??= clearTimeout;

const ELEMENTS = [
  { data: { id: "result" }, classes: "root" },
  ...["a", "b", "a1"].map((id) => ({ data: { id } })),
  ...[
    ["result", "a"],
    ["result", "b"],
    ["a", "a1"],
  ].map(([source, target]) => ({
    data: { id: `${source}->${target}`, source, target },
  })),
];

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
