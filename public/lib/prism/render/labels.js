/**
 * Node label geometry, shared by the engine (which draws labels) and the layout (which leaves room for them), so
 * both agree on how big a label is and where it sits. Pure apart from the `measure(text) → width` function passed in.
 */

export const LABEL_FONT_FAMILY = '"Segoe UI", system-ui, sans-serif';
export const LABEL_PAD_X = 4;
export const LABEL_PAD_Y = 2;
/** Space between a node's border and its label. */
export const LABEL_GAP = 5;

export function labelFont(fontSize, bold = false) {
  return `${bold ? 700 : 600} ${fontSize}px ${LABEL_FONT_FAMILY}`;
}

export function labelLineHeight(fontSize) {
  return Math.round(fontSize * 1.3);
}

/** Label bitmaps are drawn at 2× for sharpness, but never bigger than this on either side (canvas limits). */
export const MAX_LABEL_BITMAP = 4096;

/**
 * Break a label into lines no wider than `maxWidth` (by `measure`), keeping its own line breaks. A word wider than a
 * whole line is broken wherever it has to be. "ellipsis" keeps each line to one row, cut with "…". Cuts fall between
 * characters (code points), never inside one.
 */
export function wrapLabel(text, maxWidth, overflow, measure) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (!maxWidth || measure(paragraph) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    if (overflow === "ellipsis") {
      const chars = [...paragraph];
      const count = longestFit(
        chars.length,
        (n) => measure(chars.slice(0, n).join("") + "…") <= maxWidth,
      );
      lines.push(chars.slice(0, count).join("").trimEnd() + "…");
      continue;
    }
    let line = "";
    for (let word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      while (measure(word) > maxWidth) {
        const chars = [...word];
        const count = longestFit(
          chars.length - 1,
          (n) => measure(chars.slice(0, n).join("")) <= maxWidth,
        );
        lines.push(chars.slice(0, count).join(""));
        word = chars.slice(count).join("");
      }
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** The largest n in 1..max for which `fits(n)` (widths grow with n), and at least 1: something always shows. */
function longestFit(max, fits) {
  let low = 1,
    high = Math.max(1, max);
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** How much bigger than its CSS size to draw a `width` × `height` label bitmap: `preferred`, unless that's too big. */
export function labelBitmapScale(
  width,
  height,
  preferred = 2,
  maxSide = MAX_LABEL_BITMAP,
) {
  return Math.min(preferred, maxSide / Math.max(1, width, height));
}

/**
 * A label's lines and its box (backdrop included) at zoom 1. `measure` must use `labelFont(fontSize, bold)`.
 * @returns {{ lines: string[], width: number, height: number, lineHeight: number }}
 */
export function layoutLabel(
  text,
  { fontSize, wrapWidth = 0, overflow = "wrap" },
  measure,
) {
  const lines = wrapLabel(String(text), wrapWidth, overflow, measure);
  const lineHeight = labelLineHeight(fontSize);
  const width =
    Math.ceil(Math.max(1, ...lines.map((line) => measure(line)))) +
    LABEL_PAD_X * 2;
  return {
    lines,
    lineHeight,
    width,
    height: lines.length * lineHeight + LABEL_PAD_Y * 2,
  };
}

/**
 * Where a `width` × `height` label sits for a node of half-size `hw` × `hh`, relative to the node's centre.
 * @returns {{ x1: number, y1: number, x2: number, y2: number }}
 */
export function labelBox(position, hw, hh, width, height, gap = LABEL_GAP) {
  let x1, y1;
  switch (position) {
    case "below":
      x1 = -width / 2;
      y1 = hh + gap;
      break;
    case "above":
      x1 = -width / 2;
      y1 = -hh - gap - height;
      break;
    case "left":
      x1 = -hw - gap - width;
      y1 = -height / 2;
      break;
    case "center":
      x1 = -width / 2;
      y1 = -height / 2;
      break;
    default:
      x1 = hw + gap;
      y1 = -height / 2;
  }
  return { x1, y1, x2: x1 + width, y2: y1 + height };
}
