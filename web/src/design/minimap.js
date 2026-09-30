/**
 * A small overview of the whole graph (design-branch prototype): every node as a dot in its colour, the visible
 * area as a frame. Click or drag in it to move the view there. Built on Prism's public camera API: positions(),
 * getViewport() / setViewport() and the viewportChange, render, drag and physics events.
 */

const WIDTH = 184;
const HEIGHT = 120;
const PAD = 8;
/**
 * After something moves nodes (a re-layout, growing a new tree, physics), keep redrawing until they have been still
 * for STILL_FRAMES frames, for at least FOLLOW_MS and at most FOLLOW_MAX_MS.
 */
const FOLLOW_MS = 400;
const FOLLOW_MAX_MS = 15000;
const STILL_FRAMES = 20;

export class Minimap {
  #view;
  #container;
  #colorOf;
  #canvas;
  #context;
  #visible = false;
  #followUntil = 0;
  #followLimit = 0;
  /** A cheap fingerprint of the last drawn positions, and for how many frames it hasn't changed. */
  #lastFingerprint = 0;
  #stillFrames = 0;
  #frame = 0;
  /** graph → minimap transform from the last draw: minimap = graph·scale + offset */
  #transform = { scale: 1, offsetX: 0, offsetY: 0 };

  /**
   * @param {import('../render/webgl-graph-view.js').WebGLGraphView} view
   * @param {HTMLElement} container  the graph's wrapper (the minimap floats in its corner)
   * @param {{ colorOf(nodeId: string): string | null }} options
   */
  constructor(view, container, { colorOf }) {
    this.#view = view;
    this.#container = container;
    this.#colorOf = colorOf;
    this.#canvas = document.createElement("canvas");
    this.#canvas.className = "dl-minimap";
    this.#canvas.hidden = true;
    this.#canvas.setAttribute("role", "img");
    this.#canvas.setAttribute(
      "aria-label",
      "Overview of the graph; click to move the view",
    );
    const ratio = globalThis.devicePixelRatio || 1;
    this.#canvas.width = WIDTH * ratio;
    this.#canvas.height = HEIGHT * ratio;
    this.#context = this.#canvas.getContext("2d");
    this.#context.scale(ratio, ratio);
    container.append(this.#canvas);

    view.on("viewportChange", () => this.redraw());
    for (const type of ["render", "drag", "physicsStart"])
      view.on(type, () => this.#follow());
    view.on("physicsSettle", () => this.redraw());
    this.#bindPointer();
  }

  setVisible(visible) {
    this.#visible = visible;
    this.#canvas.hidden = !visible;
  }

  /** Redraw on the next frame (cheap to call often). */
  redraw() {
    if (!this.#visible || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
      const now = performance.now();
      if (
        now < this.#followLimit &&
        (now < this.#followUntil || this.#stillFrames < STILL_FRAMES)
      )
        this.redraw();
    });
  }

  /** Nodes are moving: keep redrawing for a while. */
  #follow() {
    const now = performance.now();
    this.#followUntil = now + FOLLOW_MS;
    this.#followLimit = now + FOLLOW_MAX_MS;
    this.#stillFrames = 0;
    this.redraw();
  }

  #draw() {
    const context = this.#context;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    const positions = [...this.#view.positions()].filter(([, p]) => p);
    if (!positions.length) return;
    let fingerprint = 0;
    for (const [, { x, y }] of positions) fingerprint += x * 3 + y * 7;
    if (Math.abs(fingerprint - this.#lastFingerprint) < 0.5)
      this.#stillFrames++;
    else this.#stillFrames = 0;
    this.#lastFingerprint = fingerprint;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [, { x, y }] of positions) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const scale = Math.min(
      (WIDTH - PAD * 2) / Math.max(maxX - minX, 1),
      (HEIGHT - PAD * 2) / Math.max(maxY - minY, 1),
    );
    const offsetX = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetY = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;
    this.#transform = { scale, offsetX, offsetY };

    const root = this.#view.rootNodeId;
    for (const [id, { x, y }] of positions) {
      context.fillStyle = this.#colorOf(id) ?? "#8a93a6";
      context.beginPath();
      context.arc(
        x * scale + offsetX,
        y * scale + offsetY,
        id === root ? 3.2 : 1.8,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    // The visible area: the container's corners in graph coordinates.
    const { zoom, panX, panY } = this.#view.getViewport();
    const size = this.#graphContainerSize();
    const left = (-panX / zoom) * scale + offsetX;
    const top = (-panY / zoom) * scale + offsetY;
    context.strokeStyle = "rgba(230, 232, 235, 0.85)";
    context.fillStyle = "rgba(230, 232, 235, 0.06)";
    context.lineWidth = 1;
    const frameWidth = (size.x / zoom) * scale;
    const frameHeight = (size.y / zoom) * scale;
    context.fillRect(left, top, frameWidth, frameHeight);
    context.strokeRect(left + 0.5, top + 0.5, frameWidth, frameHeight);
  }

  #graphContainerSize() {
    const graph = this.#container.querySelector("#cy") ?? this.#container;
    return { x: graph.clientWidth, y: graph.clientHeight };
  }

  /** Centre the view on the graph point under a minimap point. */
  #moveTo(event) {
    const rect = this.#canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = this.#transform;
    const graphX = (event.clientX - rect.left - offsetX) / scale;
    const graphY = (event.clientY - rect.top - offsetY) / scale;
    const { zoom } = this.#view.getViewport();
    const size = this.#graphContainerSize();
    this.#view.setViewport(
      { panX: size.x / 2 - graphX * zoom, panY: size.y / 2 - graphY * zoom },
      { animate: event.type === "pointerdown" },
    );
  }

  #bindPointer() {
    let dragging = false;
    this.#canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      this.#canvas.setPointerCapture(event.pointerId);
      this.#moveTo(event);
    });
    this.#canvas.addEventListener("pointermove", (event) => {
      if (dragging) this.#moveTo(event);
    });
    const stop = () => (dragging = false);
    this.#canvas.addEventListener("pointerup", stop);
    this.#canvas.addEventListener("pointercancel", stop);
  }
}
