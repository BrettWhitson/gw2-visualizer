import { EntityKind } from "../config/constants.js";
import {
  PATH_MODES,
  PRESET_KINDS,
  Redraw,
  findMatchingPreset,
  getOptionDefinition,
} from "../config/settings-schema.js";
import { OptionsPanel } from "../ui/options-panel.js";
import { escapeHtml } from "../utils/dom.js";
import { formatCoinsHtml } from "../utils/format.js";
import {
  edgeSourceLegendEntries,
  edgeSourceRules,
  kpiFigures,
} from "./design-model.js";
import { Minimap } from "./minimap.js";

/**
 * Design-branch prototypes from the Hybrid mockup (gw2_design_WIP), each behind its own toggle in the "Lab" menu so
 * they can be compared with today's app. Experiments in plain DOM: whatever is adopted is rebuilt in Svelte.
 *  - sourceEdges: edges coloured by where the ingredient comes from, with an edge key in the legend
 *  - viewPopover: a "View" popover (presets, the ribbon's controls, All settings) in place of the ribbon
 *  - kpiStrip:    the root item's craft cost, TP price, profit after fees and margin, over the graph
 *  - minimap:     an overview of the whole graph; click or drag to move the view
 */

const STORAGE_KEY = "gw2v:designLab";
const FEATURES = {
  sourceEdges: {
    label: "Source-coloured edges",
    hint: "Edges take the colour of where the ingredient comes from: crafted, Mystic Forge, bought, currency. While on, a selection doesn't keep its path lit (hover still does).",
  },
  viewPopover: {
    label: "View popover instead of the ribbon",
    hint: "Presets and the ribbon's controls in one popover (V); every other option under All settings.",
  },
  kpiStrip: {
    label: "KPI strip",
    hint: "Craft cost, Trading Post price, profit after the 15% fee and margin for the item you're crafting.",
  },
  minimap: {
    label: "Minimap",
    hint: "An overview of the whole graph, bottom right; click or drag it to move the view.",
  },
};

/** The ribbon's controls that live in the popover's options list (the rest are presets, view, depth and path). */
const POPOVER_GROUPS = [
  {
    id: "dl-layout",
    title: "Layout",
    keys: ["direction", "physicsMode", "repelForce", "linkDistance"],
  },
  {
    id: "dl-style",
    title: "Style",
    keys: [
      "nodeColorMode",
      "edgeRouting",
      "showLabels",
      "showQuantities",
      "showCostInLabel",
      "labelFadeZoom",
    ],
  },
  {
    id: "dl-recipes",
    title: "Recipes",
    keys: ["includeForgePromotions", "useOwned"],
  },
];

function loadFlags() {
  const defaults = Object.fromEntries(
    Object.keys(FEATURES).map((key) => [key, true]),
  );
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaults;
  }
}

export class DesignLab {
  #app;
  #flags = loadFlags();
  #labButton;
  #labMenu;
  #viewButton;
  #viewPopover;
  #viewPanel;
  #kpi;
  #minimap;

  /** @param {import('../app.js').CraftingTreeApp} app */
  constructor(app) {
    this.#app = app;
  }

  start() {
    this.#buildChrome();
    this.#minimap = new Minimap(this.#app.graphView, $("#cyWrap"), {
      colorOf: (nodeId) => this.#nodeColor(nodeId),
    });
    for (const key of Object.keys(FEATURES)) this.#apply(key);
    document.addEventListener("keydown", (event) => this.#onKey(event));
    document.addEventListener("pointerdown", (event) => {
      for (const [menu, button] of [
        [this.#labMenu, this.#labButton],
        [this.#viewPopover, this.#viewButton],
      ])
        if (
          !menu.hidden &&
          !menu.contains(event.target) &&
          !button.contains(event.target)
        )
          this.#close(menu, button);
    });
  }

  /** The graph or its prices changed (called after every render and in-place refresh). */
  refresh() {
    if (!this.#kpi) return; // before start()
    this.#renderKpi();
    this.#minimap.setVisible(this.#flags.minimap && this.#hasGraph);
    this.#minimap.redraw();
    if (!this.#viewPopover.hidden) this.#renderViewQuick();
  }

  get #hasGraph() {
    return this.#app.treeState.hasRoot && this.#app.graph.nodes.length > 0;
  }

  #nodeColor(nodeId) {
    const node = this.#app.graph.nodesById.get(nodeId);
    return node
      ? this.#app.appearance.color(node, this.#app.tree?.effectiveCost || 0)
      : null;
  }

  // ---------------------------------------------------------------- toggles

  #set(key, on) {
    this.#flags[key] = on;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#flags));
    } catch {
      /* private mode: the toggle lasts for this visit */
    }
    this.#apply(key);
  }

  #apply(key) {
    const on = this.#flags[key];
    const app = this.#app;
    switch (key) {
      case "sourceEdges":
        app.graphView.setClassStyles(on ? edgeSourceRules() : {});
        // Prism paints lit lineage edges in the lineage colour over any class colour, and the root is selected
        // when a tree opens, so a pinned lineage would hide every source colour. Hover still lights the lineage.
        app.graphView.setOptionOverrides(
          on ? { pinSelectionLineage: false } : {},
        );
        app.legend.extraEntries = on ? edgeSourceLegendEntries : null;
        app.legend.update(app.graph.nodesById, app.tree?.effectiveCost || 0);
        break;
      case "viewPopover":
        document.body.classList.toggle("dl-no-ribbon", on);
        this.#viewButton.hidden = !on;
        if (!on) this.#close(this.#viewPopover, this.#viewButton);
        app.ribbonPopout.close({ restoreFocus: false });
        break;
      case "kpiStrip":
        this.#renderKpi();
        break;
      case "minimap":
        this.#minimap.setVisible(on && this.#hasGraph);
        this.#minimap.redraw();
        break;
    }
  }

  // ---------------------------------------------------------------- chrome: Lab menu, View button and popover

  #buildChrome() {
    const settingsButton = $('#topbar [data-command="settings"]');
    this.#viewButton = button(
      "hbtn dl-view-btn",
      "View options: presets, layout, style (V)",
      `<svg class="ico" aria-hidden="true" focusable="false"><use href="#i-customize"></use></svg><span>View</span>`,
    );
    this.#labButton = button(
      "hbtn dl-lab-btn",
      "Design lab: prototypes on the design branch",
      `<span aria-hidden="true">⚗</span><span>Lab</span>`,
    );
    settingsButton.before(this.#viewButton, this.#labButton);

    this.#labMenu = popover("dl-lab", "Design lab");
    this.#viewPopover = popover("dl-view", "View options");
    document.body.append(this.#labMenu, this.#viewPopover);
    this.#renderLabMenu();
    this.#renderViewPopover();

    this.#labButton.addEventListener("click", () =>
      this.#toggle(this.#labMenu, this.#labButton),
    );
    this.#viewButton.addEventListener("click", () => this.toggleView());
    this.#labMenu.addEventListener("change", (event) => {
      const key = event.target.dataset.feature;
      if (key) this.#set(key, event.target.checked);
    });

    this.#kpi = document.createElement("div");
    this.#kpi.className = "dl-kpi";
    this.#kpi.hidden = true;
    $("#cyWrap").append(this.#kpi);
  }

  toggleView() {
    if (this.#viewPopover.hidden) this.#renderViewQuick();
    this.#toggle(this.#viewPopover, this.#viewButton);
  }

  #toggle(menu, anchor) {
    if (!menu.hidden) {
      this.#close(menu, anchor);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    anchor.setAttribute("aria-expanded", "true");
    menu.querySelector("input, select, button")?.focus({ preventScroll: true });
  }

  #close(menu, anchor) {
    if (menu.hidden) return;
    menu.hidden = true;
    anchor.setAttribute("aria-expanded", "false");
  }

  #onKey(event) {
    const typing = event.target.closest?.("input, textarea, select");
    if (event.key === "Escape") {
      this.#close(this.#viewPopover, this.#viewButton);
      this.#close(this.#labMenu, this.#labButton);
      return;
    }
    if (
      typing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      document.querySelector("dialog[open]")
    )
      return;
    if (event.key.toLowerCase() === "v" && this.#flags.viewPopover)
      this.toggleView();
  }

  #renderLabMenu() {
    this.#labMenu.querySelector(".dl-body").innerHTML =
      `<p class="dl-note">Prototypes from the Hybrid design, on the <b>design</b> branch. Turn them off to compare with today's app; the choice is saved in this browser.</p>` +
      Object.entries(FEATURES)
        .map(
          ([key, { label, hint }]) =>
            `<label class="dl-feature"><input type="checkbox" data-feature="${key}" ${this.#flags[key] ? "checked" : ""}><span><b>${escapeHtml(label)}</b><small>${escapeHtml(hint)}</small></span></label>`,
        )
        .join("");
  }

  #renderViewPopover() {
    const body = this.#viewPopover.querySelector(".dl-body");
    body.innerHTML = `
      <div class="dl-quick"></div>
      <div class="dl-options"></div>
      <div class="dl-foot">
        <button type="button" class="linklike" data-dl="all">All settings →</button>
        <button type="button" class="linklike" data-dl="app">App settings</button>
      </div>`;
    const app = this.#app;
    this.#viewPanel = new OptionsPanel(
      body.querySelector(".dl-options"),
      app.settings,
      {
        groups: POPOVER_GROUPS.map(({ id, title, keys }) => ({
          id,
          title,
          options: keys.map(getOptionDefinition).filter(Boolean),
        })),
        compact: true,
        idPrefix: "dl",
      },
      {
        onOptionChange: (key, value, redraw) =>
          app.changeSetting(key, value, redraw),
        onReset: (keys) => app.resetSettings(keys),
      },
    );
    this.#viewPanel.render();
    // Kept in sync with the ribbon, Customize and Settings like the other option panels.
    app.optionPanels.push(this.#viewPanel);

    body.addEventListener("change", (event) => {
      const kind = event.target.dataset.preset;
      if (kind && event.target.value) {
        app.applyPreset(kind, event.target.value);
        this.#renderViewQuick();
      }
    });
    body.addEventListener("click", (event) => {
      const target = event.target.closest("[data-dl]");
      if (!target) return;
      const { dl, value } = target.dataset;
      if (dl === "all" || dl === "app") {
        this.#close(this.#viewPopover, this.#viewButton);
        if (dl === "all") app.openCustomizeTab();
        else app.openSettings();
        return;
      }
      if (dl === "depth") app.stepDepth(Number(value));
      else
        app.changeSetting(
          dl,
          value,
          getOptionDefinition(dl)?.redraw ?? Redraw.fit,
        );
      this.#renderViewQuick();
    });
  }

  /** Presets, view mode, depth and path: the ribbon's controls that aren't plain options. */
  #renderViewQuick() {
    const values = this.#app.settings.values;
    const segment = (key, choices) =>
      `<div class="dl-seg" role="group">${choices
        .map(
          ([value, label, title = ""]) =>
            `<button type="button" data-dl="${key}" data-value="${value}" class="${values[key] === value ? "on" : ""}" aria-pressed="${values[key] === value}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`,
        )
        .join("")}</div>`;
    const presetSelect = (kind) => {
      const active = findMatchingPreset(values, kind);
      return `<select data-preset="${kind}" aria-label="${kind} preset"><option value="" ${active ? "" : "selected"} hidden>Custom</option>${Object.entries(
        PRESET_KINDS[kind].presets,
      )
        .map(
          ([name, preset]) =>
            `<option value="${escapeHtml(name)}" title="${escapeHtml(preset.description)}" ${name === active ? "selected" : ""}>${escapeHtml(name)}</option>`,
        )
        .join("")}</select>`;
    };
    const depthDef = getOptionDefinition("maxDepth");
    const depth =
      values.maxDepth >= depthDef.max ? "All" : String(values.maxDepth);
    this.#viewPopover.querySelector(".dl-quick").innerHTML = `
      <div class="dl-row"><span>Presets</span><div class="dl-pair">${presetSelect("layout")}${presetSelect("style")}</div></div>
      <div class="dl-row"><span>Mode</span>${segment("viewMode", [
        ["tree", "Tree", "Every occurrence is its own node"],
        ["merged", "Merged", "Shared ingredients combined into one node"],
      ])}</div>
      <div class="dl-row"><span>Depth</span><div class="dl-step">
        <button type="button" data-dl="depth" data-value="-1" title="One level less ( [ )" ${values.maxDepth <= depthDef.min ? "disabled" : ""}>−</button>
        <output>${depth}</output>
        <button type="button" data-dl="depth" data-value="1" title="One level more ( ] )" ${values.maxDepth >= depthDef.max ? "disabled" : ""}>+</button></div></div>
      <div class="dl-row"><span>Path</span>${segment(
        "pathMode",
        Object.entries(PATH_MODES).map(([value, { label, hint }]) => [
          value,
          label,
          hint,
        ]),
      )}</div>`;
  }

  // ---------------------------------------------------------------- KPI strip

  #renderKpi() {
    const app = this.#app;
    const tree = app.tree;
    const show =
      this.#flags.kpiStrip &&
      tree &&
      app.treeState.hasRoot &&
      tree.kind === EntityKind.item &&
      app.settings.values.priceBasis !== "off";
    this.#kpi.hidden = !show;
    if (!show) return;
    const quote = app.priceBook.getQuote(tree.entityId);
    const figures = kpiFigures({
      craftCost: tree.craftCost ?? tree.effectiveCost,
      sellPrice: quote?.sell || null,
      quantity: tree.quantity,
    });
    const coins = (copper) =>
      copper == null ? '<span class="muted">—</span>' : formatCoinsHtml(copper);
    const partial = tree.isCraftCostPartial
      ? ' <span class="muted" title="Some ingredients have no price">(partial)</span>'
      : "";
    const cell = (label, value, extra = "") =>
      `<div class="dl-k${extra}"><span>${label}</span><b>${value}</b></div>`;
    if (figures.buyNow == null) {
      this.#kpi.innerHTML =
        cell("Craft cost", coins(figures.craftCost) + partial) +
        cell(
          "Trading Post",
          quote || app.priceBook.fetchFailed(tree.entityId)
            ? '<span class="muted">not sold there</span>'
            : '<span class="muted">loading prices…</span>',
        );
      return;
    }
    const profitClass =
      figures.profit == null ? "" : figures.profit >= 0 ? " up" : " down";
    const margin =
      figures.margin == null
        ? ""
        : ` <i class="dl-chip${profitClass}">${figures.margin >= 0 ? "+" : "−"}${Math.abs(figures.margin * 100).toFixed(0)}%</i>`;
    this.#kpi.innerHTML =
      cell("Craft cost", coins(figures.craftCost) + partial) +
      cell("Buy on TP", coins(figures.buyNow)) +
      cell("Sell after fees", coins(figures.sellNet)) +
      cell(
        figures.profit != null && figures.profit < 0 ? "Loss" : "Profit",
        (figures.profit == null
          ? coins(null)
          : coins(Math.abs(figures.profit))) + margin,
        profitClass,
      );
  }
}

// ---------------------------------------------------------------- helpers

const $ = (selector) => document.querySelector(selector);

function button(className, title, html) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.title = title;
  element.setAttribute("aria-haspopup", "true");
  element.setAttribute("aria-expanded", "false");
  element.innerHTML = html;
  return element;
}

function popover(className, title) {
  const element = document.createElement("div");
  element.className = `dl-pop ${className}`;
  element.hidden = true;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", title);
  element.innerHTML = `<div class="dl-title">${escapeHtml(title)}</div><div class="dl-body"></div>`;
  return element;
}
