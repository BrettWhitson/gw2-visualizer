import { GraphView } from "../graph/graph-view.js";
import { WebGLGraphView } from "./webgl-graph-view.js";

/**
 * Which graph view a page gets: our WebGL engine (src/render/) when the Renderer setting asks for it and the browser
 * has WebGL2, otherwise the Cytoscape-based GraphView. `?renderer=webgl` or `?renderer=classic` overrides the setting
 * for one visit.
 * @param {{ renderer?: string }} settings  settings values
 */
export function chooseGraphView(settings) {
  const override = new URLSearchParams(globalThis.location?.search).get(
    "renderer",
  );
  const wanted = (override ?? settings.renderer) === "webgl";
  return wanted && supportsWebGL2() ? WebGLGraphView : GraphView;
}

function supportsWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}
