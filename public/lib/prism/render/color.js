const FALLBACK = [0.53, 0.53, 0.53, 1];

/**
 * Any CSS colour → [r, g, b, a] in 0..1. "#rgb", "#rgba", "#rrggbb", "#rrggbbaa", rgb()/rgba() and "transparent" are
 * read directly; anything else (names, hsl()…) goes through a 2D canvas when there's a document. What can't be read
 * is grey.
 */
export function parseColorAlpha(color) {
  const text = String(color ?? "")
    .trim()
    .toLowerCase();
  return (
    parseHex(text) ??
    parseRgbFunction(text) ??
    (text === "transparent" ? [0, 0, 0, 0] : null) ??
    parseWithCanvas(text) ??
    FALLBACK
  );
}

/** Any CSS colour → [r, g, b] in 0..1 (its alpha dropped; see parseColorAlpha). */
export function parseColor(color) {
  return parseColorAlpha(color).slice(0, 3);
}

function parseHex(text) {
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text)) return null;
  let digits = text.slice(1);
  if (digits.length <= 4)
    digits = [...digits].map((digit) => digit + digit).join("");
  const channels = [];
  for (let i = 0; i < digits.length; i += 2)
    channels.push(parseInt(digits.slice(i, i + 2), 16) / 255);
  if (channels.length === 3) channels.push(1);
  return channels;
}

/** "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "rgb(1 2 3 / 50%)". */
function parseRgbFunction(text) {
  const match = /^rgba?\(([^)]*)\)$/.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channel = (part, max) => {
    const value = parseFloat(part);
    if (!Number.isFinite(value)) return NaN;
    const unit = part.endsWith("%") ? value / 100 : value / max;
    return Math.min(1, Math.max(0, unit));
  };
  const rgba = [
    channel(parts[0], 255),
    channel(parts[1], 255),
    channel(parts[2], 255),
    parts.length === 4 ? channel(parts[3], 1) : 1,
  ];
  return rgba.some(Number.isNaN) ? null : rgba;
}

let canvasContext;
const normalised = new Map();

/** Let the browser read it: a 2D context's fillStyle comes back as "#rrggbb" or "rgba(…)". Null without a document. */
function parseWithCanvas(text) {
  if (normalised.has(text)) return normalised.get(text);
  if (canvasContext === undefined)
    canvasContext =
      globalThis.document?.createElement("canvas").getContext("2d") ?? null;
  if (!canvasContext) return null;
  // An invalid colour leaves fillStyle alone: set it over two different ones, and only a real colour reads the same.
  const read = (probe) => {
    canvasContext.fillStyle = probe;
    canvasContext.fillStyle = text;
    return String(canvasContext.fillStyle);
  };
  const value = read("#000000");
  const result =
    value === read("#ffffff")
      ? (parseHex(value) ?? parseRgbFunction(value))
      : null;
  if (normalised.size > 500) normalised.clear();
  normalised.set(text, result);
  return result;
}

const parsed = new Map();

/** parseColor for colours looked up every frame. Don't modify the result. */
export function cachedColor(hex) {
  let rgb = parsed.get(hex);
  if (!rgb) parsed.set(hex, (rgb = parseColor(hex)));
  return rgb;
}
