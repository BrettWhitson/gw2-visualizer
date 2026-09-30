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

/**
 * Break a label into lines no wider than `maxWidth` (by `measure`), keeping its own line breaks. "ellipsis" keeps each
 * line to one row, cut with "…".
 */
export function wrapLabel(text, maxWidth, overflow, measure) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (!maxWidth || measure(paragraph) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    if (overflow === "ellipsis") {
      let cut = paragraph;
      while (cut.length > 1 && measure(cut + "…") > maxWidth)
        cut = cut.slice(0, -1);
      lines.push(cut.trimEnd() + "…");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
  }
  return lines;
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
