import {
  FORGE_BADGE_URI,
  LAYOUT_BASE,
  PERFORMANCE_LIMITS,
  UI_COLORS,
  ZOOM_LIMITS,
} from "../config/constants.js";
import { LayoutGraph } from "../layout/layout-graph.js";
import { runLayout } from "../layout/run-layout.js";
import {
  isDirectionalLayout,
  treeDirection,
} from "../graph/layout-geometry.js";
import { WebGLGraph } from "./webgl-graph.js";
import {
  resolveEdgeStyle,
  resolveFlowAxis,
  resolveLabelPosition,
  resolveNodeStyle,
  resolveRouting,
} from "./style-resolver.js";
import { planTransition } from "./transition-plan.js";
import { labelBox, labelFont, layoutLabel } from "./labels.js";

/** Graphs up to this size morph between renders; bigger ones snap (springs handle thousands, but not forever). */
const MAX_ANIMATED_NODES = 5000;

/**
 * Prism behind the interface the pages use for GraphView (render, select, lineage, fit, export…), so a
 * page can switch renderers without other changes. Layouts come from ../layout/ (the same ones the classic renderer
 * uses), with room for each label as the engine draws it; everything drawn and animated is the engine's.
 */
export class WebGLGraphView {
  #settings;
  #handlers;
  #canvasWrapper;
  #classStyles = {};
  /** What's drawn: id → { data, classes: Set }, and the edges with their ends. */
  #nodes = new Map();
  #edges = new Map();
  /** child → parent in the graph on screen, so removed nodes can fold into their parents. */
  #parentOf = new Map();
  #outgoing = new Map();
  #incoming = new Map();
  #simulation = null;
  #stopPhysics = null;
  #hoverTimer = 0;
  #pinnedNodeId = null;
  #lineage = { nodeId: null, isPinned: false, dimmed: null };
  #legendIds = null;
  #flashIds = null;
  #flashTimer = 0;
  #pendingFit = false;

  /**
   * @param {{ container: HTMLElement, canvasWrapper?: HTMLElement, settings: { values: object },
   *           handlers: object }} options  the same as GraphView's
   */
  constructor({ container, canvasWrapper, settings, handlers }) {
    this.#settings = settings;
    this.#handlers = handlers;
    this.#canvasWrapper = canvasWrapper ?? null;
    this.graph = new WebGLGraph(
      container,
      {
        onNodeTap: (id, event) => handlers.onNodeTap?.(id, event),
        onNodeDoubleTap: (id) => handlers.onNodeDoubleTap?.(id),
        onNodeContextTap: (id) => handlers.onNodeContextTap?.(id),
        onBackgroundTap: () => handlers.onBackgroundTap?.(),
        onNodeHover: (id, event) =>
          id
            ? handlers.onNodeHoverStart?.(id, event)
            : handlers.onNodeHoverEnd?.(),
        onPointerMove: (event) => handlers.onPointerMove?.(event),
        onViewportChange: () => this.#onViewportChange(),
        onNodeDragStart: (id) => this.#dragStart(id),
        onNodeDrag: (id, x, y) => this.#simulation?.fix(id, { x, y }),
        onNodeDragEnd: (id) => this.#dragEnd(id),
      },
      {
        // ?screenshot keeps frames readable for screenshots (a little slower).
        preserveDrawingBuffer: new URLSearchParams(
          globalThis.location?.search,
        ).has("screenshot"),
        badgeUrl: FORGE_BADGE_URI,
      },
    );
    // The page's graph container is the accessible surface (role, description, keyboard, live announcements).
    for (const canvas of [this.graph.canvas, this.graph.labelCanvas])
      canvas.setAttribute("aria-hidden", "true");
    this.graph.camera.minZoom = ZOOM_LIMITS.min;
    this.graph.camera.maxZoom = ZOOM_LIMITS.max;
    new ResizeObserver(() => {
      if (this.#pendingFit && container.clientWidth) this.fit();
    }).observe(container);
    this.#applyOptions();
    this.syncBackground();
  }

  get #values() {
    return this.#settings.values;
  }

  get rootNodeId() {
    for (const [id, node] of this.#nodes)
      if (node.classes.has("root")) return id;
    return undefined;
  }

  /**
   * Extra looks for a page's own classes, in renderer-neutral terms (see style-resolver.js):
   * { nodes: { className: { pattern, border, borderWidth, fillAlpha, aura } }, edges: { className: { color, width, glow } } }
   */
  setClassStyles(rules) {
    this.#classStyles = rules ?? {};
    this.#restyle();
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Replace the graph, morphing from the previous one: survivors glide to their new places, new nodes grow out of
   * their nearest surviving ancestor (level by level from the root for a new tree), removed ones fold into theirs.
   * Same arguments as GraphView.render.
   */
  render({
    nodeElements,
    edgeElements,
    nodesById,
    fit = false,
    anchorNodeId = null,
    grow = false,
  }) {
    const values = this.#values;
    const graph = this.graph;
    this.#clearTimers();
    this.#stopPhysics?.();
    this.#lineage = { nodeId: null, isPinned: false, dimmed: null };
    this.#legendIds = this.#flashIds = null;

    const previous = new Map(
      grow ? [] : graph.nodeIds().map((id) => [id, graph.positionOf(id)]),
    );
    const anchorScreen =
      anchorNodeId && previous.has(anchorNodeId)
        ? graph.screenPositionOf(anchorNodeId)
        : null;
    const parentOf = new Map(
      edgeElements.map((e) => [e.data.target, e.data.source]),
    );
    const rootId = nodeElements[0]?.data.id;
    const plan = planTransition({
      previous,
      nodeIds: nodeElements.map((e) => e.data.id),
      parentOf,
      previousParentOf: this.#parentOf,
      rootId,
    });
    this.#parentOf = parentOf;

    this.#nodes = new Map(
      nodeElements.map((e) => [
        e.data.id,
        { data: e.data, classes: classSet(e.classes) },
      ]),
    );
    this.#edges = new Map(
      edgeElements.map((e) => [
        e.data.id,
        {
          data: e.data,
          classes: classSet(e.classes),
          source: e.data.source,
          target: e.data.target,
        },
      ]),
    );
    this.#indexEdges();

    // Lay out, seeded with where things are now (the physics continues from there).
    const styles = new Map(
      nodeElements.map((e) => [e.data.id, this.#nodeStyle(e.data.id)]),
    );
    const layoutGraph = new LayoutGraph(
      nodeElements.map((e) => {
        const id = e.data.id;
        const style = styles.get(id);
        const start = plan.startOf(id) ?? { x: 0, y: 0 };
        return {
          id,
          w: style.size,
          h: style.size,
          ...this.#footprint(style),
          x: start.x,
          y: start.y,
          root: this.#nodes.get(id).classes.has("root"),
        };
      }),
      edgeElements.map((e) => ({
        source: e.data.source,
        target: e.data.target,
      })),
    );
    this.#simulation = runLayout(layoutGraph, values, {
      hasPreviousPositions: previous.size > 0,
    });

    const finalPositions = new Map();
    const nodes = layoutGraph.ids.map((id, i) => {
      const position = { x: layoutGraph.x[i], y: layoutGraph.y[i] };
      finalPositions.set(id, position);
      const style = styles.get(id);
      return {
        id,
        ...position,
        width: style.size,
        height: style.size,
        style,
      };
    });
    const animate =
      values.animationsEnabled &&
      nodes.length <= MAX_ANIMATED_NODES &&
      graph.width > 0;
    const duration = values.animationDuration;
    const stagger =
      grow &&
      values.growNewTrees &&
      nodes.length <= PERFORMANCE_LIMITS.maxStaggeredNodes;
    const depthOf = (id) => nodesById?.get(id)?.depth ?? 0;
    const delays = new Map();
    const spawnFrom = new Map();
    for (const { id } of nodes) {
      if (grow) spawnFrom.set(id, finalPositions.get(rootId));
      else if (!previous.has(id)) spawnFrom.set(id, plan.startOf(id));
      if (stagger)
        delays.set(id, Math.min(depthOf(id) * duration * 0.18, duration * 1.4));
    }
    graph.setGraph(
      {
        nodes,
        edges: [...this.#edges].map(([id]) => ({
          id,
          source: this.#edges.get(id).source,
          target: this.#edges.get(id).target,
          style: this.#edgeStyle(id),
        })),
        ...this.#routing(),
      },
      {
        animate,
        spawnFrom,
        delays,
        ghostTo: plan.ghostDestinations(finalPositions, anchorNodeId),
      },
    );
    graph.setDimmed(null);
    graph.setEmphasis(null);
    graph.setEdgeEmphasis(null);
    graph.setLabelFocus(null);

    const view = this.#targetView({ fit, anchorNodeId, anchorScreen });
    if (view) graph.moveCamera(view, { animate });
  }

  /** Remove everything: no elements, no running animation or physics. */
  clear() {
    this.#clearTimers();
    this.#stopPhysics?.();
    this.#simulation = null;
    this.#lineage = { nodeId: null, isPinned: false, dimmed: null };
    this.#nodes = new Map();
    this.#edges = new Map();
    this.#parentOf = new Map();
    this.#indexEdges();
    this.graph.setGraph({ nodes: [], edges: [] });
  }

  /** New labels, colours and classes without a re-layout (e.g. prices arrived). */
  updateInPlace(nodeUpdates, edgeUpdates) {
    const nodeStyles = [],
      edgeStyles = [];
    for (const { id, data, classes } of nodeUpdates) {
      const node = this.#nodes.get(id);
      if (!node) continue;
      node.data = { ...node.data, label: data.label, color: data.color };
      node.classes = classSet(classes);
      nodeStyles.push({ id, style: this.#nodeStyle(id) });
    }
    for (const { id, data } of edgeUpdates) {
      const edge = this.#edges.get(id);
      if (!edge) continue;
      edge.data = { ...edge.data, ...data };
      edgeStyles.push({ id, style: this.#edgeStyle(id) });
    }
    this.graph.updateStyles(nodeStyles, edgeStyles);
  }

  /** A style-only setting changed. */
  applyStylesheet() {
    this.#applyOptions();
    this.#restyle();
    this.#showPinnedLineage({ force: true });
  }

  #restyle() {
    this.graph.updateStyles(
      [...this.#nodes.keys()].map((id) => ({ id, style: this.#nodeStyle(id) })),
      [...this.#edges.keys()].map((id) => ({ id, style: this.#edgeStyle(id) })),
    );
    this.graph.setRouting(this.#routing());
  }

  #applyOptions() {
    const s = this.#values;
    this.graph.setOptions({
      motion: {
        enabled: s.animationsEnabled,
        durationMs: s.animationDuration,
        feel: s.animationEasing,
      },
      dimAlpha: s.dimOpacity,
      flowSpeed: s.flowSpeed,
      smoothZoom: s.smoothZoom,
      zoomSpeed: s.zoomSpeed,
      labels: {
        position: resolveLabelPosition(s),
        backdrop: s.labelBackdrop,
        fadeZoom: s.labelFadeZoom,
        maxWidth: LAYOUT_BASE.labelWidth * s.labelWrapScale,
        overflow: s.labelOverflow,
      },
    });
  }

  #routing() {
    const s = this.#values;
    return {
      routing: resolveRouting(s),
      flowAxis: resolveFlowAxis(s),
      cornerRadius: s.edgeCornerRadius,
      curvature: s.edgeCurvature ?? 1,
    };
  }

  /**
   * A node's footprint with its label (the box they make together), as the engine will draw it at zoom 1. The
   * layouts leave this much room.
   */
  #footprint(style) {
    const size = style.size;
    if (!style.label) return { fullW: size, fullH: size };
    const s = this.#values;
    const font = labelFont(style.fontSize, style.bold);
    const wrapWidth = LAYOUT_BASE.labelWidth * s.labelWrapScale;
    const key = `${font}|${wrapWidth}|${s.labelOverflow}|${style.label}`;
    let label = this.#labelSizes.get(key);
    if (!label) {
      const measure = (this.#measureContext ??= document
        .createElement("canvas")
        .getContext("2d"));
      measure.font = font;
      label = layoutLabel(
        style.label,
        { fontSize: style.fontSize, wrapWidth, overflow: s.labelOverflow },
        (text) => measure.measureText(text).width,
      );
      if (this.#labelSizes.size > 20000) this.#labelSizes.clear();
      this.#labelSizes.set(key, label);
    }
    const half = size / 2;
    const box = labelBox(
      resolveLabelPosition(s),
      half,
      half,
      label.width,
      label.height,
    );
    return {
      fullW: Math.max(half, box.x2) - Math.min(-half, box.x1),
      fullH: Math.max(half, box.y2) - Math.min(-half, box.y1),
    };
  }

  #labelSizes = new Map();
  #measureContext = null;

  #nodeStyle(id) {
    const { data, classes } = this.#nodes.get(id);
    const style = resolveNodeStyle(
      classes,
      data,
      this.#values,
      this.#classStyles,
    );
    style.icon = data.icon ?? null;
    return style;
  }

  #edgeStyle(id) {
    const { data, classes } = this.#edges.get(id);
    return resolveEdgeStyle(classes, data, this.#values, this.#classStyles);
  }

  #indexEdges() {
    this.#outgoing = new Map();
    this.#incoming = new Map();
    for (const [id, edge] of this.#edges) {
      if (!this.#outgoing.has(edge.source)) this.#outgoing.set(edge.source, []);
      this.#outgoing.get(edge.source).push(id);
      if (!this.#incoming.has(edge.target)) this.#incoming.set(edge.target, []);
      this.#incoming.get(edge.target).push(id);
    }
  }

  // ---------------------------------------------------------------- selection & highlights

  select(nodeId) {
    this.graph.select(nodeId || null);
    this.#pinnedNodeId = nodeId || null;
    if (!this.#lineage.nodeId || this.#lineage.isPinned)
      this.#showPinnedLineage();
  }

  hasNode(nodeId) {
    return !!nodeId && this.#nodes.has(nodeId);
  }

  nodeIds() {
    return [...this.#nodes.keys()];
  }

  /** The selection flares briefly. */
  pulse(nodeId) {
    if (this.#values.animationsEnabled) this.graph.pulse(nodeId);
  }

  /** Make nodes glow for a moment (jumping to an ingredient from the side panel). */
  flash(nodeIds, durationMs = 2200) {
    clearTimeout(this.#flashTimer);
    this.#flashIds = new Set(nodeIds);
    this.#syncEmphasis();
    this.#flashTimer = setTimeout(() => {
      this.#flashIds = null;
      this.#syncEmphasis();
    }, durationMs);
  }

  /** Legend highlight: these nodes glow, everything else fades. Null or empty clears it. */
  setHighlightedNodes(nodeIds) {
    this.#legendIds = nodeIds?.size ? new Set(nodeIds) : null;
    this.#syncEmphasis();
    this.#syncDimmed();
  }

  #syncEmphasis() {
    const colors = new Map();
    for (const id of this.#legendIds ?? []) colors.set(id, UI_COLORS.highlight);
    for (const id of this.#flashIds ?? []) colors.set(id, UI_COLORS.focus);
    this.graph.setEmphasis(colors.size ? colors : null);
  }

  #syncDimmed() {
    const dimmed = new Set(this.#lineage.dimmed ?? []);
    if (this.#legendIds)
      for (const id of this.#nodes.keys())
        if (!this.#legendIds.has(id)) dimmed.add(id);
    this.graph.setDimmed(dimmed.size ? dimmed : null);
  }

  // ---------------------------------------------------------------- hover lineage

  /** Light the path to the root and/or the ingredients (per hover mode), after a short debounce. */
  showLineage(nodeId) {
    clearTimeout(this.#hoverTimer);
    this.#hoverTimer = setTimeout(
      () => this.#applyLineage(nodeId),
      PERFORMANCE_LIMITS.hoverDelayMs,
    );
  }

  /** Pointer left the node: back to the selection's lineage (if it's pinned). */
  clearLineage() {
    clearTimeout(this.#hoverTimer);
    if (this.#lineage.isPinned) return;
    this.#removeLineage();
    this.#showPinnedLineage();
  }

  #removeLineage() {
    this.#lineage = { nodeId: null, isPinned: false, dimmed: null };
    this.graph.setEdgeEmphasis(null);
    this.graph.setLabelFocus(null);
    this.#syncDimmed();
  }

  #showPinnedLineage({ force = false } = {}) {
    const nodeId = this.#pinnedNodeId;
    const shouldPin =
      this.#values.pinSelectionLineage && nodeId && this.hasNode(nodeId);
    if (
      !force &&
      shouldPin &&
      this.#lineage.isPinned &&
      this.#lineage.nodeId === nodeId
    )
      return;
    if (this.#lineage.isPinned || force) this.#removeLineage();
    if (shouldPin && !this.#lineage.nodeId)
      this.#applyLineage(nodeId, { isPinned: true });
  }

  /** Everything reachable from `start` along edges (forward) or against them, as node and edge id sets. */
  #reach(start, forward) {
    const nodes = new Set(),
      edges = new Set();
    const queue = [start];
    while (queue.length) {
      const id = queue.pop();
      for (const edgeId of (forward ? this.#outgoing : this.#incoming).get(
        id,
      ) ?? []) {
        edges.add(edgeId);
        const edge = this.#edges.get(edgeId);
        const next = forward ? edge.target : edge.source;
        if (!nodes.has(next) && next !== start) {
          nodes.add(next);
          queue.push(next);
        }
      }
    }
    return { nodes, edges };
  }

  #applyLineage(nodeId, { isPinned = false } = {}) {
    const s = this.#values,
      mode = s.hoverMode;
    if (mode === "none" || !this.#nodes.has(nodeId)) return;
    const ingredients =
      mode === "ancestors"
        ? { nodes: new Set(), edges: new Set() }
        : this.#reach(nodeId, true);
    const ancestors =
      mode === "subtree"
        ? { nodes: new Set(), edges: new Set() }
        : this.#reach(nodeId, false);
    // Flow runs from ingredient to product: toward an edge's source here, toward its target where edges run the other way.
    const flow = s.animateFlow ? (s.flowToward === "target" ? 1 : -1) : 0;
    const emphasis = new Map();
    for (const id of ingredients.edges)
      emphasis.set(id, { color: s.lineageDownColor, boost: 0.8, flow });
    for (const id of ancestors.edges)
      emphasis.set(id, { color: s.lineageUpColor, boost: 1.4, flow });
    let dimmed = null;
    if (!isPinned) {
      dimmed = new Set();
      for (const id of this.#nodes.keys())
        if (
          id !== nodeId &&
          !ingredients.nodes.has(id) &&
          !ancestors.nodes.has(id)
        )
          dimmed.add(id);
    }
    this.#lineage = { nodeId, isPinned, dimmed };
    this.graph.setEdgeEmphasis(emphasis);
    // Keep names readable around the node even when labels have faded out.
    const focus = new Set([nodeId, ...ancestors.nodes]);
    for (const edgeId of this.#outgoing.get(nodeId) ?? [])
      focus.add(this.#edges.get(edgeId).target);
    this.graph.setLabelFocus(focus);
    this.#syncDimmed();
  }

  // ---------------------------------------------------------------- viewport

  fit() {
    if (!this.graph.width || !this.graph.height) {
      this.#pendingFit = true;
      return;
    }
    this.#pendingFit = false;
    this.graph.fitView({
      animate: this.#values.animationsEnabled,
      maxZoom: ZOOM_LIMITS.maxFitZoom,
    });
  }

  zoomBy(factor) {
    this.graph.zoomBy(factor, { animate: this.#values.animationsEnabled });
  }

  centerOnRoot() {
    const rootId = this.rootNodeId;
    if (!rootId) return;
    this.graph.centerOn(rootId, {
      zoom: Math.max(this.graph.cameraTarget.zoom, 0.8),
      animate: this.#values.animationsEnabled,
    });
  }

  /** Pan (not zoom) just enough to bring a node on screen, e.g. during keyboard navigation. */
  revealNode(nodeId) {
    this.graph.reveal(nodeId, { animate: this.#values.animationsEnabled });
  }

  /** Fit some nodes (and optionally their neighbours) into view. */
  focusOn(nodeIds, { padding = 60, includeNeighbours = false } = {}) {
    const ids = new Set([...nodeIds].filter((id) => this.#nodes.has(id)));
    if (!ids.size) return;
    if (includeNeighbours)
      for (const id of [...ids]) {
        for (const edgeId of this.#outgoing.get(id) ?? [])
          ids.add(this.#edges.get(edgeId).target);
        for (const edgeId of this.#incoming.get(id) ?? [])
          ids.add(this.#edges.get(edgeId).source);
      }
    this.graph.fitView({
      ids,
      padding,
      maxZoom: 2,
      animate: this.#values.animationsEnabled,
    });
  }

  resize() {
    this.graph.resize();
  }

  /** The dots / grid background follows pan and zoom, so the canvas feels like one surface. */
  syncBackground() {
    const wrapper = this.#canvasWrapper;
    if (!wrapper) return;
    const background = this.#values.canvasBackground;
    wrapper.dataset.bg = background;
    if (background !== "dots" && background !== "grid") {
      wrapper.style.backgroundSize = "";
      wrapper.style.backgroundPosition = "";
      return;
    }
    const camera = this.graph.camera;
    let cellSize = 26 * camera.zoom;
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) cellSize = 26;
    while (cellSize < 12) cellSize *= 2;
    while (cellSize > 90) cellSize /= 2;
    wrapper.style.backgroundSize = `${cellSize}px ${cellSize}px`;
    wrapper.style.backgroundPosition = `${camera.panX}px ${camera.panY}px`;
  }

  #onViewportChange() {
    if (!this.#viewportFrame)
      this.#viewportFrame = requestAnimationFrame(() => {
        this.#viewportFrame = 0;
        this.syncBackground();
      });
    this.#handlers.onViewportChange?.();
  }

  #viewportFrame = 0;

  /** Where the camera should go after a render: keep the anchor still, or fit (smart: never microscopic). */
  #targetView({ fit, anchorNodeId, anchorScreen }) {
    const graph = this.graph;
    if (!graph.width || !graph.height) {
      if (fit) this.#pendingFit = true;
      return null;
    }
    if (anchorScreen && graph.hasNode(anchorNodeId)) {
      const position = graph.positionOf(anchorNodeId);
      const { zoom } = graph.cameraTarget;
      return {
        zoom,
        panX: anchorScreen.x - position.x * zoom,
        panY: anchorScreen.y - position.y * zoom,
      };
    }
    if (!fit) return null;
    let view = graph.viewFor(undefined, { maxZoom: ZOOM_LIMITS.maxFitZoom });
    const rootId = this.rootNodeId;
    if (fit === "smart" && view.zoom < 0.3 && this.#nodes.size > 80 && rootId) {
      // Too big to read when fitted: open on the root, near the edge the tree grows away from.
      const s = this.#values;
      const zoom = 0.6;
      const root = graph.positionOf(rootId);
      const growth = isDirectionalLayout(s) ? treeDirection(s.direction) : null;
      const fractionX = growth === "LR" ? 0.12 : growth === "RL" ? 0.88 : 0.5;
      const fractionY = growth === "TB" ? 0.15 : growth === "BT" ? 0.85 : 0.5;
      view = {
        zoom,
        panX: graph.width * fractionX - root.x * zoom,
        panY: graph.height * fractionY - root.y * zoom,
      };
    }
    return view;
  }

  // ---------------------------------------------------------------- dragging

  /**
   * Grabbing a node reheats the layout's force simulation with the node held under the pointer, so its neighbours
   * follow and others make room; after release it cools down and settles.
   */
  #dragStart(id) {
    const simulation = this.#simulation;
    if (!this.#values.dragPhysics || !simulation) return;
    this.#stopPhysics?.();
    // Start from what's on screen (a transition may still be settling).
    simulation.setPositions((nodeId) => this.graph.livePositionOf(nodeId));
    simulation.fix(id, this.graph.livePositionOf(id));
    simulation.reheat(0.3);
    const ids = simulation.ids;
    const entries = ids.map((nodeId) => [nodeId, 0, 0]);
    const stop = this.graph.addTicker(() => {
      simulation.tick();
      for (let i = 0; i < ids.length; i++) {
        entries[i][1] = simulation.x[i];
        entries[i][2] = simulation.y[i];
      }
      this.graph.moveNodes(entries);
      if (simulation.isActive) return true;
      this.#stopPhysics = null;
      return false;
    });
    this.#stopPhysics = () => {
      stop();
      this.#stopPhysics = null;
    };
  }

  #dragEnd(id) {
    const simulation = this.#simulation;
    if (simulation && this.#values.dragPhysics && this.#stopPhysics) {
      simulation.release(id);
      simulation.reheat(0); // cool down from here
    }
    // Otherwise the node just stays where it was dropped (the next layout starts from what's on screen).
  }

  // ---------------------------------------------------------------- export

  /** The whole graph as a PNG data URI, every label drawn. */
  toPngDataUri({ scale, backgroundColor }) {
    return this.graph
      .renderToCanvas({ scale, background: backgroundColor })
      .toDataURL("image/png");
  }

  /** Model-space box around everything drawn. */
  boundingBox() {
    const { x1, y1, x2, y2 } = this.graph.bounds();
    return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  }

  #clearTimers() {
    clearTimeout(this.#hoverTimer);
    clearTimeout(this.#flashTimer);
  }
}

function classSet(classes) {
  if (!classes) return new Set();
  return new Set(
    (Array.isArray(classes) ? classes : String(classes).split(" ")).filter(
      Boolean,
    ),
  );
}
