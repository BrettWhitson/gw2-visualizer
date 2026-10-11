import { EDGE_SOURCE_STYLES } from "../config/constants.js";
import { cssToken } from "./theme-tokens.js";

/**
 * Edge style patches (by class) for edges coloured by where the ingredient comes from (Customize → Edges → Color "Where it comes
 * from"). NodeAppearance gives every edge a `src-<category>` class; these rules colour them, reading each colour from
 * its design token so the graph follows the stylesheet. Tokens are literal colours: Prismatrix rejects var() and
 * color-mix().
 */

/**
 * The `src-<category>` edge rules, as Prismatrix edge style: `{ edges: { "src-craft": { color, dash? }, … } }`.
 * @param {(token: string) => string | null} [readToken]
 */
export function edgeSourceRules(readToken = cssToken) {
  const edges = {};
  for (const [category, style] of Object.entries(EDGE_SOURCE_STYLES)) {
    const color = readToken(style.token) || style.color;
    const { pattern } = style;
    edges[`src-${category}`] = pattern ? { color, dash: pattern } : { color };
  }
  return { edges };
}
