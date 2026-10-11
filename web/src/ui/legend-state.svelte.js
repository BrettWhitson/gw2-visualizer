/* eslint-disable svelte/prefer-svelte-reactivity -- the Maps and Sets here are replaced whole, never changed in
   place, so plain ones in $state.raw are enough (and graph nodes stay out of Svelte's proxies). */
import { untrack } from "svelte";
import { buildLegendEntries, matchingNodeIds } from "../model/legend-model.js";

/**
 * The legend's state: its entries follow the settings (colour mode, forge indicator…) and the drawn graph on their
 * own, and the selection doubles as a filter (matching nodes are highlighted; several entries combine as a union).
 * The page hands it each new graph with update(); everything else is derived. Graph nodes are kept as they are
 * ($state.raw), never made deeply reactive.
 */
export class LegendState {
  /** @type {Map<string, import('../types.js').GraphNode>} */
  nodesById = $state.raw(new Map());
  rootCost = $state(0);
  /** Chosen entry keys, including ones this graph or colour mode doesn't have (they come back if it does again). */
  #chosen = $state.raw(new Set());
  /** Collapsed to a single toggle button; starts collapsed on phone-sized screens. */
  collapsed = $state(
    globalThis.matchMedia?.("(max-width: 700px)").matches ?? false,
  );

  #settings;
  #gameData;

  visible = $derived(this.#settings.values.showLegend);
  /** @type {import('../model/legend-model.js').LegendEntry[]} */
  entries = $derived(
    buildLegendEntries(
      this.#settings.values,
      this.nodesById.values(),
      this.#context,
    ),
  );
  /** The chosen keys that apply now (the legend is shown and has them). */
  selectedKeys = $derived.by(() => {
    if (!this.visible) return new Set();
    const valid = new Set(this.entries.map((entry) => entry.key));
    return new Set([...this.#chosen].filter((key) => valid.has(key)));
  });
  selectedEntries = $derived(
    this.entries.filter((entry) => this.selectedKeys.has(entry.key)),
  );
  #matching = $derived(
    matchingNodeIds(this.selectedKeys, this.nodesById.values(), this.#context),
  );

  /**
   * @param {{ settings: { readonly values: object }, gameData: object, element: HTMLElement,
   *           callbacks: { onSelectionChange(matchingNodeIds: Set<string>, entries: object[]): void,
   *                        onFocusRequest(matchingNodeIds: Set<string>): void } }} options
   *   settings: reactive (see settings.svelte.js); element: the legend's container
   */
  constructor({ settings, gameData, element, callbacks }) {
    this.#settings = settings;
    this.#gameData = gameData;
    this.callbacks = callbacks;
    $effect.root(() => {
      $effect(() => {
        element.hidden = !this.visible;
        element.classList.toggle("collapsed", this.collapsed);
      });
      // Tell the page what to highlight whenever the matching nodes change (a new graph, a setting, a click).
      $effect(() => {
        const ids = this.#matching,
          entries = this.selectedEntries;
        untrack(() => this.callbacks.onSelectionChange(ids, entries));
      });
    });
  }

  get #context() {
    return { gameData: this.#gameData, rootCost: this.rootCost };
  }

  /**
   * A new graph was drawn.
   * @param {Map<string, import('../types.js').GraphNode>} nodesById  @param {number} rootCost
   */
  update(nodesById, rootCost) {
    this.nodesById = nodesById;
    this.rootCost = rootCost;
  }

  /** @param {string} key  @param {{ exclusive?: boolean }} [options] exclusive = select only this entry */
  toggle(key, { exclusive = false } = {}) {
    const chosen = new Set(exclusive ? [] : this.selectedKeys);
    if (!exclusive && chosen.has(key)) chosen.delete(key);
    else chosen.add(key);
    this.#chosen = chosen;
  }

  /** Select an entry and ask the page to zoom to its nodes (double-click). */
  focus(key) {
    this.#chosen = new Set([...this.selectedKeys, key]);
    this.callbacks.onFocusRequest(this.getMatchingNodeIds());
  }

  /** @returns {boolean} whether anything was selected */
  clearSelection() {
    if (!this.selectedKeys.size) return false;
    this.#chosen = new Set();
    return true;
  }

  /** @returns {Set<string>} node ids matching any selected entry */
  getMatchingNodeIds() {
    return this.#matching;
  }
}
