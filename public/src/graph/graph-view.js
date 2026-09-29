import {
  EASING_FUNCTIONS,
  LABEL_FADE_RANGE,
  LABEL_FADE_STEPS,
  PERFORMANCE_LIMITS,
  ZOOM_LIMITS,
} from "../config/constants.js";
import { buildStylesheet } from "./stylesheet.js";
import { runLayout, updateCurvedEdges } from "./layouts.js";
import {
  isDirectionalLayout,
  treeDirection,
  usesComputedCurves,
} from "./layout-geometry.js";
import { SmoothWheelZoom } from "./smooth-zoom.js";
import { GraphTransition } from "./graph-transition.js";

const GHOST_ID_PREFIX = "__ghost_";

/**
 * Owns the Cytoscape instance: rendering with animated transitions, viewport control, hover lineage,
 * selection and highlight effects. Knows nothing about recipes — it draws whatever elements it's given.
 */
export class GraphView {
  /** @type {import('cytoscape').Core} */ cy;
  #settings;
  #handlers;
  #canvasWrapper;
  #pendingFit = false;
  #hoverTimer = 0;
  #isLineageShown = false;
  /** The selected node, whose lineage stays highlighted (with flow) when nothing is hovered. */
  #pinnedNodeId = null;
  /** Which node's lineage is drawn right now, and whether it's the pinned (selection) version. */
  #lineageOwner = { nodeId: null, isPinned: false };
  #smoothZoom;
  #flowFrame = 0;
  #flowEdges = null;
  /** Current label opacity step (1 = fully visible); see #syncLabelFade. */
  #labelOpacity = 1;
  /** Serialized stylesheet currently installed (restyling the whole graph is skipped when it wouldn't change). */
  #appliedStyleKey = "";
  /** The latest layout's force simulation, kept so dragging a node moves the others. */
  #simulation = null;
  #physicsFrame = 0;
  /** @type {import('./graph-transition.js').GraphTransition | null} */
  #transition = null;

  /**
   * @param {{ container: HTMLElement, canvasWrapper: HTMLElement, settings: import('../core/settings-store.js').SettingsStore,
   *           handlers: Partial<Record<'onNodeTap'|'onNodeDoubleTap'|'onNodeContextTap'|'onBackgroundTap'|'onNodeHoverStart'|'onNodeHoverEnd'|'onPointerMove'|'onViewportChange', Function>> }} options
   */
  constructor({ container, canvasWrapper, settings, handlers }) {
    this.#settings = settings;
    this.#handlers = handlers;
    this.#canvasWrapper = canvasWrapper;
    this.cy = globalThis.cytoscape({
      container,
      style: buildStylesheet(settings.values),
      minZoom: ZOOM_LIMITS.min,
      maxZoom: ZOOM_LIMITS.max,
      boxSelectionEnabled: false,
      selectionType: "single",
    });
    this.#smoothZoom = new SmoothWheelZoom(
      this.cy,
      canvasWrapper,
      container,
      settings,
    );
    this.#bindCytoscapeEvents(container);
    this.syncBackground();
  }

  get #values() {
    return this.#settings.values;
  }

  get rootNodeId() {
    return this.cy.nodes(".root").id();
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Replace the graph with new elements, animating from the previous graph: surviving nodes glide to their new
   * positions, new nodes fly out of their nearest existing ancestor, removed nodes shrink into theirs.
   *
   * @param {{ nodeElements: object[], edgeElements: object[], nodesById: Map<string, import('../types.js').GraphNode>,
   *           fit?: boolean | 'smart', anchorNodeId?: string | null, grow?: boolean }} options
   *   fit: true = fit everything; 'smart' = fit, but zoom to the root if the whole tree would be microscopic.
   *   anchorNodeId: keep this node at the same screen position (expand/collapse, recipe changes).
   *   grow: a brand-new tree — grow it out of the root level by level instead of morphing.
   */
  render({
    nodeElements,
    edgeElements,
    nodesById,
    fit = false,
    anchorNodeId = null,
    grow = false,
  }) {
    const cy = this.cy,
      s = this.#values;
    this.#stopFlow();
    this.#isLineageShown = false;
    this.#lineageOwner = { nodeId: null, isPinned: false };

    const previous = grow
      ? { nodes: new Map(), edgeIds: new Set() }
      : this.#snapshot();
    const anchorElement = anchorNodeId ? cy.getElementById(anchorNodeId) : null;
    const anchorScreenPosition = anchorElement?.nonempty()
      ? { ...anchorElement.renderedPosition() }
      : null;

    const parentIdByChildId = new Map(
      edgeElements.map((e) => [e.data.target, e.data.source]),
    );
    const rootId = nodeElements[0]?.data.id;
    const startPositionOf = (id) => {
      if (previous.nodes.has(id)) return previous.nodes.get(id).position;
      // Walk up to the nearest ancestor that already existed. Merged graphs can contain cycles → track visited.
      const visited = new Set([id]);
      for (
        let parentId = parentIdByChildId.get(id);
        parentId && !visited.has(parentId);
        parentId = parentIdByChildId.get(parentId)
      ) {
        if (previous.nodes.has(parentId))
          return previous.nodes.get(parentId).position;
        visited.add(parentId);
      }
      return previous.nodes.get(rootId)?.position ?? { x: 0, y: 0 };
    };

    this.#finishAnimations();
    cy.stop(true, false);
    cy.batch(() => {
      this.#syncElements(nodeElements, edgeElements, startPositionOf);
      this.#applyStyle();
    });
    this.#stopPhysics();
    this.#simulation = runLayout(cy, s, {
      hasPreviousPositions: previous.nodes.size > 0,
    });
    updateCurvedEdges(cy, s);

    const finalPositions = new Map();
    cy.nodes().forEach((node) =>
      finalPositions.set(node.id(), { ...node.position() }),
    );
    const targetViewport = this.#computeTargetViewport({
      fit,
      anchorNodeId,
      anchorScreenPosition,
    });

    this.#tuneRendererFor(nodeElements.length + edgeElements.length);
    const shouldAnimate =
      s.animationsEnabled &&
      nodeElements.length <= PERFORMANCE_LIMITS.maxAnimatedNodes &&
      cy.width() > 0;
    if (shouldAnimate) {
      this.#animateTransition({
        previous,
        finalPositions,
        startPositionOf,
        nodesById,
        rootId,
        grow,
        anchorNodeId,
        targetViewport,
      });
    } else if (targetViewport) {
      cy.viewport(targetViewport);
    }
  }

  /** Remove the whole graph: no elements, no running animation, flow or physics. */
  clear() {
    this.#finishAnimations();
    this.#stopFlow();
    this.#stopPhysics();
    this.#simulation = null;
    this.#isLineageShown = false;
    this.#lineageOwner = { nodeId: null, isPinned: false };
    this.cy.stop(true, false);
    this.cy.elements().remove();
  }

  /** Update labels/colours/classes without re-layout (e.g. when prices arrive). */
  updateInPlace(nodeUpdates, edgeUpdates) {
    this.cy.batch(() => {
      for (const { id, data, classes } of nodeUpdates) {
        const element = this.cy.getElementById(id);
        if (element.empty()) continue;
        if (
          element.data("label") !== data.label ||
          element.data("color") !== data.color
        )
          element.data({ label: data.label, color: data.color });
        element.classes(classes);
      }
      for (const { id, data } of edgeUpdates) {
        const element = this.cy.getElementById(id);
        if (element.nonempty()) element.data(data);
      }
    });
  }

  /** Re-apply the stylesheet after a style-only setting change. */
  applyStylesheet() {
    updateCurvedEdges(this.cy, this.#values);
    this.#labelOpacity = this.#labelOpacityForZoom(this.cy.zoom());
    this.#applyStyle();
    this.#showPinnedLineage({ force: true }); // flow / pinning settings may have changed
  }

  /** Install the stylesheet for the current settings, skipping the (whole-graph) restyle when nothing changed. */
  #applyStyle() {
    const sheet = buildStylesheet(this.#values, {
      labelOpacity: this.#labelOpacity,
    });
    const key = JSON.stringify(sheet);
    if (key === this.#appliedStyleKey) return;
    this.#appliedStyleKey = key;
    this.cy.style(sheet);
  }

  /**
   * Make the graph contain exactly these elements, reusing the ones that survive (so Cytoscape keeps their caches and
   * colour changes can transition) instead of rebuilding everything. Every node starts at `startPositionOf(id)`.
   */
  #syncElements(nodeElements, edgeElements, startPositionOf) {
    const cy = this.cy;
    const nextIds = new Set();
    for (const element of nodeElements) nextIds.add(element.data.id);
    for (const element of edgeElements) nextIds.add(element.data.id);
    cy.elements()
      .filter((element) => !nextIds.has(element.id()))
      .remove();

    const additions = [];
    for (const element of nodeElements) {
      const position = { ...startPositionOf(element.data.id) };
      const existing = cy.getElementById(element.data.id);
      if (existing.empty()) {
        additions.push({ ...element, position });
        continue;
      }
      existing.removeData(); // drop optional fields (icon, bgs…) the new data may not have
      existing.data(element.data);
      existing.classes(element.classes ?? "");
      existing.removeStyle();
      existing.position(position);
    }
    for (const element of edgeElements) {
      const existing = cy.getElementById(element.data.id);
      const isSameLink =
        existing.nonempty() &&
        existing.data("source") === element.data.source &&
        existing.data("target") === element.data.target;
      if (!isSameLink) {
        existing.remove();
        additions.push(element);
        continue;
      }
      existing.data(element.data);
      existing.classes(element.classes ?? "");
      existing.removeStyle();
    }
    if (additions.length) cy.add(additions);
  }

  /**
   * Labels fade out as you zoom out past `labelFadeZoom`: fully visible at LABEL_FADE_RANGE × that zoom, gone at it.
   * Quantised to a few steps so continuous zooming only restyles when a step boundary is crossed.
   */
  #labelOpacityForZoom(zoom) {
    const fadeZoom = this.#values.labelFadeZoom;
    if (!fadeZoom) return 1;
    const progress =
      (zoom - fadeZoom) / (fadeZoom * LABEL_FADE_RANGE - fadeZoom);
    return (
      Math.round(Math.min(1, Math.max(0, progress)) * LABEL_FADE_STEPS) /
      LABEL_FADE_STEPS
    );
  }

  #syncLabelFade() {
    const opacity = this.#labelOpacityForZoom(this.cy.zoom());
    if (opacity === this.#labelOpacity) return;
    this.#labelOpacity = opacity;
    this.#applyStyle();
  }

  // ---------------------------------------------------------------- selection & highlights

  select(nodeId) {
    this.cy.nodes().unselect();
    if (nodeId) this.cy.getElementById(nodeId).select();
    this.#pinnedNodeId = nodeId || null;
    if (!this.#lineageOwner.nodeId || this.#lineageOwner.isPinned)
      this.#showPinnedLineage();
  }

  hasNode(nodeId) {
    return !!nodeId && this.cy.getElementById(nodeId).nonempty();
  }

  /** Brief "pop" of the selection glow. */
  pulse(nodeId) {
    const node = this.cy.getElementById(nodeId);
    if (!this.#values.animationsEnabled || node.empty()) return;
    node.animate(
      { style: { "underlay-padding": 16, "underlay-opacity": 0.9 } },
      {
        duration: 140,
        queue: false,
        easing: "ease-out-quad",
        complete: () =>
          node.animate(
            { style: { "underlay-padding": 7, "underlay-opacity": 0.6 } },
            {
              duration: 280,
              queue: false,
              easing: "ease-in-out-cubic",
              complete: () =>
                node.removeStyle("underlay-padding underlay-opacity"),
            },
          ),
      },
    );
  }

  /** Temporarily outline nodes (used when jumping to an ingredient from the side panel). */
  flash(nodeIds, durationMs = 2200) {
    const nodes = this.#collectionOf(nodeIds);
    this.cy.batch(() => {
      this.cy.nodes().removeClass("hl");
      nodes.addClass("hl");
    });
    setTimeout(() => nodes.removeClass("hl"), durationMs);
  }

  /**
   * Legend highlight: emphasise `nodeIds`, dim everything else (edges stay lit only between two lit nodes).
   * Pass null/empty to clear.
   */
  setHighlightedNodes(nodeIds) {
    const cy = this.cy;
    cy.batch(() => {
      cy.elements(".lg-hl, .lg-dim").removeClass("lg-hl lg-dim");
      if (!nodeIds?.size) return;
      const hits = cy
        .nodes()
        .not(".ghost")
        .filter((node) => nodeIds.has(node.id()));
      hits.addClass("lg-hl");
      cy.nodes().not(".ghost").difference(hits).addClass("lg-dim");
      cy.edges()
        .filter(
          (edge) =>
            !(
              edge.source().hasClass("lg-hl") && edge.target().hasClass("lg-hl")
            ),
        )
        .addClass("lg-dim");
    });
  }

  /** Ids of all drawn (non-ghost) nodes. */
  nodeIds() {
    return this.cy
      .nodes()
      .not(".ghost")
      .map((node) => node.id());
  }

  // ---------------------------------------------------------------- hover lineage

  /** Highlight the path to the root and/or the ingredient subtree (per hover mode), after a short debounce. */
  showLineage(nodeId) {
    clearTimeout(this.#hoverTimer);
    this.#hoverTimer = setTimeout(
      () => this.#applyLineage(nodeId),
      PERFORMANCE_LIMITS.hoverDelayMs,
    );
  }

  /** Pointer left the node: drop the hover highlight and fall back to the selection's lineage (if pinned). */
  clearLineage() {
    clearTimeout(this.#hoverTimer);
    if (this.#lineageOwner.isPinned) return;
    this.#removeLineage();
    this.#showPinnedLineage();
  }

  #removeLineage() {
    this.#stopFlow();
    this.#lineageOwner = { nodeId: null, isPinned: false };
    if (!this.#isLineageShown) return;
    this.#isLineageShown = false;
    this.cy.batch(() =>
      this.cy
        .elements(".faded, .path, .pathdown, .label-focus")
        .removeClass("faded path pathdown label-focus"),
    );
  }

  /** Keep the selected node's lineage lit (without dimming the rest) so its flow keeps running. */
  #showPinnedLineage({ force = false } = {}) {
    const nodeId = this.#pinnedNodeId;
    const shouldPin =
      this.#values.pinSelectionLineage && nodeId && this.hasNode(nodeId);
    if (
      !force &&
      this.#lineageOwner.isPinned &&
      this.#lineageOwner.nodeId === nodeId &&
      shouldPin
    )
      return;
    if (this.#lineageOwner.isPinned || force) this.#removeLineage();
    if (shouldPin && !this.#lineageOwner.nodeId)
      this.#applyLineage(nodeId, { isPinned: true });
  }

  #applyLineage(nodeId, { isPinned = false } = {}) {
    const cy = this.cy,
      mode = this.#values.hoverMode;
    const node = cy.getElementById(nodeId);
    if (mode === "none" || node.empty() || node.hasClass("ghost")) return;
    this.#removeLineage();
    const ingredients =
      mode === "ancestors" ? cy.collection() : node.successors();
    const ancestors =
      mode === "subtree" ? cy.collection() : node.predecessors();
    const dimOthers =
      !isPinned &&
      cy.elements().length < PERFORMANCE_LIMITS.dimOnHoverBelowElements;
    cy.batch(() => {
      if (dimOthers) {
        cy.elements().addClass("faded");
        node.removeClass("faded");
        ingredients.removeClass("faded");
        ancestors.removeClass("faded");
      }
      ancestors.edges().addClass("path");
      ingredients.edges().addClass("pathdown");
      // Keep names readable around the hovered node even when labels have faded out.
      node
        .union(ancestors.nodes())
        .union(node.outgoers("node"))
        .addClass("label-focus");
    });
    this.#isLineageShown = true;
    this.#lineageOwner = { nodeId, isPinned };
    if (this.#values.animateFlow)
      this.#startFlow(ancestors.edges().union(ingredients.edges()));
  }

  /**
   * Marching dashes along highlighted edges, flowing from ingredient toward product. Big lineages (e.g. the root's,
   * which is the whole graph) update at a lower frame rate so the dashes don't cost every frame.
   */
  #startFlow(edges) {
    this.#stopFlow();
    if (!edges.length || edges.length > PERFORMANCE_LIMITS.maxFlowAnimatedEdges)
      return;
    this.#flowEdges = edges;
    const frameIntervalMs =
      edges.length > PERFORMANCE_LIMITS.fullRateFlowEdges ? 50 : 0;
    let offset = 0,
      lastTime = performance.now();
    const tick = (time) => {
      this.#flowFrame = requestAnimationFrame(tick);
      if (time - lastTime < frameIntervalMs) return;
      offset += (time - lastTime) * 0.03 * this.#values.flowSpeed;
      lastTime = time;
      this.#flowEdges?.style("line-dash-offset", offset);
    };
    this.#flowFrame = requestAnimationFrame(tick);
  }

  #stopFlow() {
    cancelAnimationFrame(this.#flowFrame);
    this.#flowFrame = 0;
    if (this.#flowEdges) {
      this.#flowEdges.removeStyle("line-dash-offset");
      this.#flowEdges = null;
    }
  }

  // ---------------------------------------------------------------- viewport

  /** Fit the whole graph (finishing any in-flight transition first so the bounds are final). */
  fit() {
    if (!this.cy.width() || !this.cy.height()) {
      this.#pendingFit = true;
      return;
    }
    this.#pendingFit = false;
    this.#finishAnimations();
    this.#animateViewport(this.#fitViewport());
  }

  zoomBy(factor) {
    const cy = this.cy,
      currentZoom = cy.zoom();
    const zoom = Math.max(
      cy.minZoom(),
      Math.min(cy.maxZoom(), currentZoom * factor),
    );
    const center = { x: cy.width() / 2, y: cy.height() / 2 },
      pan = cy.pan();
    const ratio = zoom / currentZoom;
    this.#animateViewport({
      zoom,
      pan: {
        x: center.x - (center.x - pan.x) * ratio,
        y: center.y - (center.y - pan.y) * ratio,
      },
    });
  }

  centerOnRoot() {
    const root = this.cy.nodes(".root");
    if (root.empty()) return;
    const zoom = Math.max(this.cy.zoom(), 0.8),
      position = root.position();
    this.#animateViewport({
      zoom,
      pan: {
        x: this.cy.width() / 2 - position.x * zoom,
        y: this.cy.height() / 2 - position.y * zoom,
      },
    });
  }

  /** Pan (without zooming) just enough to bring a node on screen, e.g. during keyboard navigation. */
  revealNode(nodeId) {
    const node = this.cy.getElementById(nodeId);
    if (node.empty()) return;
    const margin = 60,
      { x, y } = node.renderedPosition();
    const width = this.cy.width(),
      height = this.cy.height();
    const dx =
      x < margin ? margin - x : x > width - margin ? width - margin - x : 0;
    const dy =
      y < margin ? margin - y : y > height - margin ? height - margin - y : 0;
    if (!dx && !dy) return;
    const pan = this.cy.pan();
    this.#animateViewport({
      zoom: this.cy.zoom(),
      pan: { x: pan.x + dx, y: pan.y + dy },
    });
  }

  /** Fit a subset of nodes (optionally with their neighbours) into view. */
  focusOn(
    nodeIds,
    { padding = 60, includeNeighbours = false, durationMs = 400 } = {},
  ) {
    let nodes = this.#collectionOf(nodeIds);
    if (nodes.empty()) return;
    if (includeNeighbours) nodes = nodes.union(nodes.neighborhood());
    this.cy.animate({
      fit: { eles: nodes, padding },
      duration: this.#values.animationsEnabled ? durationMs : 0,
      easing: EASING_FUNCTIONS.smooth,
    });
  }

  resize() {
    this.cy.resize();
  }

  /** Background pattern follows pan/zoom so the canvas feels like one surface. */
  syncBackground() {
    const wrapper = this.#canvasWrapper,
      background = this.#values.canvasBackground;
    wrapper.dataset.bg = background;
    if (background !== "dots" && background !== "grid") {
      wrapper.style.backgroundSize = "";
      wrapper.style.backgroundPosition = "";
      return;
    }
    let cellSize = 26 * this.cy.zoom();
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) cellSize = 26;
    while (cellSize < 12) cellSize *= 2;
    while (cellSize > 90) cellSize /= 2;
    const pan = this.cy.pan();
    wrapper.style.backgroundSize = `${cellSize}px ${cellSize}px`;
    wrapper.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
  }

  // ---------------------------------------------------------------- export

  /** Full-graph PNG as a data URI. */
  toPngDataUri({ scale, backgroundColor }) {
    // Exports always include labels, whatever the current zoom fade.
    const fadedOpacity = this.#labelOpacity;
    if (fadedOpacity !== 1) {
      this.#labelOpacity = 1;
      this.#applyStyle();
    }
    try {
      return this.cy.png({
        full: true,
        scale,
        bg: backgroundColor,
        output: "base64uri",
        maxWidth: 16000,
        maxHeight: 16000,
      });
    } finally {
      if (fadedOpacity !== 1) {
        this.#labelOpacity = fadedOpacity;
        this.#applyStyle();
      }
    }
  }

  /** Model-space bounding box of everything drawn. */
  boundingBox() {
    return this.cy.elements().not(".ghost").boundingBox();
  }

  // ---------------------------------------------------------------- internals

  #bindCytoscapeEvents(container) {
    const cy = this.cy,
      h = this.#handlers;
    cy.on("mouseover", "node", (e) => {
      if (!e.target.hasClass("ghost"))
        h.onNodeHoverStart?.(e.target.id(), e.originalEvent);
    });
    cy.on("mouseout", "node", () => h.onNodeHoverEnd?.());
    cy.on("grab", "node", () => h.onNodeHoverEnd?.());
    this.#bindDragPhysics();
    cy.on("zoom pan", () => h.onViewportChange?.());

    let pointerFrame = 0,
      lastPointerEvent = null;
    cy.on("mousemove", (e) => {
      lastPointerEvent = e.originalEvent;
      if (!pointerFrame)
        pointerFrame = requestAnimationFrame(() => {
          pointerFrame = 0;
          h.onPointerMove?.(lastPointerEvent);
        });
    });

    cy.on("tap", "node", (e) => h.onNodeTap?.(e.target.id(), e.originalEvent));
    cy.on("dbltap", "node", (e) => h.onNodeDoubleTap?.(e.target.id()));
    cy.on("cxttap", "node", (e) => h.onNodeContextTap?.(e.target.id()));
    cy.on("taphold", "node", (e) => {
      if (e.originalEvent?.type?.startsWith("touch"))
        h.onNodeContextTap?.(e.target.id());
    }); // long-press on touch
    cy.on("tap", (e) => {
      if (e.target === cy) h.onBackgroundTap?.();
    });
    let viewportFrame = 0;
    cy.on("viewport", () => {
      if (viewportFrame) return;
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = 0;
        this.syncBackground();
        this.#syncLabelFade();
      });
    });

    // Computed curves use absolute control points, so refresh them whenever nodes move (drag or animation).
    let dirtyEdgeIds = new Set(),
      curveFrame = 0;
    cy.on("position", "node", (e) => {
      if (!usesComputedCurves(this.#values)) return;
      e.target.connectedEdges().forEach((edge) => dirtyEdgeIds.add(edge.id()));
      if (!curveFrame)
        curveFrame = requestAnimationFrame(() => {
          curveFrame = 0;
          const ids = dirtyEdgeIds;
          dirtyEdgeIds = new Set();
          updateCurvedEdges(
            cy,
            this.#values,
            cy.edges().filter((edge) => ids.has(edge.id())),
          );
        });
    });

    new ResizeObserver(() => {
      cy.resize();
      if (this.#pendingFit) this.fit();
    }).observe(container);
  }

  #snapshot() {
    const nodes = new Map(),
      edgeIds = new Set();
    this.cy
      .nodes()
      .not(".ghost")
      .forEach((node) =>
        nodes.set(node.id(), {
          position: { ...node.position() },
          data: { ...node.data() },
          classes: node.classes().join(" "),
        }),
      );
    this.cy.edges().forEach((edge) => edgeIds.add(edge.id()));
    return { nodes, edgeIds };
  }

  /**
   * Morph from the previous graph to the new layout in one GraphTransition: nodes glide (new ones out of their
   * nearest surviving ancestor, or level by level from the root for a new tree), new edges fade in behind them,
   * removed nodes shrink into their ancestor as ghosts, and the camera moves in step.
   */
  #animateTransition({
    previous,
    finalPositions,
    startPositionOf,
    nodesById,
    rootId,
    grow,
    anchorNodeId,
    targetViewport,
  }) {
    const cy = this.cy,
      s = this.#values;
    const duration = s.animationDuration;
    const growOrigin = finalPositions.get(rootId);
    const stagger =
      grow &&
      s.growNewTrees &&
      finalPositions.size <= PERFORMANCE_LIMITS.maxStaggeredNodes;
    const delayForDepth = (depth) =>
      stagger ? Math.min(depth * duration * 0.22, duration * 1.5) : 0;
    const depthOf = (id) => nodesById.get(id)?.depth ?? 0;

    const transition = new GraphTransition(cy, {
      duration,
      easing: s.animationEasing,
      onFinish: () => {
        if (this.#transition === transition) this.#transition = null;
      },
    });
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const id = node.id();
        const from = grow ? { ...growOrigin } : { ...startPositionOf(id) };
        transition.moveNode(node, from, finalPositions.get(id), {
          delay: delayForDepth(depthOf(id)),
          fadeIn: !previous.nodes.has(id),
        });
      });
      cy.edges().forEach((edge) => {
        if (!previous.edgeIds.has(edge.id()))
          transition.revealEdge(
            edge,
            delayForDepth(depthOf(edge.data("target"))) + duration * 0.45,
          );
      });
      for (const { ghost, destination } of this.#addGhosts({
        previous,
        finalPositions,
        anchorNodeId,
      }))
        transition.addGhost(ghost, destination);
    });
    if (targetViewport)
      transition.setViewport(
        { zoom: cy.zoom(), pan: { ...cy.pan() } },
        targetViewport,
      );

    this.#transition = transition;
    transition.start();
    // Safety net: frames stall in background tabs, so snap to the end state if the transition overruns.
    setTimeout(() => transition.finish(), duration * 2.8 + 400);
  }

  /** Stand-ins for removed nodes, headed for their nearest surviving ancestor (or the anchor). */
  #addGhosts({ previous, finalPositions, anchorNodeId }) {
    const ghosts = [];
    for (const [id, snapshot] of previous.nodes) {
      if (finalPositions.has(id)) continue;
      let destination = null;
      // Tree-view ids are paths ("r/0/3"), so ancestors are prefixes.
      for (let path = id; path.includes("/") && !destination;) {
        path = path.slice(0, path.lastIndexOf("/"));
        destination = finalPositions.get(path);
      }
      destination ??=
        (anchorNodeId && finalPositions.get(anchorNodeId)) || snapshot.position;
      ghosts.push({
        element: {
          group: "nodes",
          data: { ...snapshot.data, id: GHOST_ID_PREFIX + id },
          classes: `${snapshot.classes} ghost`,
          position: snapshot.position,
        },
        destination,
      });
    }
    if (!ghosts.length) return [];
    const added = this.cy.add(ghosts.map((g) => g.element));
    return added.map((ghost, i) => ({
      ghost,
      destination: ghosts[i].destination,
    }));
  }

  /** Jump any in-flight transition to its end state. */
  // ---------------------------------------------------------------- drag physics

  /**
   * Obsidian-style dragging: grabbing a node reheats the layout's force simulation with the node held under the
   * pointer, so neighbours follow and others make room; after release the graph cools down and settles.
   */
  #bindDragPhysics() {
    const cy = this.cy;
    let draggedId = null;
    cy.on("grab", "node", (event) => {
      const simulation = this.#simulation;
      if (
        !this.#values.dragPhysics ||
        !simulation ||
        event.target.hasClass("ghost")
      )
        return;
      this.#finishAnimations();
      simulation.syncFromGraph(); // pick up any manual moves since the last layout
      draggedId = event.target.id();
      simulation.fix(draggedId, event.target.position());
      simulation.reheat(0.3);
      this.#startPhysics(() => draggedId);
    });
    cy.on("drag", "node", (event) => {
      if (draggedId === event.target.id())
        this.#simulation?.fix(draggedId, event.target.position());
    });
    cy.on("free", "node", (event) => {
      if (draggedId !== event.target.id()) return;
      this.#simulation?.release(draggedId);
      this.#simulation?.reheat(0); // cool down from here
      draggedId = null;
    });
  }

  #startPhysics(getDraggedId) {
    if (this.#physicsFrame) return;
    const step = () => {
      const simulation = this.#simulation;
      if (!simulation?.isActive) {
        this.#physicsFrame = 0;
        return;
      }
      simulation.tick();
      simulation.apply(getDraggedId());
      this.#physicsFrame = requestAnimationFrame(step);
    };
    this.#physicsFrame = requestAnimationFrame(step);
  }

  #stopPhysics() {
    cancelAnimationFrame(this.#physicsFrame);
    this.#physicsFrame = 0;
  }

  #finishAnimations() {
    this.#transition?.finish();
    this.#transition = null;
    this.cy.nodes(".ghost").remove();
  }

  #computeTargetViewport({ fit, anchorNodeId, anchorScreenPosition }) {
    const cy = this.cy;
    if (!cy.width() || !cy.height()) {
      if (fit) this.#pendingFit = true;
      return null;
    }
    const anchor = anchorNodeId ? cy.getElementById(anchorNodeId) : null;
    if (anchorScreenPosition && anchor?.nonempty()) {
      const position = anchor.position(),
        zoom = cy.zoom();
      return {
        zoom,
        pan: {
          x: anchorScreenPosition.x - position.x * zoom,
          y: anchorScreenPosition.y - position.y * zoom,
        },
      };
    }
    return fit
      ? this.#fitViewport({ preferRootWhenTiny: fit === "smart" })
      : null;
  }

  /**
   * Viewport that fits every element. With `preferRootWhenTiny`, trees that would need < 30% zoom open at 60%
   * with the root near the leading edge instead (used when a new item is opened, never for the Fit button).
   */
  #fitViewport({ preferRootWhenTiny = false } = {}) {
    const cy = this.cy,
      s = this.#values,
      width = cy.width(),
      height = cy.height(),
      padding = 40;
    const bounds = this.boundingBox();
    let zoom = Math.min(
      (width - 2 * padding) / Math.max(bounds.w, 1),
      (height - 2 * padding) / Math.max(bounds.h, 1),
    );
    zoom = Math.max(cy.minZoom(), Math.min(ZOOM_LIMITS.maxFitZoom, zoom));
    let pan = {
      x: (width - zoom * (bounds.x1 + bounds.x2)) / 2,
      y: (height - zoom * (bounds.y1 + bounds.y2)) / 2,
    };

    const root = cy.nodes(".root");
    if (
      preferRootWhenTiny &&
      zoom < 0.3 &&
      cy.nodes().length > 80 &&
      root.nonempty()
    ) {
      zoom = 0.6;
      const rootPosition = root.position();
      // Put the root near the edge the tree grows away from.
      const growth = isDirectionalLayout(s) ? treeDirection(s.direction) : null;
      const fractionX = growth === "LR" ? 0.12 : growth === "RL" ? 0.88 : 0.5;
      const fractionY = growth === "TB" ? 0.15 : growth === "BT" ? 0.85 : 0.5;
      pan = {
        x: width * fractionX - rootPosition.x * zoom,
        y: height * fractionY - rootPosition.y * zoom,
      };
    }
    return { zoom, pan };
  }

  #animateViewport(viewport) {
    this.#smoothZoom.cancel();
    this.cy.stop(true, false);
    if (this.#values.animationsEnabled)
      this.cy.animate(viewport, {
        duration: Math.min(this.#values.animationDuration, 500),
        easing: EASING_FUNCTIONS.smooth,
      });
    else this.cy.viewport(viewport);
  }

  /** Big graphs: draw a cached bitmap while panning/zooming and skip edges mid-gesture. */
  #tuneRendererFor(elementCount) {
    const renderer = this.cy.renderer();
    if (!renderer) return;
    renderer.textureOnViewport =
      elementCount > PERFORMANCE_LIMITS.textureOnViewportAboveElements;
    renderer.hideEdgesOnViewport =
      elementCount > PERFORMANCE_LIMITS.hideEdgesOnViewportAboveElements;
    renderer.motionBlur = false;
  }

  #collectionOf(nodeIds) {
    const ids = new Set(nodeIds);
    return this.cy
      .nodes()
      .not(".ghost")
      .filter((node) => ids.has(node.id()));
  }
}
