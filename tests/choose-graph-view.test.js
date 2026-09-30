// Which renderer a page gets: Prism by default, Classic on request, and the URL override for one visit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../public/src/config/settings-schema.js";

// A browser just big enough for the choice: WebGL2 support, a URL, and (optionally) Cytoscape.
function browser({ webgl2 = true, search = "", cytoscape = true } = {}) {
  globalThis.document = {
    createElement: () => ({
      getContext: (kind) => (kind === "webgl2" && webgl2 ? {} : null),
    }),
  };
  globalThis.location = { search };
  if (cytoscape) globalThis.cytoscape = () => {};
  else delete globalThis.cytoscape;
}

const { chooseGraphView } =
  await import("../public/src/render/choose-graph-view.js");
const { WebGLGraphView } =
  await import("../public/src/render/webgl-graph-view.js");
const { GraphView } = await import("../public/src/graph/graph-view.js");

test("renderer: Prism by default, Classic when chosen, and the URL wins for one visit", () => {
  browser();
  assert.equal(DEFAULT_SETTINGS.graphRenderer, "prism");
  assert.equal(chooseGraphView(DEFAULT_SETTINGS), WebGLGraphView);
  assert.equal(chooseGraphView({ graphRenderer: "classic" }), GraphView);
  browser({ search: "?renderer=classic" });
  assert.equal(chooseGraphView(DEFAULT_SETTINGS), GraphView);
  browser({ search: "?renderer=webgl" }); // the preview's links still work
  assert.equal(chooseGraphView({ graphRenderer: "classic" }), WebGLGraphView);
});

test("renderer: without WebGL2 it's Classic; without Cytoscape it's Prism", () => {
  browser({ webgl2: false });
  assert.equal(chooseGraphView(DEFAULT_SETTINGS), GraphView);
  browser({ cytoscape: false });
  assert.equal(chooseGraphView({ graphRenderer: "classic" }), WebGLGraphView);
});
