import { buildStylesheet } from "../graph/stylesheet.js";
import { runLayout } from "../graph/layouts.js";
import { WebGLGraph } from "./webgl-graph.js";

const BEST_ROUTE_COLOR = "#e5b83b";

/**
 * The WebGL renderer behind the same interface the pages use for GraphView (render, select, lineage, fit, zoom…),
 * so a page can switch renderers without other changes. Layout is unchanged: the app's layouts run on a hidden
 * Cytoscape instance (which still measures labels), and only the drawing moves to WebGLGraph.
 *
 * Not carried over yet: animated transitions between layouts, the flow animation, node dragging with live physics,
 * PNG export, and per-class styling beyond what's mapped below.
 */
export class WebGLGraphView {
  /**
   * @param {{ container: HTMLElement, canvasWrapper?: HTMLElement, settings: { values: object },
   *           handlers: object }} options  the same as GraphView's
   */
  constructor({ container, settings, handlers }) {
    this.settings = settings;
    this.handlers = handlers;
    this.graph = new WebGLGraph(
      container,
      {
        onNodeTap: (id, event) => handlers.onNodeTap?.(id, event),
        onNodeDoubleTap: (id) => handlers.onNodeDoubleTap?.(id),
        onBackgroundTap: () => handlers.onBackgroundTap?.(),
        onNodeHover: (id, event) =>
          id
            ? handlers.onNodeHoverStart?.(id, event)
            : handlers.onNodeHoverEnd?.(),
        onPointerMove: (event) => handlers.onPointerMove?.(event),
        onViewportChange: () => handlers.onViewportChange?.(),
      },
      {
        // ?screenshot keeps frames readable for screenshots (a little slower).
        preserveDrawingBuffer: new URLSearchParams(
          globalThis.location?.search,
        ).has("screenshot"),
      },
    );
    // Layout only: never shown, so it never draws.
    this.layoutContainer = document.createElement("div");
    this.layoutContainer.style.display = "none";
    container.append(this.layoutContainer);
    this.cy = globalThis.cytoscape({
      container: this.layoutContainer,
      style: buildStylesheet(settings.values),
    });
    this.edges = [];
  }

  /** Same arguments as GraphView.render; elements come from NodeAppearance, positions from the app's layouts. */
  render({ nodeElements, edgeElements, fit = false, anchorNodeId = null }) {
    const values = this.settings.values;
    const anchorBefore = anchorNodeId && this.#screenPosition(anchorNodeId);
    const cy = this.cy;
    cy.batch(() => {
      cy.elements().remove();
      cy.style(buildStylesheet(values));
      cy.add([...nodeElements, ...edgeElements]);
    });
    runLayout(cy, values, { hasPreviousPositions: false });

    const horizontal = values.direction === "LR" || values.direction === "RL";
    const radial =
      values.direction === "radial" || values.layoutEngine === "force";
    const nodes = cy.nodes().map((node) => {
      const classes = node.classes();
      const position = node.position();
      return {
        id: node.id(),
        x: position.x,
        y: position.y,
        width: node.width(),
        height: node.height(),
        color: node.data("color"),
        icon: node.data("icon") ?? null,
        label: node.data("label") ?? "",
        priority: classes.includes("root")
          ? 2
          : classes.includes("best-route")
            ? 1
            : 0,
        borderWidth: values.nodeBorderWidth,
      };
    });
    const bestRoute = new Set(cy.nodes(".best-route").map((node) => node.id()));
    this.edges = cy.edges().map((edge) => ({
      id: edge.id(),
      source: edge.data("source"),
      target: edge.data("target"),
      color: edge.hasClass("best-route") ? BEST_ROUTE_COLOR : values.edgeColor,
      width: edge.hasClass("best-route") ? 3 : values.edgeWidth,
      arrow: values.showArrows,
    }));
    this.graph.setGraph({
      nodes,
      edges: this.edges,
      routing:
        radial || !String(values.edgeRouting).includes("taxi")
          ? "straight"
          : "taxi",
      flowAxis: horizontal ? "x" : "y",
      // Where the stylesheet puts labels is where the layout made room for them.
      labelPosition:
        cy.nodes().first().style("text-valign") === "center"
          ? "right"
          : "below",
    });
    this.graph.setHighlighted(bestRoute);

    if (fit) this.graph.fit();
    else if (anchorBefore) {
      // Keep the anchor node where it was on screen.
      const after = this.#screenPosition(anchorNodeId);
      if (after)
        this.graph.camera.panBy(
          anchorBefore.x - after.x,
          anchorBefore.y - after.y,
        );
      this.graph.requestRender();
    }
  }

  #screenPosition(id) {
    const node = this.cy.getElementById(id);
    if (!node.length) return null;
    const { x, y } = node.position();
    return this.graph.camera.toScreen(x, y);
  }

  clear() {
    this.cy.elements().remove();
    this.edges = [];
    this.graph.setGraph({ nodes: [], edges: [] });
  }

  select(id) {
    this.graph.select(id);
  }

  hasNode(id) {
    return this.cy.getElementById(id).length > 0;
  }

  /** Hovering a node spotlights it, what it's made from and what it makes; everything else fades. */
  showLineage(id) {
    const keep = new Set([id]);
    const walk = (start, forward) => {
      const queue = [start];
      while (queue.length) {
        const current = queue.pop();
        for (const edge of this.edges) {
          const [from, to] = forward
            ? [edge.source, edge.target]
            : [edge.target, edge.source];
          if (from === current && !keep.has(to)) {
            keep.add(to);
            queue.push(to);
          }
        }
      }
    };
    walk(id, true);
    walk(id, false);
    this.graph.setDimmed(
      this.cy
        .nodes()
        .map((node) => node.id())
        .filter((nodeId) => !keep.has(nodeId)),
    );
  }

  clearLineage() {
    this.graph.setDimmed(null);
  }

  fit() {
    this.graph.fit();
  }

  zoomBy(factor) {
    this.graph.zoomBy(factor);
  }

  resize() {
    this.graph.resize();
  }

  revealNode(id) {
    this.graph.centerOn(id);
  }
}
