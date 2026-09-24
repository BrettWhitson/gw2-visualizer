// Generate the app icons (SVG + PNGs) from one geometric description. No dependencies.
//
// Crafting flows upward: four raw materials at the bottom feed a crafted ingredient (blue) and a Mystic Forge
// ingredient (purple sparkle), which feed the result, a gold hexagon, at the top. Dark rounded tile.
// PNGs are rasterised with analytic anti-aliasing (signed distances per shape) and encoded with node:zlib.
//
// Usage:  node tools/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICON_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);

const BACKGROUND = [0x15, 0x1a, 0x24];
const EDGE = [0x4a, 0x55, 0x6e];
const GOLD_EDGE = [0xa8, 0x86, 0x44];
const GOLD = [0xf0, 0xc4, 0x6a];
const BLUE = [0x62, 0xa4, 0xda];
const PURPLE = [0xb4, 0x6c, 0xff];
const LIGHT = [0xe3, 0xe6, 0xec];
const TILE_RADIUS = 0.22; // corner radius of the background tile
const EDGE_WIDTH = 0.03;

/** Regular polygon / star points around (cx, cy); `inner` (0..1) makes a star with that inner-radius ratio. */
function polygon(
  cx,
  cy,
  radius,
  corners,
  { rotation = -Math.PI / 2, inner = 0 } = {},
) {
  const points = [];
  const count = inner ? corners * 2 : corners;
  for (let i = 0; i < count; i++) {
    const r = inner && i % 2 ? radius * inner : radius;
    const angle = rotation + (i * 2 * Math.PI) / count;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

/** Quadratic curve from a (raw side) to b (result side), bending so it leaves a vertically. */
const flow = (a, b, color) => ({
  type: "curve",
  from: a,
  control: [a[0], (a[1] + b[1]) / 2],
  to: b,
  color,
});

const RESULT = [0.5, 0.25];
const CRAFTED = [0.3, 0.57];
const FORGED = [0.7, 0.57];
const RAW = [
  [0.17, 0.83],
  [0.39, 0.83],
  [0.61, 0.83],
  [0.83, 0.83],
];

/** Painted in order. */
const SHAPES = [
  flow(RAW[0], CRAFTED, EDGE),
  flow(RAW[1], CRAFTED, EDGE),
  flow(RAW[2], FORGED, EDGE),
  flow(RAW[3], FORGED, EDGE),
  flow(CRAFTED, RESULT, GOLD_EDGE),
  flow(FORGED, RESULT, GOLD_EDGE),
  ...RAW.map((center) => ({
    type: "circle",
    center,
    radius: 0.05,
    color: LIGHT,
  })),
  { type: "circle", center: CRAFTED, radius: 0.078, color: BLUE },
  {
    type: "polygon",
    points: polygon(...FORGED, 0.11, 4, { inner: 0.42 }),
    color: PURPLE,
  },
  { type: "polygon", points: polygon(...RESULT, 0.15, 6), color: GOLD },
  { type: "polygon", points: polygon(...RESULT, 0.095, 6), color: BACKGROUND },
  {
    type: "polygon",
    points: polygon(...RESULT, 0.07, 4, { inner: 0.4 }),
    color: GOLD,
  },
];

// ---------------------------------------------------------------- SVG

function svgIcon() {
  const px = (v) => (v * 512).toFixed(1);
  const hex = (color) =>
    `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const parts = SHAPES.map((shape) => {
    if (shape.type === "circle")
      return `<circle cx="${px(shape.center[0])}" cy="${px(shape.center[1])}" r="${px(shape.radius)}" fill="${hex(shape.color)}"/>`;
    if (shape.type === "polygon")
      return `<polygon points="${shape.points.map(([x, y]) => `${px(x)},${px(y)}`).join(" ")}" fill="${hex(shape.color)}"/>`;
    const [a, c, b] = [shape.from, shape.control, shape.to];
    return `<path d="M${px(a[0])} ${px(a[1])}Q${px(c[0])} ${px(c[1])} ${px(b[0])} ${px(b[1])}" fill="none" stroke="${hex(shape.color)}" stroke-width="${px(EDGE_WIDTH)}" stroke-linecap="round"/>`;
  });
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
    `<rect width="512" height="512" rx="${px(TILE_RADIUS)}" fill="${hex(BACKGROUND)}"/>` +
    `${parts.join("")}</svg>\n`
  );
}

// ---------------------------------------------------------------- rasteriser (signed distances)

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Signed distance to a closed polygon (negative inside). */
function polygonDistance(x, y, points) {
  let distance = Infinity,
    inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j],
      [bx, by] = points[i];
    distance = Math.min(distance, distanceToSegment(x, y, ax, ay, bx, by));
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside ? -distance : distance;
}

/** A quadratic curve as a polyline, for distance tests. */
function curveSegments({ from, control, to }, steps = 24) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    points.push([
      u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
    ]);
  }
  return points;
}
for (const shape of SHAPES)
  if (shape.type === "curve") shape.polyline = curveSegments(shape);

function shapeDistance(shape, x, y) {
  if (shape.type === "circle")
    return Math.hypot(x - shape.center[0], y - shape.center[1]) - shape.radius;
  if (shape.type === "polygon") return polygonDistance(x, y, shape.points);
  let distance = Infinity;
  const line = shape.polyline;
  for (let i = 1; i < line.length; i++)
    distance = Math.min(
      distance,
      distanceToSegment(x, y, ...line[i - 1], ...line[i]),
    );
  return distance - EDGE_WIDTH / 2;
}

/** Signed distance to a rounded square spanning the unit square. */
function roundedSquareDistance(x, y, radius) {
  const qx = Math.abs(x - 0.5) - (0.5 - radius),
    qy = Math.abs(y - 0.5) - (0.5 - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

const coverage = (signedDistance, pixelSize) =>
  Math.min(1, Math.max(0, 0.5 - signedDistance / pixelSize));

function blend(pixel, color, amount) {
  if (amount <= 0) return;
  for (let i = 0; i < 3; i++)
    pixel[i] = pixel[i] * (1 - amount) + color[i] * amount;
  pixel[3] += (255 - pixel[3]) * amount;
}

/**
 * RGBA scanlines (each prefixed with PNG filter byte 0).
 * `fullBleed` fills the square (maskable / Apple icons); `contentScale` shrinks the drawing toward the centre.
 */
function rasterize(size, { fullBleed, contentScale = 1 }) {
  const pixelSize = 1 / size;
  const drawingPixelSize = pixelSize / contentScale;
  const rows = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let py = 0; py < size; py++) {
    rows[offset++] = 0;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size,
        y = (py + 0.5) / size;
      const ux = 0.5 + (x - 0.5) / contentScale,
        uy = 0.5 + (y - 0.5) / contentScale; // drawing space
      const pixel = [0, 0, 0, 0];
      blend(
        pixel,
        BACKGROUND,
        fullBleed
          ? 1
          : coverage(roundedSquareDistance(x, y, TILE_RADIUS), pixelSize),
      );
      if (pixel[3] > 0) {
        const inside = pixel[3] / 255;
        for (const shape of SHAPES)
          blend(
            pixel,
            shape.color,
            coverage(shapeDistance(shape, ux, uy), drawingPixelSize) * inside,
          );
      }
      for (const channel of pixel)
        rows[offset++] = Math.round(Math.max(0, Math.min(255, channel)));
    }
  }
  return rows;
}

// ---------------------------------------------------------------- PNG encoding

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function encodePng(size, scanlines) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- main

mkdirSync(ICON_DIR, { recursive: true });
writeFileSync(path.join(ICON_DIR, "icon.svg"), svgIcon());
console.log("wrote public/icons/icon.svg");

const OUTPUTS = [
  ["icon-192.png", 192, { fullBleed: false }],
  ["icon-512.png", 512, { fullBleed: false }],
  ["apple-touch-icon.png", 180, { fullBleed: true, contentScale: 0.86 }],
  // Maskable icons must keep content inside the central 80% "safe zone".
  ["icon-maskable-512.png", 512, { fullBleed: true, contentScale: 0.72 }],
];
for (const [name, size, options] of OUTPUTS) {
  writeFileSync(
    path.join(ICON_DIR, name),
    encodePng(size, rasterize(size, options)),
  );
  console.log(`wrote public/icons/${name}`);
}
