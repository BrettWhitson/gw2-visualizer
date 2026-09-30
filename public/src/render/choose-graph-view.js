import { GraphView } from "../graph/graph-view.js";
import { WebGLGraphView } from "./webgl-graph-view.js";

/**
 * Which graph view a page gets: Prism (lib/prism/, the default) unless the Renderer setting asks for Classic or
 * the browser lacks WebGL2, then the Cytoscape-based GraphView. `?renderer=prism` (or the preview's `webgl`) or
 * `?renderer=classic` overrides the setting for one visit. Without Cytoscape (it failed to load) Prism is used
 * whatever the setting.
 * @param {{ graphRenderer?: string }} settings  settings values
 */
export function chooseGraphView(settings) {
  const override = new URLSearchParams(globalThis.location?.search).get(
    "renderer",
  );
  const choice =
    override === "webgl" ? "prism" : (override ?? settings.graphRenderer);
  const wanted = choice !== "classic" || !globalThis.cytoscape;
  return wanted && supportsWebGL2() ? WebGLGraphView : GraphView;
}

/**
 * Reload the page to switch renderers (the graph view is built once, at start), dropping a `?renderer=` override
 * that would otherwise bring the old one straight back.
 */
export function reloadForRenderer() {
  const url = new URL(location.href);
  if (!url.searchParams.has("renderer")) {
    location.reload();
    return;
  }
  url.searchParams.delete("renderer");
  location.replace(url);
}

/** Can a graph be drawn at all: our engine needs WebGL2, the classic one Cytoscape. */
export function canDrawGraphs() {
  return !!globalThis.cytoscape || supportsWebGL2();
}

function supportsWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}
