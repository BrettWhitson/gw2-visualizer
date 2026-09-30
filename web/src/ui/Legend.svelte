<!--
  The graph legend: one button per entry (click to highlight its nodes, ctrl/⌘-click for only this one, double-click to
  zoom to them), with match counts. Styled by #legend in css/app.css; all logic is in legend-state.svelte.js.
-->
<script>
  /** @type {{ legend: import('./legend-state.svelte.js').LegendState }} */
  let { legend } = $props();

  const selectedCount = $derived(legend.selectedKeys.size);
</script>

{#if legend.visible}
  <button
    type="button"
    class="lg-toggle"
    aria-expanded={!legend.collapsed}
    title="{legend.collapsed ? 'Show' : 'Hide'} legend"
    onclick={() => (legend.collapsed = !legend.collapsed)}
    >Legend{selectedCount ? ` (${selectedCount} on)` : ""}
    {legend.collapsed ? "▸" : "▾"}</button
  >
  {#if !legend.collapsed}
    {#each legend.entries as entry (entry.key)}
      <button
        type="button"
        class={[
          "lg",
          legend.selectedKeys.has(entry.key) && "on",
          !entry.count && "zero",
        ]}
        aria-pressed={legend.selectedKeys.has(entry.key)}
        title="Click to highlight · double-click to zoom to them"
        onclick={(event) =>
          legend.toggle(entry.key, {
            exclusive: event.ctrlKey || event.metaKey,
          })}
        ondblclick={() => legend.focus(entry.key)}
        >{#if entry.image}<img
            class="mfb"
            src={entry.image}
            alt=""
          />{:else if entry.line}<i
            class="lg-line"
            style:background={entry.color}
          ></i>{:else}<i
            style:border-color={entry.color}
            style:border-style={entry.border}
          ></i>{/if}{entry.label}<small>{entry.count}</small></button
      >
    {/each}
    {#if selectedCount}
      <button
        type="button"
        class="lg clear"
        title="Clear highlight (Esc)"
        onclick={() => legend.clearSelection()}>✕ clear</button
      >
    {/if}
  {/if}
{/if}
