import { UI_COLORS } from "../config/constants.js";

/** Prismatrix theme colour ← the CSS design token it follows (css/app.css :root), with the mirrored fallback. */
const TOKENS = {
  node: ["muted", UI_COLORS.muted],
  nodeFill: ["raised", UI_COLORS.nodeFill],
  labelText: ["text", UI_COLORS.text],
  edgeLabelText: ["muted", UI_COLORS.muted],
  cardBorder: ["line", UI_COLORS.line],
  cardText: ["text", UI_COLORS.text],
  cardMuted: ["muted", UI_COLORS.muted],
  portFill: ["bg", UI_COLORS.canvas],
};

/**
 * The part of Prismatrix's theme that comes from the page's design tokens, read from the CSS custom properties so the
 * graph follows the stylesheet (and a future light theme). Outside a browser, or for a token that isn't set, the
 * UI_COLORS mirror is used. Tokens must be literal colours: Prismatrix rejects var() and color-mix().
 */
export function tokenTheme() {
  const style =
    globalThis.document &&
    globalThis.getComputedStyle?.(document.documentElement);
  return Object.fromEntries(
    Object.entries(TOKENS).map(([key, [token, fallback]]) => [
      key,
      style?.getPropertyValue(`--${token}`).trim() || fallback,
    ]),
  );
}
