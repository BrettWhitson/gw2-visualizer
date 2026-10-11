import { UI_COLORS } from "../config/constants.js";

/** Prismatrix theme colour ← the CSS design token it follows (css/app.css :root), with the mirrored fallback. */
const TOKENS = {
  background: ["bg", UI_COLORS.canvas],
  text: ["text", UI_COLORS.text],
  textHalo: ["bg", UI_COLORS.canvas],
  node: ["muted", UI_COLORS.muted],
  card: ["raised", UI_COLORS.nodeFill],
  cardBorder: ["line", UI_COLORS.line],
};

/** A CSS custom property's value on the page, or null (outside a browser, or unset). */
export function cssToken(name) {
  const style =
    globalThis.document &&
    globalThis.getComputedStyle?.(document.documentElement);
  return style?.getPropertyValue(`--${name}`).trim() || null;
}

/**
 * The part of Prismatrix's theme that comes from the page's design tokens, read from the CSS custom properties so the
 * graph follows the stylesheet (and a future light theme). Outside a browser, or for a token that isn't set, the
 * UI_COLORS mirror is used. Tokens must be literal "#rrggbb" colours: Prismatrix rejects anything else.
 * @param {(token: string) => string | null} [readToken]
 */
export function tokenTheme(readToken = cssToken) {
  return Object.fromEntries(
    Object.entries(TOKENS).map(([key, [token, fallback]]) => [
      key,
      readToken(token) || fallback,
    ]),
  );
}
