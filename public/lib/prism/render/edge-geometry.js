/**
 * Edge shapes as line segments, for drawing and for bounds. Pure: no DOM.
 *
 * Edges attach to node boxes, not centres, so arrowheads sit on the border. "taxi" edges run in three straight pieces
 * (out along the flow, across, then in), like an org chart.
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

/**
 * Any routing the renderer draws, as a polyline from `source` to `target` (each `{ x, y, hw, hh }`):
 *  - "straight", "taxi": as edgePoints;
 *  - "round-taxi": taxi with its corners rounded to `cornerRadius`;
 *  - "s-curve": leaves and enters along the flow axis, bending halfway;
 *  - "arc": a gentle bow, `curvature` × 15% of the length off the straight line.
 * Curves come back as short straight pieces, fine enough to look smooth.
 */
export function edgeRoute(
  source,
  target,
  {
    routing = "straight",
    flowAxis = "y",
    cornerRadius = 10,
    curvature = 1,
  } = {},
) {
  if (routing === "round-taxi")
    return roundCorners(
      edgePoints(source, target, "taxi", flowAxis),
      cornerRadius,
    );
  if (routing === "s-curve") {
    const taxi = edgePoints(source, target, "taxi", flowAxis);
    if (taxi.length < 4) return taxi; // aligned: a straight run
    const [start, bendA, bendB, end] = taxi;
    return cubic(start, bendA, bendB, end, 16);
  }
  if (routing === "arc") {
    const dx = target.x - source.x,
      dy = target.y - source.y,
      length = Math.hypot(dx, dy);
    if (length < 1) return edgePoints(source, target, "straight");
    const bow = length * 0.15 * curvature;
    const control = {
      x: (source.x + target.x) / 2 + (dy / length) * bow,
      y: (source.y + target.y) / 2 - (dx / length) * bow,
    };
    const start = boxExit(
      source.x,
      source.y,
      source.hw,
      source.hh,
      control.x,
      control.y,
    );
    const end = boxExit(
      target.x,
      target.y,
      target.hw,
      target.hh,
      control.x,
      control.y,
    );
    return quadratic(start, control, end, 14);
  }
  return edgePoints(source, target, routing, flowAxis);
}

function cubic(a, b, c, d, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    const [wa, wb, wc, wd] = [
      u * u * u,
      3 * u * u * t,
      3 * u * t * t,
      t * t * t,
    ];
    points.push({
      x: wa * a.x + wb * b.x + wc * c.x + wd * d.x,
      y: wa * a.y + wb * b.y + wc * c.y + wd * d.y,
    });
  }
  return points;
}

function quadratic(a, b, c, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    points.push({
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    });
  }
  return points;
}

/** A polyline with each inner corner swapped for a curve of up to `radius` (less where the pieces are short). */
export function roundCorners(points, radius) {
  if (points.length < 3 || radius <= 0) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1],
      corner = points[i],
      next = points[i + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      result.push(corner);
      continue;
    }
    const entry = {
      x: corner.x - ((corner.x - previous.x) / inLength) * r,
      y: corner.y - ((corner.y - previous.y) / inLength) * r,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / outLength) * r,
      y: corner.y + ((next.y - corner.y) / outLength) * r,
    };
    result.push(...quadratic(entry, corner, exit, 6));
  }
  result.push(points.at(-1));
  return result;
}

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  return length;
}

/** The point `distance` along a polyline (clamped to its ends). */
export function pointAlong(points, distance) {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const piece = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= piece && piece > 0) {
      const t = remaining / piece;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= piece;
  }
  return { ...points.at(-1) };
}

/**
 * Arrowheads are drawn at a constant on-screen size, like the lines. Each shape is a set of triangles in a unit frame
 * at the tip: `back` runs from the tip back along the edge, `side` across it. `inset` is how far (in the same units)
 * the line stops short of the tip so it never pokes through.
 * Shapes: triangle, vee, chevron, triangle-backcurve, circle, square, tee.
 * @returns {{ triangles: [number, number][], inset: number }}
 */
export function arrowTemplate(shape) {
  const quad = (a, b, c, d) => [a, b, c, a, c, d];
  switch (shape) {
    case "vee":
      return {
        triangles: [
          [0, 0],
          [1, -0.5],
          [0.6, 0],
          [0, 0],
          [0.6, 0],
          [1, 0.5],
        ],
        inset: 0.6,
      };
    case "triangle-backcurve":
      return {
        triangles: [
          [0, 0],
          [1, -0.5],
          [0.8, 0],
          [0, 0],
          [0.8, 0],
          [1, 0.5],
        ],
        inset: 0.8,
      };
    case "chevron":
      return {
        triangles: [
          ...quad([0, 0], [0.8, -0.55], [1.1, -0.55], [0.3, 0]),
          ...quad([0, 0], [0.3, 0], [1.1, 0.55], [0.8, 0.55]),
        ],
        inset: 0.3,
      };
    case "circle": {
      const triangles = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2,
          b = ((i + 1) / 16) * Math.PI * 2;
        triangles.push(
          [0.5, 0],
          [0.5 + Math.cos(a) * 0.45, Math.sin(a) * 0.45],
          [0.5 + Math.cos(b) * 0.45, Math.sin(b) * 0.45],
        );
      }
      return { triangles, inset: 0.95 };
    }
    case "square":
      return {
        triangles: quad([0.05, -0.4], [0.85, -0.4], [0.85, 0.4], [0.05, 0.4]),
        inset: 0.85,
      };
    case "tee":
      return {
        triangles: quad([0, -0.6], [0.22, -0.6], [0.22, 0.6], [0, 0.6]),
        inset: 0,
      };
    default: // triangle
      return {
        triangles: [
          [0, 0],
          [1, -0.5],
          [1, 0.5],
        ],
        inset: 0.95,
      };
  }
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
