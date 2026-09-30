// The design tokens (css/app.css) and the colours mirrored for the graph canvas (UI_COLORS) stay in step, and Prism
// gets colours it accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isColor } from "tether/index.js";
import { UI_COLORS } from "../web/src/config/constants.js";
import { tokenTheme } from "../web/src/render/theme-tokens.js";
import { prismTheme } from "../web/src/render/prism-settings.js";
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

test("colour tokens are literal colours Prism accepts (older names may alias them)", () => {
  for (const [name, value] of Object.entries(tokens)) {
    if (name === "shadow" || value.startsWith("var(")) continue;
    assert.ok(isColor(value), `--${name}: ${value}`);
  }
});

test("Prism's theme: the tokens, then the settings' colours", () => {
  const theme = { ...tokenTheme(), ...prismTheme(DEFAULT_SETTINGS) }; // no DOM here: the mirrored fallbacks
  assert.equal(theme.nodeFill, UI_COLORS.nodeFill);
  assert.equal(theme.labelText, UI_COLORS.text);
  assert.equal(theme.edge, DEFAULT_SETTINGS.edgeColor);
  for (const [key, value] of Object.entries(theme))
    assert.ok(isColor(value), `${key}: ${value}`);
});
