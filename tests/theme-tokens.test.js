// The design tokens (css/app.css) and the colours mirrored for the graph canvas (UI_COLORS) stay in step, and
// Prismatrix gets colours it accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveTheme } from "prismatrix";
import { UI_COLORS } from "../web/src/config/constants.js";
import { tokenTheme } from "../web/src/render/theme-tokens.js";
import { themeOptions } from "../web/src/render/prism-settings.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";

const css = readFileSync(
  new URL("../web/css/app.css", import.meta.url),
  "utf8",
);
const root = css.slice(
  css.indexOf(":root {"),
  css.indexOf("}", css.indexOf(":root {")),
);
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
    name,
    value.trim(),
  ]),
);

/** A colour Prismatrix accepts: "#rrggbb". */
const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

/** UI_COLORS key → the token it mirrors. */
const MIRRORS = {
  canvas: "bg",
  panel: "panel",
  line: "line",
  text: "text",
  muted: "muted",
  accent: "brand",
  accentLight: "brand-light",
  nodeFill: "raised",
  danger: "down",
  gold: "gold",
  silver: "silver",
  copper: "copper",
};

test("UI_COLORS mirrors the design tokens", () => {
  for (const [key, token] of Object.entries(MIRRORS))
    assert.equal(
      UI_COLORS[key],
      tokens[token],
      `UI_COLORS.${key} vs --${token}`,
    );
});

test("the tokens the graph reads are colours Prismatrix accepts", () => {
  for (const name of ["bg", "text", "muted", "raised", "line"])
    assert.ok(isHex(tokens[name]), `--${name}: ${tokens[name]}`);
});

test("Prismatrix's theme: the tokens, then the settings' colours, all accepted", () => {
  const theme = themeOptions(
    DEFAULT_SETTINGS,
    tokenTheme(() => null),
  ); // no DOM here: the mirrored fallbacks
  assert.equal(theme.background, UI_COLORS.canvas);
  assert.equal(theme.card, UI_COLORS.nodeFill);
  assert.equal(theme.edge, DEFAULT_SETTINGS.edgeColor);
  assert.equal(theme.ancestors, DEFAULT_SETTINGS.lineageUpColor);
  const warnings = [];
  resolveTheme(theme, (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
});
