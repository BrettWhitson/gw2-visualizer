// Edges coloured by where the ingredient comes from: class rules that follow the design tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  edgeSourceColor,
  edgeSourceRules,
} from "../web/src/render/edge-sources.js";
import {
  EDGE_SOURCE_STYLES,
  SOURCE_COLORS,
} from "../web/src/config/constants.js";

test("a rule for every source category but the root, in literal colours Prism accepts", () => {
  const categories = Object.keys(SOURCE_COLORS).filter((c) => c !== "root");
  assert.deepEqual(
    Object.keys(EDGE_SOURCE_STYLES).sort(),
    [...categories].sort(),
  );
  const { edges } = edgeSourceRules(() => null);
  for (const category of categories)
    assert.match(edges[`src-${category}`].color, /^#[0-9a-f]{6}$/);
  assert.equal(edges["src-currency"].pattern, "dashed");
  assert.equal(edges["src-craft"].pattern, undefined);
});

test("colours follow the page's --s-* tokens when they're set", () => {
  const tokens = { "s-craft": "#123456" };
  const read = (name) => tokens[name] ?? null;
  assert.equal(edgeSourceColor("craft", read), "#123456");
  assert.equal(edgeSourceColor("mf", read), EDGE_SOURCE_STYLES.mf.color);
  assert.equal(edgeSourceRules(read).edges["src-craft"].color, "#123456");
});

test("the mirrored colours match the tokens in app.css", () => {
  const css = readFileSync(
    new URL("../web/css/app.css", import.meta.url),
    "utf8",
  );
  for (const { token, color } of Object.values(EDGE_SOURCE_STYLES))
    assert.match(css, new RegExp(`--${token}:\\s*${color};`, "i"));
});
