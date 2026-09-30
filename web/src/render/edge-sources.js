import { EDGE_SOURCE_STYLES } from "../config/constants.js";

/**
 * Prism class rules for edges coloured by where the ingredient comes from (Customize → Edges → Color "Where it comes
 * from"). NodeAppearance gives every edge a `src-<category>` class; these rules colour them, reading each colour from
 * its design token so the graph follows the stylesheet. Tokens are literal colours: Prism rejects var() and
 * color-mix().
 */

/** A CSS custom property's value on the page, or null (outside a browser, or unset). */
function cssToken(name) {
  const style =
    globalThis.document &&
    globalThis.getComputedStyle?.(document.documentElement);
  return style?.getPropertyValue(`--${name}`).trim() || null;
}

/**
 * The colour for a source category: its token, else the mirrored fallback.
 * @param {keyof typeof EDGE_SOURCE_STYLES} category
 * @param {(token: string) => string | null} [readToken]
 */
export function edgeSourceColor(category, readToken = cssToken) {
  const style = EDGE_SOURCE_STYLES[category];
  return readToken(style.token) || style.color;
}

/**
 * The `src-<category>` edge rules, in Prism's terms: `{ edges: { "src-craft": { color }, … } }`.
 * @param {(token: string) => string | null} [readToken]
 */
export function edgeSourceRules(readToken = cssToken) {
  const edges = {};
  for (const [category, { pattern }] of Object.entries(EDGE_SOURCE_STYLES)) {
    const color = edgeSourceColor(category, readToken);
    edges[`src-${category}`] = pattern ? { color, pattern } : { color };
  }
  return { edges };
}
