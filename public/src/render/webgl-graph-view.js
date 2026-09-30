import { FORGE_BADGE_URI } from "../config/constants.js";
import { GraphView as PrismView } from "../../lib/prism/graph-view.js";
import {
  gw2ClassRules,
  prismClasses,
  prismOptions,
  prismTheme,
} from "./prism-settings.js";

/**
 * Prism (public/lib/prism/, laid out and moved by Tether) behind the interface the pages use for GraphView (render,
 * select, lineage, fit, export…), so a page can switch renderers without other changes. This adapter speaks the
 * app's language: it maps the settings to Prism's options and theme, Cytoscape-style elements to Prism's nodes and
 * edges, and the item states (owned, Mystic Forge, cheaper, cycle, collapsed) to Prism's class rules.
 */
export class WebGLGraphView {
  #settings;
  #view;
  #pageRules = {};
  /** What was last handed to Prism, so unchanged settings don't restyle everything. */
  #sent = { options: "", theme: "", rules: "" };

  /**
   * @param {{ container: HTMLElement, canvasWrapper?: HTMLElement, settings: { values: object },
   *           handlers: object }} options  the same as GraphView's
   */
  constructor({ container, canvasWrapper, settings, handlers }) {
    this.#settings = settings;
    const values = settings.values;
    this.#view = new PrismView({
      container,
      canvasWrapper,
      options: prismOptions(values),
      theme: prismTheme(values),
      handlers,
      rendererOptions: {
        // ?screenshot keeps frames readable for screenshots (a little slower).
        preserveDrawingBuffer: new URLSearchParams(
          globalThis.location?.search,
        ).has("screenshot"),
        badgeUrl: FORGE_BADGE_URI,
      },
    });
    this.#sent.options = JSON.stringify(prismOptions(values));
    this.#sent.theme = JSON.stringify(prismTheme(values));
    this.#syncClassRules();
    // The page's graph container is the accessible surface (role, description, keyboard, live announcements).
    for (const canvas of [this.graph.canvas, this.graph.labelCanvas])
      canvas.setAttribute("aria-hidden", "true");
  }

  /** Prism's renderer (WebGLGraph), for developer tools. */
  get graph() {
    return this.#view.graph;
  }

  get rootNodeId() {
    return this.#view.rootNodeId;
  }

  /**
   * Extra looks for a page's own classes, in Prism's terms (see public/lib/prism/style.js):
   * { nodes: { className: { pattern, border, borderWidth, fillAlpha, aura, ring, badge, events } },
   *   edges: { className: { color, width, glow, pattern } } }
   */
  setClassStyles(rules) {
    this.#pageRules = rules ?? {};
    this.#syncClassRules();
  }

  /** Hand Prism the options, theme and class rules for the current settings, each only when it changed. */
  #sync(what, value, apply) {
    const key = JSON.stringify(value);
    if (key === this.#sent[what]) return;
    this.#sent[what] = key;
    apply(value);
  }

  #syncOptions() {
    this.#sync("options", prismOptions(this.#settings.values), (options) =>
      this.#view.setOptions(options),
    );
  }

  /**
   * Hand Prism whatever settings changed: options, theme, class rules. Cheap when nothing did. The page calls it
   * after every settings change, since some settings (hover highlight, zoom speed, background…) redraw nothing.
   */
  syncSettings() {
    this.#sync("theme", prismTheme(this.#settings.values), (theme) =>
      this.#view.setTheme(theme),
    );
    this.#syncClassRules();
    this.#syncOptions();
  }

  #syncClassRules() {
    const gw2 = gw2ClassRules(this.#settings.values);
    const rules = {
      nodes: { ...gw2.nodes, ...this.#pageRules.nodes },
      edges: { ...gw2.edges, ...this.#pageRules.edges },
    };
    this.#sync("rules", rules, (value) => this.#view.setClassStyles(value));
  }

  // ---------------------------------------------------------------- rendering

  /** Same arguments as GraphView.render. */
  render({
    nodeElements,
    edgeElements,
    fit = false,
    anchorNodeId = null,
    grow = false,
  }) {
    this.syncSettings(); // a relayout setting may change looks too (the Mystic Forge indicator)
    this.#view.render({
      nodes: nodeElements.map(({ data, classes }) => {
        const names = prismClasses(classes);
        return {
          id: data.id,
          label: data.label,
          color: data.color,
          icon: data.icon,
          classes: names,
          root: names.includes("root"),
        };
      }),
      edges: edgeElements.map(({ data, classes }) => ({
        ...data,
        classes: prismClasses(classes),
      })),
      fit,
      anchorNodeId,
      grow,
    });
  }

  /** New labels, colours and classes without a re-layout (e.g. prices arrived). */
  updateInPlace(nodeUpdates, edgeUpdates) {
    this.#view.updateInPlace(
      nodeUpdates.map(({ id, data, classes }) => ({
        id,
        label: data.label,
        color: data.color,
        classes: prismClasses(classes),
      })),
      edgeUpdates.map(({ id, data }) => ({ id, ...data })),
    );
  }

  /** A style-only setting changed. */
  applyStylesheet() {
    this.syncSettings();
  }

  clear() {
    this.#view.clear();
  }

  // ---------------------------------------------------------------- physics (Tether), for developer tools

  setPhysicsTuning(tuning) {
    this.#view.setPhysicsTuning(tuning);
  }

  get physicsTuning() {
    return this.#view.physicsTuning;
  }

  get simulation() {
    return this.#view.simulation;
  }

  get elasticNet() {
    return this.#view.elasticNet;
  }

  get physicsRunning() {
    return this.#view.physicsRunning;
  }

  beginDrag(id) {
    return this.#view.beginDrag(id);
  }

  settle(options) {
    return this.#view.settle(options);
  }

  stopPhysics() {
    this.#view.stopPhysics();
  }

  // ---------------------------------------------------------------- selection, highlights, lineage

  select(nodeId) {
    this.#view.select(nodeId);
  }

  hasNode(nodeId) {
    return this.#view.hasNode(nodeId);
  }

  nodeIds() {
    return this.#view.nodeIds();
  }

  pulse(nodeId) {
    this.#view.pulse(nodeId);
  }

  /** Make nodes glow for a moment (jumping to an ingredient from the side panel). */
  flash(nodeIds, durationMs) {
    this.#view.flash(nodeIds, durationMs);
  }

  /** Legend highlight: these nodes glow, everything else fades. Null or empty clears it. */
  setHighlightedNodes(nodeIds) {
    this.#view.setHighlightedNodes(nodeIds);
  }

  showLineage(nodeId) {
    this.#view.showLineage(nodeId);
  }

  clearLineage() {
    this.#view.clearLineage();
  }

  // ---------------------------------------------------------------- viewport and export

  fit() {
    this.#view.fit();
  }

  zoomBy(factor) {
    this.#view.zoomBy(factor);
  }

  centerOnRoot() {
    this.#view.centerOnRoot();
  }

  revealNode(nodeId) {
    this.#view.revealNode(nodeId);
  }

  focusOn(nodeIds, options) {
    this.#view.focusOn(nodeIds, options);
  }

  resize() {
    this.#view.resize();
  }

  syncBackground() {
    this.syncSettings(); // the background setting lives in Prism's options
    this.#view.syncBackground();
  }

  toPngDataUri(options) {
    return this.#view.toPngDataUri(options);
  }

  boundingBox() {
    return this.#view.boundingBox();
  }
}
