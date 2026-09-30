/** "#rrggbb" (or "#rgb") → [r, g, b] in 0..1. */
export function parseColor(hex) {
  let text = String(hex ?? "#888888").trim();
  if (text.length === 4)
    text = "#" + [...text.slice(1)].map((c) => c + c).join("");
  const value = parseInt(text.slice(1, 7), 16);
  if (Number.isNaN(value)) return [0.53, 0.53, 0.53];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

const parsed = new Map();

/** parseColor for colours looked up every frame. Don't modify the result. */
export function cachedColor(hex) {
  let rgb = parsed.get(hex);
  if (!rgb) parsed.set(hex, (rgb = parseColor(hex)));
  return rgb;
}
