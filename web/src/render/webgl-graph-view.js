import { GraphController, GraphModel, glRenderer } from "prismatrix";
import { edgeSourceRules } from "./edge-sources.js";
import {
  animationOptions,
  classList,
  edgeJSON,
  gw2ClassStyles,
  layoutSettings,
  modelOptions,
  nodeJSON,
  themeOptions,
} from "./prism-settings.js";
import { tokenTheme } from "./theme-tokens.js";

/** Old view event names → Prismatrix's (the minimap still asks by the old ones). */
const EVENTS = {
  viewportChange: "camera",
  render: "laidOut",
  drag: "dragStart",
  physicsStart: "graph",
  physicsSettle: "settled",
};

/** Fitting a graph smaller than this zoom (labels unreadable) opens on the root instead ("smart" fit). */
const SMART_FIT_MIN = 0.3;
/** Padding round a picture of the graph (boundingBox, toPngDataUri), world px. */
const EXPORT_PADDING = 30;

/**
 * Prismatrix (graph rendering, layout and physics) behind the interface the pages use (render, select, highlight,
 * fit, export…), so a page doesn't change with the engine. This adapter speaks the app's language: it maps the
 * settings to Prismatrix's layout, physics, animation, node and edge options and theme; the pages' `{ data, classes }`
 * elements to Prismatrix's nodes and edges, each with its own style (the item states' classes become style:
 * prism-settings.js); and Prismatrix's events back to the pages' handlers.
 */
export class WebGLGraphView {
  #settings;
  #page;
  #handlers;
  #canvas;
  #renderer;
  #model;
  #controller;
  /** The page's own class styles (setClassStyles), applied after the item states'. */
  #pageRules = { nodes: {}, edges: {} };
  /** The elements last rendered, by id (updateInPlace merges into them): what the graph is rebuilt from. */
  #nodes = new Map();
  #edges = [];
  #rootId = null;
  /** What was last handed to Prismatrix, so unchanged settings don't restyle everything. */
  #sent = { layout: "", physics: "", animation: "", theme: "", options: "" };
  /** The last pointer events on the canvas: for a tap's modifier keys and a tooltip's position. */
  #pointer = null;
  #pressed = null;

  /**
   * @param {{ container: HTMLElement, settings: { values: object },
   *   handlers: object, flowToward?: "source" | "target" }} options flowToward: which way a lit lineage's pulses run
   *   along the page's edges (to the product: "source" where edges run product → ingredient)
   */
  constructor({ container, settings, handlers = {}, flowToward = "source" }) {
    this.#settings = settings;
    this.#page = { flowToward };
    this.#handlers = handlers;
    const values = settings.values;
    const canvas = (this.#canvas = document.createElement("canvas"));
    canvas.className = "graph-canvas";
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
    });
    // The page's graph container is the accessible surface (role, description, keyboard, live announcements).
    canvas.setAttribute("aria-hidden", "true");
    container.append(canvas);
    this.#model = new GraphModel(
      { nodes: [], edges: [] },
      modelOptions(values),
    );
    this.#renderer = glRenderer(canvas);
    const layout = layoutSettings(values);
    this.#controller = new GraphController(this.#model, this.#renderer, {
      ...layout,
      animation: animationOptions(values, this.#page),
      theme: themeOptions(values, tokenTheme()),
      tapSelects: false,
      worker: "auto",
    });
    this.#sent = this.#wanted(values);
    this.#bindEvents();
  }

  /** Prismatrix's controller, for developer tools. */
  get controller() {
    return this.#controller;
  }

  get rootNodeId() {
    return this.#rootId;
  }

  // ---------------------------------------------------------------- settings

  /**
   * Extra looks for a page's own classes, as Prismatrix style (see prism-settings.js):
   * { nodes: { className: { stroke, strokeStyle, opacity, aura, ring, pinLabel, … } },
   *   edges: { className: { color, width, dash, glow } } }
   */
  setClassStyles(rules) {
    this.#pageRules = { nodes: rules?.nodes ?? {}, edges: rules?.edges ?? {} };
    this.#rebuild();
  }

  /** What each setting asks of Prismatrix now, as JSON (to tell what changed). */
  #wanted(values) {
    const layout = layoutSettings(values);
    return {
      layout: JSON.stringify([layout.layout, layout.layoutOptions]),
      physics: JSON.stringify([layout.physics, layout.physicsOptions]),
      animation: JSON.stringify(animationOptions(values, this.#page)),
      theme: JSON.stringify(themeOptions(values, tokenTheme())),
      options: JSON.stringify(modelOptions(values)),
    };
  }

  /**
   * Hand Prismatrix whatever settings changed: layout, physics, animation, theme, node and edge options, and the
   * nodes' and edges' own styles. Cheap when nothing did. The page calls it after every settings change.
   */
  syncSettings() {
    this.#syncOptions();
    // Node and edge styles follow settings too (borders, tints, icons, the item states' looks).
    this.#rebuild();
  }

  /** The settings' options, each handed over only when it changed. */
  #syncOptions() {
    const values = this.#settings.values;
    const c = this.#controller;
    const wanted = this.#wanted(values);
    const sent = this.#sent;
    this.#sent = wanted;
    if (wanted.options !== sent.options)
      this.#model.setOptions(modelOptions(values), { reset: true });
    if (wanted.animation !== sent.animation)
      c.setAnimation(animationOptions(values, this.#page));
    if (wanted.theme !== sent.theme)
      c.setTheme(themeOptions(values, tokenTheme()));
    const layout = layoutSettings(values);
    if (wanted.layout !== sent.layout)
      c.setLayout(layout.layout, layout.layoutOptions);
    if (wanted.physics !== sent.physics || wanted.layout !== sent.layout)
      c.setPhysics(layout.physics, layout.physicsOptions);
  }

  // ---------------------------------------------------------------- the graph

  /** The class styles in force: the item states', the edge sources' (when edges are coloured by source), the page's. */
  #rules() {
    const values = this.#settings.values;
    const gw2 = gw2ClassStyles(values);
    const sources =
      values.edgeColorMode === "source" ? edgeSourceRules().edges : {};
    return {
      nodes: { ...gw2.nodes, ...this.#pageRules.nodes },
      edges: { ...gw2.edges, ...sources, ...this.#pageRules.edges },
    };
  }

  /** The elements as Prismatrix graph JSON. */
  #graphJSON() {
    const values = this.#settings.values;
    const rules = this.#rules();
    const fill = tokenTheme().card;
    return {
      nodes: [...this.#nodes.values()].map((element) =>
        nodeJSON(element, values, rules, fill),
      ),
      edges: this.#edges.map((element) => edgeJSON(element, rules, values)),
    };
  }

  /** Show the elements as they are now (unchanged nodes and edges are kept; only what changed is redone). */
  #rebuild() {
    this.#controller.setGraph(this.#graphJSON());
  }

  /**
   * Draw these elements (`{ data, classes }`), morphing from what's shown. `fit`: true frames the graph, "smart" too
   * unless it would be too small to read (then it opens on the root). `anchorNodeId`: the view holds still on the
   * selection while the graph changes round it, rather than framing it again.
   */
  render({ nodeElements, edgeElements, fit = false, anchorNodeId = null }) {
    this.#nodes = new Map(nodeElements.map((e) => [e.data.id, e]));
    this.#edges = edgeElements;
    this.#rootId =
      nodeElements.find((e) => classList(e.classes).includes("root"))?.data
        .id ?? null;
    const c = this.#controller;
    // Kept where it is: a camera "set by hand" holds still on the selected node while the layout changes.
    if (anchorNodeId && !fit) c.setCamera({});
    this.#syncOptions();
    this.#rebuild();
    if (fit)
      c.laidOut().then(
        () => this.#fit(fit === "smart"),
        () => {},
      );
  }

  #fit(smart) {
    const c = this.#controller;
    c.fit();
    const k = c.cameraTween?.to?.k ?? c.camera.k;
    if (smart && k < SMART_FIT_MIN && this.#rootId)
      c.focus(this.#rootId, { zoom: 0.8 });
  }

  /** New labels, colours and classes without a re-layout (e.g. prices arrived); edges take their ends' new colours. */
  updateInPlace(nodeUpdates, edgeUpdates = []) {
    for (const { id, data, classes } of nodeUpdates) {
      const old = this.#nodes.get(id);
      if (!old) continue;
      this.#nodes.set(id, {
        ...old,
        data: { ...old.data, ...data },
        classes: classes ?? old.classes,
      });
    }
    if (edgeUpdates.length) {
      const changes = new Map(edgeUpdates.map((u) => [u.id, u.data]));
      this.#edges = this.#edges.map((e) =>
        changes.has(e.data.id)
          ? { ...e, data: { ...e.data, ...changes.get(e.data.id) } }
          : e,
      );
    }
    this.#rebuild();
  }

  clear() {
    this.#nodes = new Map();
    this.#edges = [];
    this.#rootId = null;
    this.#controller.setGraph({ nodes: [], edges: [] });
  }

  /** Stop everything and remove the canvases (a component unmounting). */
  destroy() {
    this.#controller.destroy();
    this.#renderer.dispose();
    this.#canvas.remove();
  }

  // ---------------------------------------------------------------- selection, highlights, lineage

  select(nodeId) {
    this.#controller.select(nodeId ?? null);
  }

  hasNode(nodeId) {
    return !!this.#model.node(nodeId);
  }

  /** A quick ring that leaves the node: feedback for a tap. */
  pulse(nodeId) {
    this.#controller.pulse(nodeId);
  }

  /** Make nodes glow for a moment (jumping to an ingredient from the side panel). */
  flash(nodeIds, durationMs) {
    this.#controller.flash([...nodeIds], durationMs);
  }

  /** Legend highlight: these nodes glow, everything else fades. Null or empty clears it. */
  setHighlightedNodes(nodeIds) {
    this.#controller.highlight(
      nodeIds?.size || nodeIds?.length ? [...nodeIds] : null,
    );
  }

  // ---------------------------------------------------------------- viewport and export

  fit() {
    this.#controller.fit();
  }

  zoomBy(factor) {
    this.#controller.zoomBy(factor);
  }

  centerOnRoot() {
    if (!this.#rootId) return;
    this.#controller.focus(this.#rootId, {
      zoom: Math.max(this.#controller.camera.k, 0.8),
    });
  }

  /** Bring a node on screen if it isn't (keyboard navigation), without zooming. */
  revealNode(nodeId) {
    const c = this.#controller;
    if (c.isHidden(nodeId)) c.reveal(nodeId);
    const p = c.nodePosition(nodeId);
    if (!p) return;
    const s = c.toScreen(p.x, p.y);
    const margin = 60;
    if (
      s.x < margin ||
      s.y < margin ||
      s.x > c.width - margin ||
      s.y > c.height - margin
    )
      c.setCamera({ x: p.x, y: p.y }, { animate: true });
  }

  /**
   * Frame these nodes (and, with `includeNeighbours`, the nodes linked to them), `padding` CSS px clear round them,
   * gliding there.
   * @param {Iterable<string>} nodeIds
   * @param {{ padding?: number, includeNeighbours?: boolean }} [options]
   */
  focusOn(nodeIds, { padding = 40, includeNeighbours = false } = {}) {
    const c = this.#controller;
    const ids = new Set(nodeIds);
    if (includeNeighbours)
      for (const e of this.#model.edges)
        if (ids.has(e.source) || ids.has(e.target)) {
          ids.add(e.source);
          ids.add(e.target);
        }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of ids) {
      const p = c.nodePosition(id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (minX > maxX) return;
    const room = 60; // a node and its label round each point
    const k = Math.min(
      (c.width - padding * 2) / Math.max(maxX - minX + room * 2, 1),
      (c.height - padding * 2) / Math.max(maxY - minY + room * 2, 1),
      1.6,
    );
    c.setCamera(
      { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k },
      { animate: true },
    );
  }

  /**
   * A PNG of the whole graph as shown (highlight included), `scale` device px per graph px.
   * @returns {Promise<string>} a data: URI
   */
  async toPngDataUri({ scale = 2, backgroundColor = null } = {}) {
    const canvas = await this.#controller.toImage({
      scale,
      padding: EXPORT_PADDING,
      background: backgroundColor,
    });
    return canvas.toDataURL("image/png");
  }

  /** The box the whole graph covers (graph px, with the export's padding): `{ x1, y1, x2, y2, w, h }`. */
  boundingBox() {
    const b = this.#controller.bounds();
    const x1 = b.minX - EXPORT_PADDING,
      y1 = b.minY - EXPORT_PADDING,
      x2 = b.maxX + EXPORT_PADDING,
      y2 = b.maxY + EXPORT_PADDING;
    return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  }

  // ---------------------------------------------------------------- camera and events (the minimap)

  /** `{ zoom, panX, panY }`, where a graph point (x, y) is drawn at (x·zoom + panX, y·zoom + panY). */
  getViewport() {
    const c = this.#controller;
    const { x, y, k } = c.camera;
    return { zoom: k, panX: c.width / 2 - x * k, panY: c.height / 2 - y * k };
  }

  setViewport({ zoom, panX, panY }, { animate = false } = {}) {
    const c = this.#controller;
    const k = zoom ?? c.camera.k;
    c.setCamera(
      {
        k,
        ...(panX !== undefined && { x: (c.width / 2 - panX) / k }),
        ...(panY !== undefined && { y: (c.height / 2 - panY) / k }),
      },
      { animate },
    );
  }

  /** Every node's position now: id → { x, y } (graph coordinates). */
  positions() {
    return this.#controller.positions();
  }

  /** Subscribe to a view event (viewportChange, render, drag, physicsStart, physicsSettle); returns the unsubscribe. */
  on(type, listener) {
    return this.#controller.on(EVENTS[type] ?? type, listener);
  }

  /** Prismatrix's events, and the canvas's own pointer events, to the page's handlers. */
  #bindEvents() {
    const h = this.#handlers;
    const c = this.#controller;
    const canvas = this.#canvas;
    canvas.addEventListener("pointermove", (event) => {
      this.#pointer = event;
      h.onPointerMove?.(event);
    });
    canvas.addEventListener("pointerdown", (event) => {
      this.#pressed = event;
      this.#pointer = event;
    });
    canvas.addEventListener("contextmenu", (event) => {
      const rect = canvas.getBoundingClientRect();
      const i = c.hit(
        c.toWorld(event.clientX - rect.left, event.clientY - rect.top),
      );
      if (i < 0) return;
      event.preventDefault();
      h.onNodeContextTap?.(c.graph.nodes[i].id, event);
    });
    c.on("tap", ({ node, reference }) => {
      if (!node) return h.onBackgroundTap?.();
      // A tap on a reference chip (merged view) is a tap on its ingredient: fly there too.
      if (reference) c.focus(node);
      h.onNodeTap?.(node, this.#pressed);
    });
    c.on("doubleTap", ({ node }) => {
      if (node) h.onNodeDoubleTap?.(node);
    });
    c.on("hoverEnter", ({ node }) => h.onNodeHoverStart?.(node, this.#pointer));
    c.on("hoverLeave", () => h.onNodeHoverEnd?.());
    c.on("camera", () => h.onViewportChange?.());
  }
}
