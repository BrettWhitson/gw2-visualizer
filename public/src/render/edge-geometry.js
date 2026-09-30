/**
 * Edge shapes as line segments, for drawing and for bounds. Pure: no DOM.
 *
 * Edges attach to node boxes, not centres, so arrowheads sit on the border. "taxi" edges run in three straight pieces
 * (out along the flow, across, then in), the way the crafting page draws them.
 */

/** Where the line from (cx, cy) toward (tx, ty) leaves a box of half-size hw × hh centred at (cx, cy). */
export function boxExit(cx, cy, hw, hh, tx, ty) {
  const dx = tx - cx,
    dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * The points of an edge from `source` to `target` (each `{ x, y, hw, hh }`), as a polyline.
 * @param {"straight" | "taxi"} routing
 * @param {"x" | "y"} flowAxis  for taxi: the axis levels are spread along
 * @returns {{ x: number, y: number }[]}
 */
export function edgePoints(
  source,
  target,
  routing = "straight",
  flowAxis = "y",
) {
  if (routing === "taxi") {
    if (flowAxis === "x") {
      const dir = Math.sign(target.x - source.x) || 1;
      const start = { x: source.x + dir * source.hw, y: source.y };
      const end = { x: target.x - dir * target.hw, y: target.y };
      const middle = (start.x + end.x) / 2;
      return start.y === end.y
        ? [start, end]
        : [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
    }
    const dir = Math.sign(target.y - source.y) || 1;
    const start = { x: source.x, y: source.y + dir * source.hh };
    const end = { x: target.x, y: target.y - dir * target.hh };
    const middle = (start.y + end.y) / 2;
    return start.x === end.x
      ? [start, end]
      : [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
  }
  return [
    boxExit(source.x, source.y, source.hw, source.hh, target.x, target.y),
    boxExit(target.x, target.y, target.hw, target.hh, source.x, source.y),
  ];
}

/** An arrowhead's three corners at `tip`, pointing away from `from`, `size` long and as wide. */
export function arrowHead(from, tip, size) {
  const dx = tip.x - from.x,
    dy = tip.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length,
    uy = dy / length;
  const baseX = tip.x - ux * size,
    baseY = tip.y - uy * size;
  const half = size / 2;
  return [
    tip,
    { x: baseX - uy * half, y: baseY + ux * half },
    { x: baseX + uy * half, y: baseY - ux * half },
  ];
}

/** Bounding box of a polyline, padded by `pad`. */
export function pointsBounds(points, pad = 0) {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const { x, y } of points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad };
}
