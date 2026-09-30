import { Camera } from "./camera.js";
import { SpatialGrid } from "./spatial-grid.js";
import { AtlasPacker } from "./atlas-packer.js";
import { arrowHead, edgePoints, pointsBounds } from "./edge-geometry.js";

/**
 * A graph renderer built for this app's graphs: WebGL2 draws every node and edge in a few instanced calls, and a 2D
 * canvas on top draws the labels. It only draws when something changes, culls what's off screen, and thins labels so
 * they never overlap. Layout is the caller's: nodes arrive with positions.
 *
 *   const graph = new WebGLGraph(container, { onNodeTap, onNodeDoubleTap, onNodeHover, onBackgroundTap });
 *   graph.setGraph({ nodes, edges, routing: "taxi", flowAxis: "x" });
 *   graph.fit();
 *
 * Node: { id, x, y, width, height, color (border, "#rrggbb"), fill?, icon? (url), label?, labelColor?, priority? }
 * Edge: { id, source, target, color?, width? (px), arrow? (at the target) }
 */

const ICON_SIZE = 64; // atlas cell, pixels
const ATLAS_SIZE = 2048; // 1024 icons
const LABEL_FONT = '600 13px "Segoe UI", system-ui, sans-serif';
const LABEL_LINE_HEIGHT = 16;
const LABEL_MIN_ZOOM = 0.35; // labels fade out below this, like the crafting page's default
const DOUBLE_TAP_MS = 300;

const NODE_VERTEX = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec2 center;
layout(location=2) in vec2 halfSize; // "half" is reserved in GLSL ES
layout(location=3) in vec4 fill;
layout(location=4) in vec4 border;
layout(location=5) in float borderWidth;
layout(location=6) in vec4 iconRect;
uniform mat3 view;
uniform float zoom;
out vec2 local;
out vec2 vHalf;
out vec4 vFill;
out vec4 vBorder;
out float vBorderWidth;
out vec4 vIcon;
void main() {
  // One pixel of room around the box for the anti-aliased edge.
  vec2 grown = halfSize + vec2(1.0 / zoom);
  local = corner * grown;
  vHalf = halfSize;
  vFill = fill;
  vBorder = border;
  vBorderWidth = borderWidth;
  vIcon = iconRect;
  vec3 clip = view * vec3(center + local, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

const NODE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;
in vec2 vHalf;
in vec4 vFill;
in vec4 vBorder;
in float vBorderWidth;
in vec4 vIcon;
uniform float zoom;
uniform sampler2D icons;
out vec4 color;
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float radius = min(vHalf.x, vHalf.y) * 0.22;
  float distancePx = roundedBox(local, vHalf, radius) * zoom;
  float inside = clamp(0.5 - distancePx, 0.0, 1.0);
  if (inside <= 0.0) discard;
  float borderPx = max(1.0, vBorderWidth * zoom);
  vec4 body = vFill;
  if (vIcon.z > 0.0) {
    // The icon fills the box inside the border, inset a little.
    vec2 inner = vHalf - vec2((vBorderWidth + 2.0));
    vec2 uv = (local / max(inner, vec2(0.001))) * 0.5 + 0.5;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      vec4 texel = texture(icons, mix(vIcon.xy, vIcon.zw, uv));
      body = vec4(mix(body.rgb, texel.rgb, texel.a), max(body.a, texel.a * vFill.a));
    }
  }
  float onBorder = clamp(distancePx + borderPx + 0.5, 0.0, 1.0);
  color = mix(body, vBorder, onBorder);
  color.a *= inside;
  color.rgb *= color.a; // premultiplied
}`;

const EDGE_VERTEX = `#version 300 es
layout(location=0) in vec2 corner; // x: along (0..1), y: across (-1..1)
layout(location=1) in vec2 from;
layout(location=2) in vec2 to;
layout(location=3) in vec4 lineColor;
layout(location=4) in float widthPx;
uniform mat3 view;
uniform vec2 viewport; // CSS pixels
out vec4 vColor;
out float across;
out float vWidth;
void main() {
  vec3 a = view * vec3(from, 1.0);
  vec3 b = view * vec3(to, 1.0);
  vec2 aPx = a.xy * viewport * 0.5;
  vec2 bPx = b.xy * viewport * 0.5;
  vec2 direction = bPx - aPx;
  float segmentLength = max(length(direction), 0.0001);
  vec2 normal = vec2(-direction.y, direction.x) / segmentLength;
  float halfWidth = widthPx * 0.5 + 1.0; // + a pixel for anti-aliasing
  // Each piece runs half a width past its ends, so the corners of taxi edges join squarely.
  vec2 extend = direction / segmentLength * (corner.x * 2.0 - 1.0) * widthPx * 0.5;
  vec2 px = mix(aPx, bPx, corner.x) + normal * corner.y * halfWidth + extend;
  gl_Position = vec4(px / (viewport * 0.5), 0.0, 1.0);
  vColor = lineColor;
  across = corner.y * halfWidth;
  vWidth = widthPx;
}`;

const EDGE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
in float across;
in float vWidth;
out vec4 color;
void main() {
  float alpha = clamp(vWidth * 0.5 + 0.5 - abs(across), 0.0, 1.0);
  color = vec4(vColor.rgb * vColor.a * alpha, vColor.a * alpha);
}`;

const TRIANGLE_VERTEX = `#version 300 es
layout(location=0) in vec2 point;
layout(location=1) in vec4 triangleColor;
uniform mat3 view;
out vec4 vColor;
void main() {
  vec3 clip = view * vec3(point, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vColor = triangleColor;
}`;

const TRIANGLE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 color;
void main() { color = vec4(vColor.rgb * vColor.a, vColor.a); }`;

/** "#rrggbb" → [r, g, b] in 0..1. */
function rgb(hex) {
  const value = parseInt(String(hex ?? "#888888").slice(1, 7), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

export class WebGLGraph {
  camera = new Camera();
  /** Timings of the last draw, for profiling. */
  stats = { drawMs: 0, labels: 0, visibleNodes: 0 };
  #nodes = [];
  #edges = [];
  #indexById = new Map();
  #grid = new SpatialGrid(200);
  #dimmed = null; // Set of node ids drawn faded, or null
  #highlighted = new Set();
  #selected = null;
  #hovered = -1;
  #frame = 0;
  #iconSlots = new Map(); // url → { u0, v0, u1, v1 } | "loading" | "failed"
  #iconPacker = new AtlasPacker(ATLAS_SIZE, 2);
  #labelCache = new Map(); // text|color → canvas
  #zoomTarget = null;

  /**
   * @param {HTMLElement} container  the graph fills it
   * @param {{ onNodeTap?: (id: string, event: PointerEvent) => void, onNodeDoubleTap?: (id: string) => void,
   *           onNodeHover?: (id: string | null, event: PointerEvent) => void, onBackgroundTap?: () => void,
   *           onViewportChange?: () => void }} [handlers]
   * @param {{ preserveDrawingBuffer?: boolean }} [options]  keep each frame readable (screenshots, tests); a little slower
   */
  constructor(
    container,
    handlers = {},
    { preserveDrawingBuffer = false } = {},
  ) {
    this.container = container;
    this.handlers = handlers;
    if (getComputedStyle(container).position === "static")
      container.style.position = "relative"; // the canvases are positioned inside it
    this.canvas = document.createElement("canvas");
    this.labels = document.createElement("canvas");
    for (const canvas of [this.canvas, this.labels])
      Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
      });
    this.labels.style.pointerEvents = "none";
    container.append(this.canvas, this.labels);
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: true,
      alpha: true,
      preserveDrawingBuffer,
    });
    if (!gl) throw new Error("WebGL2 isn't available");
    this.gl = gl;
    this.labelContext = this.labels.getContext("2d");
    this.#setUpGl();
    this.#bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------------------------------------------------------------- data

  /** Replace the graph. Positions are world units; the view is left where it is (call fit() to frame it). */
  setGraph({
    nodes,
    edges,
    routing = "straight",
    flowAxis = "y",
    labelPosition = "right",
  }) {
    this.labelPosition = labelPosition;
    this.#nodes = nodes.map((node) => ({
      ...node,
      hw: node.width / 2,
      hh: node.height / 2,
    }));
    this.#indexById = new Map(
      this.#nodes.map((node, index) => [node.id, index]),
    );
    const cell = Math.max(
      100,
      ...this.#nodes.slice(0, 50).map((n) => n.width * 3),
    );
    this.#grid = new SpatialGrid(cell);
    this.#nodes.forEach((node, index) =>
      this.#grid.insert(index, {
        x1: node.x - node.hw,
        y1: node.y - node.hh,
        x2: node.x + node.hw,
        y2: node.y + node.hh,
      }),
    );
    this.#edges = edges
      .map((edge) => {
        const source = this.#nodes[this.#indexById.get(edge.source)];
        const target = this.#nodes[this.#indexById.get(edge.target)];
        if (!source || !target) return null;
        return {
          ...edge,
          points: edgePoints(source, target, routing, flowAxis),
        };
      })
      .filter(Boolean);
    for (const node of this.#nodes) if (node.icon) this.#loadIcon(node.icon);
    this.#hovered = -1;
    this.#uploadGeometry();
    this.requestRender();
  }

  /** Nodes drawn faded (everything else normal), e.g. to spotlight a lineage; null for none. */
  setDimmed(ids) {
    this.#dimmed = ids ? new Set(ids) : null;
    this.#uploadGeometry();
    this.requestRender();
  }

  setHighlighted(ids) {
    this.#highlighted = new Set(ids ?? []);
    this.#uploadGeometry();
    this.requestRender();
  }

  select(id) {
    this.#selected = id;
    this.#uploadGeometry();
    this.requestRender();
  }

  bounds() {
    if (!this.#nodes.length) return { x1: 0, y1: 0, x2: 1, y2: 1 };
    return pointsBounds(
      this.#nodes.flatMap((n) => [
        { x: n.x - n.hw, y: n.y - n.hh },
        { x: n.x + n.hw, y: n.y + n.hh },
      ]),
    );
  }

  /** Bring a node to the middle of the view, keeping the zoom. */
  centerOn(id) {
    const node = this.#nodes[this.#indexById.get(id)];
    if (!node) return;
    this.camera.panX = this.width / 2 - node.x * this.camera.zoom;
    this.camera.panY = this.height / 2 - node.y * this.camera.zoom;
    this.requestRender();
  }

  fit() {
    this.camera.fit(this.bounds(), this.width, this.height);
    this.#zoomTarget = null;
    this.requestRender();
  }

  zoomBy(factor) {
    this.camera.zoomAround(factor, this.width / 2, this.height / 2);
    this.requestRender();
  }

  resize() {
    const dpr = globalThis.devicePixelRatio || 1;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    for (const canvas of [this.canvas, this.labels]) {
      canvas.width = Math.max(1, Math.round(this.width * dpr));
      canvas.height = Math.max(1, Math.round(this.height * dpr));
    }
    this.dpr = dpr;
    this.requestRender();
  }

  destroy() {
    cancelAnimationFrame(this.#frame);
    this.resizeObserver.disconnect();
    this.canvas.remove();
    this.labels.remove();
  }

  // ---------------------------------------------------------------- GL setup

  #setUpGl() {
    const gl = this.gl;
    this.nodeProgram = this.#program(NODE_VERTEX, NODE_FRAGMENT);
    this.edgeProgram = this.#program(EDGE_VERTEX, EDGE_FRAGMENT);
    this.triangleProgram = this.#program(TRIANGLE_VERTEX, TRIANGLE_FRAGMENT);

    // Nodes: a unit quad drawn once per node instance.
    this.nodeVao = gl.createVertexArray();
    gl.bindVertexArray(this.nodeVao);
    this.#staticBuffer(0, [-1, -1, 1, -1, -1, 1, 1, 1], 2);
    this.nodeBuffer = gl.createBuffer();
    this.#instanceLayout(this.nodeBuffer, [
      [1, 2],
      [2, 2],
      [3, 4],
      [4, 4],
      [5, 1],
      [6, 4],
    ]);

    // Edge pieces: a quad per segment.
    this.edgeVao = gl.createVertexArray();
    gl.bindVertexArray(this.edgeVao);
    this.#staticBuffer(0, [0, -1, 1, -1, 0, 1, 1, 1], 2);
    this.edgeBuffer = gl.createBuffer();
    this.#instanceLayout(this.edgeBuffer, [
      [1, 2],
      [2, 2],
      [3, 4],
      [4, 1],
    ]);

    // Arrowheads: plain triangles.
    this.triangleVao = gl.createVertexArray();
    gl.bindVertexArray(this.triangleVao);
    this.triangleBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triangleBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);

    // Icon atlas: a 2D canvas the icons are drawn into, uploaded as one texture.
    this.atlasCanvas = document.createElement("canvas");
    this.atlasCanvas.width = this.atlasCanvas.height = ATLAS_SIZE;
    this.atlasContext = this.atlasCanvas.getContext("2d");
    this.iconTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.iconTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      ATLAS_SIZE,
      ATLAS_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  #program(vertexSource, fragmentSource) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  #staticBuffer(location, data, size) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  /** Per-instance attributes interleaved in one buffer: [[location, size], …]. */
  #instanceLayout(buffer, attributes) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = attributes.reduce((sum, [, size]) => sum + size, 0) * 4;
    let offset = 0;
    for (const [location, size] of attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
      offset += size * 4;
    }
  }

  // ---------------------------------------------------------------- geometry

  /** Instance data for every node, edge piece and arrowhead (states such as dimming are baked in). */
  #uploadGeometry() {
    const gl = this.gl;
    const dimmed = this.#dimmed;
    const alphaOf = (id) => (dimmed && dimmed.has(id) ? 0.18 : 1);

    const nodeData = new Float32Array(this.#nodes.length * 17);
    this.#nodes.forEach((node, index) => {
      const alpha = alphaOf(node.id);
      const [br, bg, bb] = rgb(
        node.id === this.#selected || this.#highlighted.has(node.id)
          ? "#ffd166"
          : node.color,
      );
      const [fr, fg, fb] = rgb(node.fill ?? "#1a2030");
      const slot = node.icon ? this.#iconSlots.get(node.icon) : null;
      const icon =
        slot && typeof slot === "object"
          ? [slot.u0, slot.v0, slot.u1, slot.v1]
          : [0, 0, 0, 0];
      nodeData.set(
        [
          node.x,
          node.y,
          node.hw,
          node.hh,
          fr,
          fg,
          fb,
          alpha,
          br,
          bg,
          bb,
          alpha,
          node.id === this.#selected ? 4 : (node.borderWidth ?? 3),
          ...icon,
        ],
        index * 17,
      );
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, nodeData, gl.DYNAMIC_DRAW);
    this.nodeCount = this.#nodes.length;

    const pieces = [];
    const triangles = [];
    for (const edge of this.#edges) {
      const [r, g, b] = rgb(edge.color ?? "#3b4558");
      const alpha =
        dimmed && (dimmed.has(edge.source) || dimmed.has(edge.target))
          ? 0.15
          : 1;
      const points = edge.points;
      for (let i = 1; i < points.length; i++)
        pieces.push(
          points[i - 1].x,
          points[i - 1].y,
          points[i].x,
          points[i].y,
          r,
          g,
          b,
          alpha,
          edge.width ?? 1.6,
        );
      if (edge.arrow !== false) {
        const tip = points[points.length - 1];
        const from = points[points.length - 2];
        for (const corner of arrowHead(from, tip, 9))
          triangles.push(corner.x, corner.y, r, g, b, alpha);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pieces), gl.DYNAMIC_DRAW);
    this.edgePieceCount = pieces.length / 9;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triangleBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(triangles),
      gl.DYNAMIC_DRAW,
    );
    this.triangleVertexCount = triangles.length / 6;
  }

  #loadIcon(url) {
    if (this.#iconSlots.has(url)) return;
    const spot = this.#iconPacker.place(ICON_SIZE, ICON_SIZE);
    if (!spot || spot.page > 0) {
      this.#iconSlots.set(url, "failed"); // atlas full: drawn without its icon
      return;
    }
    this.#iconSlots.set(url, "loading");
    const image = new Image();
    image.crossOrigin = "anonymous"; // render.guildwars2.com allows it; keeps the texture uploadable
    image.onload = () => {
      this.atlasContext.drawImage(image, spot.x, spot.y, ICON_SIZE, ICON_SIZE);
      this.#iconSlots.set(url, {
        u0: spot.x / ATLAS_SIZE,
        v0: spot.y / ATLAS_SIZE,
        u1: (spot.x + ICON_SIZE) / ATLAS_SIZE,
        v1: (spot.y + ICON_SIZE) / ATLAS_SIZE,
      });
      this.#atlasDirty = true;
      this.#scheduleIconRefresh();
    };
    image.onerror = () => this.#iconSlots.set(url, "failed");
    image.src = url;
  }

  #atlasDirty = false;
  #iconRefresh = 0;

  /** Icons arrive one by one: re-upload the atlas and node data at most every 100 ms, not per icon. */
  #scheduleIconRefresh() {
    if (this.#iconRefresh) return;
    this.#iconRefresh = setTimeout(() => {
      this.#iconRefresh = 0;
      this.#uploadGeometry();
      this.requestRender();
    }, 100);
  }

  // ---------------------------------------------------------------- drawing

  requestRender() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  #draw() {
    const started = performance.now();
    if (this.#zoomTarget) this.#stepZoom();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.#atlasDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.iconTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.atlasCanvas,
      );
      gl.generateMipmap(gl.TEXTURE_2D);
      this.#atlasDirty = false;
    }
    const view = this.camera.clipMatrix(this.width, this.height);

    gl.useProgram(this.edgeProgram);
    gl.uniformMatrix3fv(
      gl.getUniformLocation(this.edgeProgram, "view"),
      false,
      view,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.edgeProgram, "viewport"),
      this.width,
      this.height,
    );
    gl.bindVertexArray(this.edgeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.edgePieceCount);

    gl.useProgram(this.triangleProgram);
    gl.uniformMatrix3fv(
      gl.getUniformLocation(this.triangleProgram, "view"),
      false,
      view,
    );
    gl.bindVertexArray(this.triangleVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.triangleVertexCount);

    gl.useProgram(this.nodeProgram);
    gl.uniformMatrix3fv(
      gl.getUniformLocation(this.nodeProgram, "view"),
      false,
      view,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.nodeProgram, "zoom"),
      this.camera.zoom,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.iconTexture);
    gl.uniform1i(gl.getUniformLocation(this.nodeProgram, "icons"), 0);
    gl.bindVertexArray(this.nodeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nodeCount);
    gl.bindVertexArray(null);

    this.#drawLabels();
    this.stats.drawMs = performance.now() - started;
    if (this.#zoomTarget) this.requestRender();
  }

  /**
   * Labels on the 2D layer: only nodes on screen, only when zoomed in enough to read them, and never on top of each
   * other: higher-priority labels (root, selected, hovered, then larger) claim their space first.
   */
  #drawLabels() {
    const context = this.labelContext;
    const dpr = this.dpr;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.labels.width, this.labels.height);
    this.stats.labels = 0;
    const zoom = this.camera.zoom;
    const visible = this.#grid.query(
      this.camera.visibleWorld(this.width, this.height, 50),
    );
    this.stats.visibleNodes = visible.size;
    if (zoom < LABEL_MIN_ZOOM) return;
    const opacity = Math.min(1, (zoom - LABEL_MIN_ZOOM) / 0.15);
    const scale = Math.min(1.6, Math.max(0.75, zoom)); // text grows with zoom, within readable limits
    const priority = (index) => {
      const node = this.#nodes[index];
      if (node.id === this.#selected || index === this.#hovered) return 1e9;
      return (node.priority ?? 0) * 1e6 + node.width;
    };
    const order = [...visible].sort((a, b) => priority(b) - priority(a));
    const taken = [];
    context.globalAlpha = opacity;
    for (const index of order) {
      const node = this.#nodes[index];
      if (!node.label) continue;
      const image = this.#labelImage(node.label, node.labelColor ?? "#e3e6ec");
      const width = (image.width / 2) * scale,
        height = (image.height / 2) * scale;
      const box =
        this.labelPosition === "below"
          ? (() => {
              const screen = this.camera.toScreen(node.x, node.y + node.hh);
              return {
                x1: screen.x - width / 2,
                y1: screen.y + 3,
                x2: screen.x + width / 2,
                y2: screen.y + 3 + height,
              };
            })()
          : (() => {
              const screen = this.camera.toScreen(node.x + node.hw, node.y);
              return {
                x1: screen.x + 4,
                y1: screen.y - height / 2,
                x2: screen.x + 4 + width,
                y2: screen.y + height / 2,
              };
            })();
      if (
        box.x1 > this.width ||
        box.x2 < 0 ||
        box.y1 > this.height ||
        box.y2 < 0
      )
        continue;
      if (
        taken.some(
          (other) =>
            box.x1 < other.x2 &&
            other.x1 < box.x2 &&
            box.y1 < other.y2 &&
            other.y1 < box.y2,
        )
      )
        continue;
      taken.push(box);
      context.globalAlpha = this.#dimmed?.has(node.id)
        ? opacity * 0.2
        : opacity;
      context.drawImage(
        image,
        box.x1 * dpr,
        box.y1 * dpr,
        width * dpr,
        height * dpr,
      );
      this.stats.labels++;
    }
    context.globalAlpha = 1;
  }

  /** A label drawn once at 2× into its own canvas, with a dark backdrop, then reused every frame. */
  #labelImage(text, color) {
    const key = `${color}|${text}`;
    let image = this.#labelCache.get(key);
    if (image) return image;
    const lines = String(text).split("\n");
    const measure = (this.#measureContext ??= document
      .createElement("canvas")
      .getContext("2d"));
    measure.font = LABEL_FONT;
    const width =
      Math.ceil(
        Math.max(...lines.map((line) => measure.measureText(line).width)),
      ) + 8;
    const height = lines.length * LABEL_LINE_HEIGHT + 4;
    image = document.createElement("canvas");
    image.width = width * 2;
    image.height = height * 2;
    const context = image.getContext("2d");
    context.scale(2, 2);
    context.fillStyle = "rgba(11, 14, 20, 0.78)";
    context.beginPath();
    context.roundRect?.(0, 0, width, height, 3);
    context.fill();
    context.font = LABEL_FONT;
    context.fillStyle = color;
    context.textBaseline = "top";
    lines.forEach((line, i) =>
      context.fillText(line, 4, 3 + i * LABEL_LINE_HEIGHT),
    );
    this.#labelCache.set(key, image);
    return image;
  }

  #measureContext = null;

  // ---------------------------------------------------------------- input

  #bindInput() {
    const canvas = this.canvas;
    const pointers = new Map();
    let dragged = false,
      lastTap = { id: null, at: 0 },
      pinchDistance = 0;

    const nodeAt = (event) => {
      const rect = canvas.getBoundingClientRect();
      const world = this.camera.toWorld(
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      return this.#grid.hit(world.x, world.y);
    };

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        // Smooth zoom: aim for a target and ease toward it over a few frames.
        const factor = Math.exp(-event.deltaY * 0.0015);
        const base = this.#zoomTarget?.zoom ?? this.camera.zoom;
        this.#zoomTarget = {
          zoom: Math.min(
            this.camera.maxZoom,
            Math.max(this.camera.minZoom, base * factor),
          ),
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        this.requestRender();
      },
      { passive: false },
    );

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragged = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        this.handlers.onPointerMove?.(event);
        const index = nodeAt(event);
        if (index !== this.#hovered) {
          this.#hovered = index;
          canvas.style.cursor = index >= 0 ? "pointer" : "";
          this.handlers.onNodeHover?.(
            index >= 0 ? this.#nodes[index].id : null,
            event,
          );
          this.requestRender();
        }
        return;
      }
      const current = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, current);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = canvas.getBoundingClientRect();
        if (pinchDistance)
          this.camera.zoomAround(
            distance / pinchDistance,
            (a.x + b.x) / 2 - rect.left,
            (a.y + b.y) / 2 - rect.top,
          );
        pinchDistance = distance;
      } else {
        const dx = current.x - previous.x,
          dy = current.y - previous.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) dragged ||= Math.hypot(dx, dy) > 2;
        this.camera.panBy(dx, dy);
      }
      this.handlers.onViewportChange?.();
      this.requestRender();
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
    };
    canvas.addEventListener("pointerup", (event) => {
      const wasDrag = dragged;
      release(event);
      if (wasDrag) return;
      const index = nodeAt(event);
      if (index < 0) {
        this.handlers.onBackgroundTap?.();
        return;
      }
      const id = this.#nodes[index].id;
      const now = performance.now();
      if (lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS) {
        lastTap = { id: null, at: 0 };
        this.handlers.onNodeDoubleTap?.(id);
      } else {
        lastTap = { id, at: now };
        this.handlers.onNodeTap?.(id, event);
      }
    });
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", () => {
      if (this.#hovered >= 0) {
        this.#hovered = -1;
        this.handlers.onNodeHover?.(null, null);
        this.requestRender();
      }
    });
  }

  #stepZoom() {
    const target = this.#zoomTarget;
    const ratio = target.zoom / this.camera.zoom;
    if (Math.abs(Math.log(ratio)) < 0.002) {
      this.camera.zoomAround(ratio, target.x, target.y);
      this.#zoomTarget = null;
    } else this.camera.zoomAround(Math.pow(ratio, 0.3), target.x, target.y);
    this.handlers.onViewportChange?.();
  }
}
