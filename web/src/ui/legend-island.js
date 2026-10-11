import { mount } from "svelte";
import Legend from "./Legend.svelte";
import { LegendState } from "./legend-state.svelte.js";
import { reactiveSettings } from "./settings.svelte.js";

/**
 * The Svelte legend, mounted into the page's #legend element. Returns its state, which the page drives:
 * `update(nodesById, rootCost)` after each render, `clearSelection()`, and `entries` / `selectedKeys` /
 * `selectedEntries` for exports. Setting changes reach it on their own.
 * @param {HTMLElement} element
 * @param {{ gameData: object, settings: import('../core/settings-store.js').SettingsStore }} context
 * @param {{ onSelectionChange(matchingNodeIds: Set<string>, entries: object[]): void,
 *           onFocusRequest(matchingNodeIds: Set<string>): void }} callbacks
 */
export function createLegend(element, { gameData, settings }, callbacks) {
  const legend = new LegendState({
    settings: reactiveSettings(settings),
    gameData,
    element,
    callbacks,
  });
  element.replaceChildren();
  mount(Legend, { target: element, props: { legend } });
  return legend;
}
