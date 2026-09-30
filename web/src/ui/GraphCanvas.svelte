<!--
  A graph drawn by Prism, for Svelte pages. It mounts the view on its element and hands it to the page through
  `onready` for imperative calls (render, select, fit…): graph data never goes through Svelte state. When any
  setting changes it re-syncs the view's looks; a change that needs a new layout is still the page's to render.
-->
<script>
  import { onMount } from "svelte";
  import { WebGLGraphView } from "../render/webgl-graph-view.js";
  import { reactiveSettings } from "./settings.svelte.js";

  /**
   * @type {{ settings: import('../core/settings-store.js').SettingsStore, handlers?: object,
   *          onready?: (view: WebGLGraphView) => void, label?: string }}
   */
  let { settings, handlers = {}, onready, label = "Graph" } = $props();

  const reactive = $derived(reactiveSettings(settings));
  /** @type {HTMLElement} */ let wrapper;
  /** @type {HTMLElement} */ let container;
  /** @type {WebGLGraphView | null} */ let view = $state.raw(null);

  onMount(() => {
    view = new WebGLGraphView({
      container,
      canvasWrapper: wrapper,
      settings,
      handlers,
    });
    onready?.(view);
    return () => view?.destroy();
  });

  $effect(() => {
    reactive.values; // any setting
    view?.syncSettings();
    view?.syncBackground();
  });
</script>

<div class="graph-canvas" bind:this={wrapper}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (the graph is keyboard-navigable: the page handles its keys) -->
  <div
    class="graph-canvas-view"
    bind:this={container}
    role="application"
    aria-label={label}
    tabindex="0"
  ></div>
</div>

<style>
  .graph-canvas,
  .graph-canvas-view {
    position: relative;
    width: 100%;
    height: 100%;
  }
</style>
