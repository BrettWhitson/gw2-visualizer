import { LayoutGraph } from "../tether/layout-graph.js";
import { runLayout } from "../tether/run-layout.js";
import { LivePhysics } from "../tether/live-physics.js";
import { isDirectionalLayout, treeDirection } from "../tether/directions.js";
import { WebGLGraph } from "./render/webgl-graph.js";
import { planTransition } from "./render/transition-plan.js";
import { labelBox, labelFont, layoutLabel } from "./render/labels.js";
import { DEFAULT_OPTIONS, STYLE_BASE } from "./options.js";
import {
  DEFAULT_THEME,
  resolveEdgeStyle,
  resolveFlowAxis,
  resolveLabelPosition,
  resolveNodeStyle,
  resolveRouting,
} from "./style.js";

/** Graphs up to this size morph between renders; bigger ones snap (springs handle thousands, but not forever). */
const MAX_ANIMATED_NODES = 5000;
/** A new graph grows level by level up to this size; bigger ones appear at once. */
const MAX_STAGGERED_NODES = 800;
/** Hover lineage waits this long, so sweeping the pointer across a graph doesn't flicker. */
const HOVER_DELAY_MS = 35;

/**
 * @typedef {{ id: string, label?: string, color?: string, icon?: string, classes?: string[] | string,
 *             root?: boolean }} GraphNode
 * @typedef {{ id?: string, source: string, target: string, label?: string, sourceColor?: string,
 *             targetColor?: string, classes?: string[] | string }} GraphEdge
 */

/**
 * Prism's graphing engine: give it nodes and edges, and it styles them (style.js) and draws them (render/), then
 * handles everything after: morphing to the next graph, hover lineage, selection, highlights, fitting and PNG export.
 * Tether does all the physics: it lays the graph out, and moves nodes when one is dragged (LivePhysics); this view
 * passes it the pointer's moves and draws the positions it returns.
 *
 * Edges run parent → child, from the root outward. The root is the node with `root: true`, or else the first node.
 *
 *   const view = new GraphView({ container, options: { direction: "LR" }, handlers: { onNodeTap } });
 *   view.render({ nodes, edges, fit: true });
 */
export class GraphView {
  #options;
  #theme;
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
  /** Tether moves the nodes after the layout (drags, shakes, floating in); this view draws what it returns. */
  #physics;
  /** Stops the per-frame loop that steps the physics, while one runs. */
  #stopTicker = null;
  #hoverTimer = 0;
  #pinnedNodeId = null;
  /** The node held by a drag (pointer or beginDrag), so a render mid-drag can hand it to the new layout. */
  #heldId = null;
  #lineage = { nodeId: null, isPinned: false, dimmed: null };
  #highlightIds = null;
  #flashIds = null;
  #flashTimer = 0;
  #pendingFit = false;
  #resizeObserver;

  /**
   * @param {{ container: HTMLElement, canvasWrapper?: HTMLElement, options?: Partial<typeof DEFAULT_OPTIONS>,
   *           theme?: Partial<typeof DEFAULT_THEME>, handlers?: object,
   *           rendererOptions?: { preserveDrawingBuffer?: boolean, badgeUrl?: string, colors?: object } }} config
   *   handlers: onNodeTap(id, event), onNodeDoubleTap(id, event), onNodeContextTap(id, event), onBackgroundTap(),
   *   onNodeHoverStart(id, event), onNodeHoverEnd(), onPointerMove(event), onViewportChange()
   *   canvasWrapper: the element whose CSS background follows pan and zoom (see syncBackground)
   */
  constructor({
    container,
    canvasWrapper,
    options = {},
    theme = {},
    handlers = {},
    rendererOptions = {},
  }) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    this.#physics = new LivePhysics(this.#options);
    this.#theme = { ...DEFAULT_THEME, ...theme };
    this.#handlers = handlers;
    this.#canvasWrapper = canvasWrapper ?? null;
    this.graph = new WebGLGraph(
      container,
      {
        onNodeTap: (id, event) => handlers.onNodeTap?.(id, event),
        onNodeDoubleTap: (id, event) => handlers.onNodeDoubleTap?.(id, event),
        onNodeContextTap: (id, event) => handlers.onNodeContextTap?.(id, event),
        onBackgroundTap: () => handlers.onBackgroundTap?.(),
        onNodeHover: (id, event) =>
          id
            ? handlers.onNodeHoverStart?.(id, event)
            : handlers.onNodeHoverEnd?.(),
        onPointerMove: (event) => handlers.onPointerMove?.(event),
        onViewportChange: () => this.#onViewportChange(),
        onNodeDragStart: (id) => this.#grab(id),
        onNodeDrag: (id, x, y) => this.#drag(id, x, y),
        onNodeDragEnd: (id) => this.#release(id),
      },
      rendererOptions,
    );
    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#pendingFit && container.clientWidth) this.fit();
    });
    this.#resizeObserver.observe(container);
    this.#applyOptions();
    this.syncBackground();
  }

  /** The options in effect (a copy). */
  get options() {
    return { ...this.#options };
  }

  /**
   * Change any options. Looks apply at once, node sizes (nodeSizeScale, rootSizeScale) and label wrapping included;
   * layout and physics options (direction, layered, physicsMode, the forces) apply from the next render(), as does
   * the room the layout leaves for the new sizes and labels.
   */
  setOptions(patch) {
    Object.assign(this.#options, patch);
    this.#applyOptions();
    this.#restyle();
    this.#showPinnedLineage({ force: true });
    this.syncBackground();
  }

  /** Change any theme colours (see style.js DEFAULT_THEME). */
  setTheme(patch) {
    Object.assign(this.#theme, patch);
    this.#restyle();
    this.#syncEmphasis();
    this.#showPinnedLineage({ force: true });
  }

  get rootNodeId() {
    for (const [id, node] of this.#nodes)
      if (node.classes.has("root")) return id;
    return undefined;
  }

  /**
   * Looks for the caller's own classes (see style.js):
   * { nodes: { className: { pattern, border, borderWidth, fillAlpha, aura, ring, badge, labelPriority, events } },
   *   edges: { className: { color, width, glow, pattern } } }
   */
  setClassStyles(rules) {
    this.#classStyles = rules ?? {};
    this.#restyle();
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Replace the graph, morphing from the previous one: survivors glide to their new places, new nodes grow out of
   * their nearest surviving ancestor (level by level from the root for a new graph), removed ones fold into theirs.
   * @param {{ nodes: GraphNode[], edges: GraphEdge[], fit?: boolean | "smart", anchorNodeId?: string | null,
   *           grow?: boolean }} graph
   *   fit: fit the view to the graph ("smart": but open on the root when that would be too small to read)
   *   anchorNodeId: keep this node where it is on screen
   *   grow: a new graph (nothing morphs from the previous one; it grows out of its root)
   */
  render({ nodes, edges, fit = false, anchorNodeId = null, grow = false }) {
    const o = this.#options;
    const graph = this.graph;
    this.#clearTimers();
    this.#stopPhysics();
    this.#lineage = { nodeId: null, isPinned: false, dimmed: null };
    this.#highlightIds = this.#flashIds = null;

    const rootId = (nodes.find((node) => node.root) ?? nodes[0])?.id;
    const previous = new Map(
      grow ? [] : graph.nodeIds().map((id) => [id, graph.positionOf(id)]),
    );
    const anchorScreen =
      anchorNodeId && previous.has(anchorNodeId)
        ? graph.screenPositionOf(anchorNodeId)
        : null;
    const parentOf = new Map(edges.map((edge) => [edge.target, edge.source]));
    const plan = planTransition({
      previous,
      nodeIds: nodes.map((node) => node.id),
      parentOf,
      previousParentOf: this.#parentOf,
      rootId,
    });
    this.#parentOf = parentOf;

    this.#nodes = new Map(
      nodes.map((node) => {
        const classes = classSet(node.classes);
        if (node.id === rootId) classes.add("root");
        return [node.id, { data: node, classes }];
      }),
    );
    this.#edges = new Map(
      edges.map((edge) => {
        const id = edgeId(edge);
        return [
          id,
          {
            data: edge,
            classes: classSet(edge.classes),
            source: edge.source,
            target: edge.target,
          },
        ];
      }),
    );
    this.#indexEdges();

    // Lay out, seeded with where things are now (the physics continues from there).
    const styles = new Map(
      nodes.map((node) => [node.id, this.#nodeStyle(node.id)]),
    );
    const layoutGraph = new LayoutGraph(
      nodes.map(({ id }) => {
        const style = styles.get(id);
        const start = plan.startOf(id) ?? { x: 0, y: 0 };
        return {
          id,
          w: style.size,
          h: style.size,
          ...this.#footprint(style),
          x: start.x,
          y: start.y,
          root: id === rootId,
        };
      }),
      edges.map(({ source, target }) => ({ source, target })),
    );
    // Floating graphs can float into place: shown at their seed layout, then settled live (after setGraph, below).
    const floatIn =
      o.physicsMode === "floating" &&
      this.#physics.tuning.floatIn &&
      o.animationsEnabled &&
      nodes.length <= MAX_ANIMATED_NODES;
    this.#physics.simulation = runLayout(layoutGraph, o, {
      tuning: this.#physics.tuning,
      settle: !floatIn,
    });

    const finalPositions = new Map();
    const placed = layoutGraph.ids.map((id, i) => {
      const position = { x: layoutGraph.x[i], y: layoutGraph.y[i] };
      finalPositions.set(id, position);
      const style = styles.get(id);
      return { id, ...position, width: style.size, height: style.size, style };
    });
    const animate =
      o.animationsEnabled &&
      placed.length <= MAX_ANIMATED_NODES &&
      graph.width > 0;
    const duration = o.animationDuration;
    const stagger =
      grow && o.growNewGraphs && placed.length <= MAX_STAGGERED_NODES;
    const depths = stagger ? this.#depthsFrom(rootId) : null;
    const delays = new Map();
    const spawnFrom = new Map();
    for (const { id } of placed) {
      if (grow) spawnFrom.set(id, finalPositions.get(rootId));
      else if (!previous.has(id)) spawnFrom.set(id, plan.startOf(id));
      if (stagger)
        delays.set(
          id,
          Math.min((depths.get(id) ?? 0) * duration * 0.18, duration * 1.4),
        );
    }
    graph.setGraph(
      {
        nodes: placed,
        edges: [...this.#edges].map(([id, edge]) => ({
          id,
          source: edge.source,
          target: edge.target,
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
    if (floatIn && this.#physics.floatIn()) this.#drive();
    // A node still held (a drag through the render) is handed to the new layout, which the rest of the graph rests on
    // from now; if the node went, setGraph let go of it.
    if (this.#heldId != null && this.#nodes.has(this.#heldId))
      this.#grab(this.#heldId, { fromLayout: true });
    // The selection survives a render when its node does: so does its lineage.
    if (this.#pinnedNodeId && !this.#nodes.has(this.#pinnedNodeId))
      this.#pinnedNodeId = null;
    this.#showPinnedLineage();
  }

  /** Links from the root to each node, following edges (for growing a new graph level by level). */
  #depthsFrom(rootId) {
    const depths = new Map([[rootId, 0]]);
    const queue = [rootId];
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      for (const edgeId of this.#outgoing.get(id) ?? []) {
        const next = this.#edges.get(edgeId).target;
        if (depths.has(next)) continue;
        depths.set(next, depths.get(id) + 1);
        queue.push(next);
      }
    }
    return depths;
  }

  // ---------------------------------------------------------------- physics (Tether)

  /** Tether's constants (tether/tuning.js) for this view. Applies to what's running too. */
  setPhysicsTuning(tuning) {
    this.#physics.tuning = tuning;
  }

  get physicsTuning() {
    return this.#physics.tuning;
  }

  /** The layout's force simulation (for developer tools: its alpha, positions, tuning). */
  get simulation() {
    return this.#physics.simulation;
  }

  /** The elastic net while a node is held and until it settles, or null (for developer tools). */
  get elasticNet() {
    return this.#physics.elasticNet;
  }

  /**
   * Drag a node from code, the way a pointer drag does (the same physics, either mode): for developer tools and
   * tests. Returns { move(x, y), end() } in world coordinates.
   */
  beginDrag(id) {
    const start = this.graph.livePositionOf(id);
    if (!start) return null;
    this.#grab(id);
    return {
      move: (x, y) => {
        this.graph.moveNodes([[id, x, y]]);
        this.#drag(id, x, y);
      },
      end: () => this.#release(id),
    };
  }

  /**
   * Shake the physics and watch it settle: optionally scatter every node by up to `scatter` world units, heat the
   * simulation to `heat` (0..1) and let it cool, animated. Returns false when the layout has no simulation.
   */
  settle({ heat = 0.6, scatter = 0 } = {}) {
    this.#stopPhysics();
    if (!this.#physics.shake(this.#positionOf, { heat, scatter })) return false;
    this.#drive();
    return true;
  }

  /** Is the physics running live (a drag, settle(), floating in)? */
  get physicsRunning() {
    return !!this.#stopTicker;
  }

  /** Stop any live physics (a drag settling, settle(), floating in). */
  stopPhysics() {
    this.#stopPhysics();
  }

  #stopPhysics() {
    this.#stopTicker?.();
    this.#physics.stop();
  }

  #positionOf = (id) => this.graph.livePositionOf(id);

  /** @param {{ fromLayout?: boolean }} [options]  fromLayout: the other nodes start from the layout, not the screen */
  #grab(id, { fromLayout = false } = {}) {
    this.#heldId = id;
    this.#stopPhysics();
    this.#physics.grab(id, {
      ids: this.graph.nodeIds(),
      links: [...this.#edges.values()],
      positionOf: fromLayout
        ? (nodeId) =>
            nodeId === id
              ? this.graph.livePositionOf(nodeId)
              : this.graph.positionOf(nodeId)
        : this.#positionOf,
    });
    this.#drive();
  }

  #drag(id, x, y) {
    this.#physics.drag(id, { x, y });
    this.#drive();
  }

  #release(id) {
    if (this.#heldId === id) this.#heldId = null;
    this.#physics.release(id);
    this.#drive();
  }

  /**
   * Step Tether every frame while anything moves, drawing what moved, and stop when it's still (a node held still
   * costs nothing); the next drag, release or shake starts it again.
   */
  #drive() {
    if (this.#stopTicker || !this.#physics.active) return;
    const stop = this.graph.addTicker(() => {
      const { moving, moved } = this.#physics.step();
      if (moved.length) this.graph.moveNodes(moved);
      if (moving) return true;
      this.#stopTicker = null;
      return false;
    });
    this.#stopTicker = () => {
      stop();
      this.#stopTicker = null;
    };
  }

  /** Remove everything: no nodes, no running animation or physics, no selection, highlight or flash. */
  clear() {
    this.#clearTimers();
    this.#stopPhysics();
    this.#physics.simulation = null;
    this.#lineage = { nodeId: null, isPinned: false, dimmed: null };
    this.#pinnedNodeId = null;
    this.#highlightIds = this.#flashIds = null;
    this.#nodes = new Map();
    this.#edges = new Map();
    this.#parentOf = new Map();
    this.#indexEdges();
    this.graph.setGraph({ nodes: [], edges: [] });
    this.graph.select(null);
    this.graph.setDimmed(null);
    this.graph.setEmphasis(null);
    this.graph.setEdgeEmphasis(null);
    this.graph.setLabelFocus(null);
  }

  /** Stop everything and remove the canvases. */
  destroy() {
    this.#clearTimers();
    this.#stopPhysics();
    cancelAnimationFrame(this.#viewportFrame);
    this.#resizeObserver.disconnect();
    this.graph.destroy();
  }

  /**
   * New labels, colours and classes without a re-layout (e.g. new data arrived).
   * @param {Partial<GraphNode>[]} nodeUpdates  each with its id
   * @param {Partial<GraphEdge>[]} [edgeUpdates]  each with its id
   */
  updateInPlace(nodeUpdates, edgeUpdates = []) {
    const nodeStyles = [],
      edgeStyles = [];
    for (const { id, classes, ...data } of nodeUpdates) {
      const node = this.#nodes.get(id);
      if (!node) continue;
      node.data = { ...node.data, ...data };
      if (classes !== undefined) {
        const isRoot = node.classes.has("root");
        node.classes = classSet(classes);
        if (isRoot) node.classes.add("root");
      }
      nodeStyles.push({ id, style: this.#nodeStyle(id) });
    }
    for (const { id, classes, ...data } of edgeUpdates) {
      const edge = this.#edges.get(id);
      if (!edge) continue;
      edge.data = { ...edge.data, ...data };
      if (classes !== undefined) edge.classes = classSet(classes);
      edgeStyles.push({ id, style: this.#edgeStyle(id) });
    }
    this.graph.updateStyles(nodeStyles, edgeStyles);
  }

  #restyle() {
    this.graph.updateStyles(
      [...this.#nodes.keys()].map((id) => ({ id, style: this.#nodeStyle(id) })),
      [...this.#edges.keys()].map((id) => ({ id, style: this.#edgeStyle(id) })),
    );
    this.graph.setRouting(this.#routing());
  }

  #applyOptions() {
    const o = this.#options;
    this.graph.camera.minZoom = o.minZoom;
    this.graph.camera.maxZoom = o.maxZoom;
    this.graph.setOptions({
      motion: {
        enabled: o.animationsEnabled,
        durationMs: o.animationDuration,
        feel: o.animationEasing,
      },
      dimAlpha: o.dimOpacity,
      flowSpeed: o.flowSpeed,
      smoothZoom: o.smoothZoom,
      zoomSpeed: o.zoomSpeed,
      labels: {
        position: resolveLabelPosition(o),
        backdrop: o.labelBackdrop,
        fadeZoom: o.labelFadeZoom,
        maxWidth: STYLE_BASE.labelWidth * o.labelWrapScale,
        overflow: o.labelOverflow,
      },
    });
  }

  #routing() {
    const o = this.#options;
    return {
      routing: resolveRouting(o),
      flowAxis: resolveFlowAxis(o),
      cornerRadius: o.edgeCornerRadius,
      curvature: o.edgeCurvature ?? 1,
    };
  }

  /**
   * A node's footprint with its label (the box they make together), as the renderer will draw it at zoom 1. The
   * layouts leave this much room.
   */
  #footprint(style) {
    const size = style.size;
    if (!style.label) return { fullW: size, fullH: size };
    const o = this.#options;
    const font = labelFont(style.fontSize, style.bold);
    const wrapWidth = STYLE_BASE.labelWidth * o.labelWrapScale;
    const key = `${font}|${wrapWidth}|${o.labelOverflow}|${style.label}`;
    let label = this.#labelSizes.get(key);
    if (!label) {
      const measure = (this.#measureContext ??= document
        .createElement("canvas")
        .getContext("2d"));
      measure.font = font;
      label = layoutLabel(
        style.label,
        { fontSize: style.fontSize, wrapWidth, overflow: o.labelOverflow },
        (text) => measure.measureText(text).width,
      );
      if (this.#labelSizes.size > 20000) this.#labelSizes.clear();
      this.#labelSizes.set(key, label);
    }
    const half = size / 2;
    const box = labelBox(
      resolveLabelPosition(o),
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
      this.#options,
      this.#theme,
      this.#classStyles,
    );
    style.icon = data.icon ?? null;
    return style;
  }

  #edgeStyle(id) {
    const { data, classes } = this.#edges.get(id);
    return resolveEdgeStyle(
      classes,
      data,
      this.#options,
      this.#theme,
      this.#classStyles,
    );
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

  /** Select a node; null (or an id that isn't in the graph) for none. */
  select(nodeId) {
    if (!this.hasNode(nodeId)) nodeId = null;
    this.graph.select(nodeId);
    this.#pinnedNodeId = nodeId;
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
    if (this.#options.animationsEnabled) this.graph.pulse(nodeId);
  }

  /** Make nodes glow for a moment (e.g. after jumping to them from elsewhere on the page). */
  flash(nodeIds, durationMs = 2200) {
    clearTimeout(this.#flashTimer);
    this.#flashIds = new Set(nodeIds);
    this.#syncEmphasis();
    this.#flashTimer = setTimeout(() => {
      this.#flashIds = null;
      this.#syncEmphasis();
    }, durationMs);
  }

  /** These nodes glow and everything else fades (e.g. a legend entry): any iterable of ids. Null or empty clears it. */
  setHighlightedNodes(nodeIds) {
    const ids = new Set(nodeIds ?? []);
    this.#highlightIds = ids.size ? ids : null;
    this.#syncEmphasis();
    this.#syncDimmed();
  }

  #syncEmphasis() {
    const colors = new Map();
    for (const id of this.#highlightIds ?? [])
      colors.set(id, this.#theme.highlight);
    for (const id of this.#flashIds ?? []) colors.set(id, this.#theme.focus);
    this.graph.setEmphasis(colors.size ? colors : null);
  }

  #syncDimmed() {
    const dimmed = new Set(this.#lineage.dimmed ?? []);
    if (this.#highlightIds)
      for (const id of this.#nodes.keys())
        if (!this.#highlightIds.has(id)) dimmed.add(id);
    this.graph.setDimmed(dimmed.size ? dimmed : null);
  }

  // ---------------------------------------------------------------- hover lineage

  /** Light the node's ancestors and/or descendants (per hoverMode), after a short debounce. */
  showLineage(nodeId) {
    clearTimeout(this.#hoverTimer);
    this.#hoverTimer = setTimeout(
      () => this.#applyLineage(nodeId),
      HOVER_DELAY_MS,
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
      this.#options.pinSelectionLineage && nodeId && this.hasNode(nodeId);
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
    const o = this.#options,
      mode = o.hoverMode;
    if (mode === "none" || !this.#nodes.has(nodeId)) return;
    const none = () => ({ nodes: new Set(), edges: new Set() });
    const descendants =
      mode === "ancestors" ? none() : this.#reach(nodeId, true);
    const ancestors =
      mode === "descendants" ? none() : this.#reach(nodeId, false);
    const flow = o.animateFlow ? (o.flowToward === "target" ? 1 : -1) : 0;
    const emphasis = new Map();
    for (const id of descendants.edges)
      emphasis.set(id, { color: this.#theme.descendants, boost: 0.8, flow });
    for (const id of ancestors.edges)
      emphasis.set(id, { color: this.#theme.ancestors, boost: 1.4, flow });
    let dimmed = null;
    if (!isPinned) {
      dimmed = new Set();
      for (const id of this.#nodes.keys())
        if (
          id !== nodeId &&
          !descendants.nodes.has(id) &&
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
      animate: this.#options.animationsEnabled,
      maxZoom: this.#options.maxFitZoom,
    });
  }

  zoomBy(factor) {
    this.graph.zoomBy(factor, { animate: this.#options.animationsEnabled });
  }

  centerOnRoot() {
    const rootId = this.rootNodeId;
    if (!rootId) return;
    this.graph.centerOn(rootId, {
      zoom: Math.max(this.graph.cameraTarget.zoom, 0.8),
      animate: this.#options.animationsEnabled,
    });
  }

  /** Pan (not zoom) just enough to bring a node on screen, e.g. during keyboard navigation. */
  revealNode(nodeId) {
    this.graph.reveal(nodeId, { animate: this.#options.animationsEnabled });
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
      animate: this.#options.animationsEnabled,
    });
  }

  resize() {
    this.graph.resize();
  }

  /**
   * A "dots" or "grid" canvasBackground follows pan and zoom, so the canvas feels like one surface: this sets the
   * wrapper's data-bg attribute and its background size and position. The pattern itself is the page's CSS.
   */
  syncBackground() {
    const wrapper = this.#canvasWrapper;
    if (!wrapper) return;
    const background = this.#options.canvasBackground;
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
    const o = this.#options;
    let view = graph.viewFor(undefined, { maxZoom: o.maxFitZoom });
    const rootId = this.rootNodeId;
    if (fit === "smart" && view.zoom < 0.3 && this.#nodes.size > 80 && rootId) {
      // Too big to read when fitted: open on the root, near the edge the tree grows away from.
      const zoom = 0.6;
      const root = graph.positionOf(rootId);
      const growth = isDirectionalLayout(o) ? treeDirection(o.direction) : null;
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

  // ---------------------------------------------------------------- export

  /** The whole graph as a PNG data URI, every label drawn. */
  toPngDataUri({ scale = 2, backgroundColor = null } = {}) {
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

function edgeId(edge) {
  return edge.id ?? `${edge.source}->${edge.target}`;
}
