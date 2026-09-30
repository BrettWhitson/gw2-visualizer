/**
 * Can this browser draw graphs: Prismatrix needs WebGL2 (every current browser has it, unless hardware acceleration is
 * off or the GPU is blocklisted).
 */
export function canDrawGraphs() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** What a graph page shows when it can't draw. */
export const NO_WEBGL_MESSAGE =
  "This browser can't draw the graph: it needs WebGL2, which is turned off or unsupported here. Turning on hardware acceleration in the browser's settings usually fixes it.";
