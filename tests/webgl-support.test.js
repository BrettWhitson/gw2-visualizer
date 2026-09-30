// Graph pages draw with Prism (WebGL2) and say so plainly when the browser can't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canDrawGraphs } from "../web/src/render/webgl-support.js";

/** A document just big enough for the check. */
function browser(getContext) {
  globalThis.document = { createElement: () => ({ getContext }) };
}

test("graphs need WebGL2", () => {
  browser((kind) => (kind === "webgl2" ? {} : null));
  assert.equal(canDrawGraphs(), true);
  browser(() => null);
  assert.equal(canDrawGraphs(), false);
  browser(() => {
    throw new Error("blocked");
  });
  assert.equal(canDrawGraphs(), false);
  delete globalThis.document;
});
