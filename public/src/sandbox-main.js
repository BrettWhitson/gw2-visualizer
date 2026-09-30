/**
 * Entry point for the engine sandbox: developer tools for Prism (src/render/) and Tether (src/layout/) on made-up
 * graphs. Tabs: the graph; the crafting page's layout and physics options; Tether's constants (tuning.js), live;
 * Prism's rendering options; automated probes and benchmarks; tools to poke the engines. Live engine stats stay
 * visible. Everything here is kept apart from the crafting page's settings (its own storage key).
 */
import {
  CUSTOMIZE_GROUPS,
  DEFAULT_SETTINGS,
  Redraw,
  SETTINGS_GROUPS,
} from "./config/settings-schema.js";
import { UI_COLORS } from "./config/constants.js";
import { createAccountSession } from "./data/site-account.js";
import { LayoutGraph } from "./layout/layout-graph.js";
import { runLayout } from "./layout/run-layout.js";
import { PHYSICS_TUNING, TUNING_OPTIONS } from "./layout/tuning.js";
import { registerServiceWorker } from "./pwa.js";
import { canDrawGraphs } from "./render/choose-graph-view.js";
import { WebGLGraphView } from "./render/webgl-graph-view.js";
import { GRAPH_SHAPES, generateGraph } from "./sandbox/generate-graph.js";
import { hopColor, hopDistances, movementByHops } from "./sandbox/probes.js";
import { hash, sandboxElements } from "./sandbox/sandbox-elements.js";
import { OptionsPanel } from "./ui/options-panel.js";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { downloadBlob, escapeHtml, querySelector as $ } from "./utils/dom.js";

const STORAGE_KEY = "gw2viz.sandbox.v2";
const COLOR_MODES = ["rarity", "depth", "hops"];

/** The crafting page's option groups, split between the sandbox's tabs (minus what's meaningless here). */
const withoutKeys = (groups, keys) =>
  groups.map((group) => ({
    ...group,
    options: group.options.filter((option) => !keys.includes(option.key)),
  }));
const PHYSICS_GROUPS = withoutKeys(
  CUSTOMIZE_GROUPS.filter((group) => ["layout", "forces"].includes(group.id)),
  ["ingredientOrder"],
);
const RENDER_GROUPS = withoutKeys(
  [
    ...CUSTOMIZE_GROUPS.filter((group) =>
      ["nodes", "labels", "edges", "forge", "highlight", "canvas"].includes(
        group.id,
      ),
    ),
    ...SETTINGS_GROUPS.filter((group) =>
      ["interaction", "animation"].includes(group.id),
    ),
  ],
  ["graphRenderer"],
);

// ---------------------------------------------------------------- state

const saved = load();
const graphOptions = {
  shape: "crafting",
  size: 120,
  branching: 4,
  shared: 0.15,
  seed: 1,
  colorBy: "rarity",
  states: true,
  icons: true,
  ...saved.graph,
};
const settings = {
  values: { ...DEFAULT_SETTINGS, ...saved.values },
  get: (key) => settings.values[key],
};
let tuning = { ...PHYSICS_TUNING, ...saved.tuning };

let graph = null;
let collapsed = new Set();
let icons = [];
let view = null;
let hasChildren = () => false;
let shownIds = [];
let shownEdges = [];
let selectedId = null;
let lastLayoutMs = 0;
let panels = [];

function start() {
  view = new WebGLGraphView({
    container: $("#cy"),
    canvasWrapper: $("#cyWrap"),
    settings,
    handlers: {
      onNodeTap: (id) => select(id),
      onNodeDoubleTap: (id) => toggle(id),
      onNodeContextTap: (id) => view.pulse(id),
      onBackgroundTap: () => select(null),
      onNodeHoverStart: (id, event) => {
        view.showLineage(id);
        showTooltip(id, event);
      },
      onNodeHoverEnd: () => {
        view.clearLineage();
        $("#sbTooltip").hidden = true;
      },
      onPointerMove: (event) => moveTooltip(event),
      onViewportChange: () => ($("#sbTooltip").hidden = true),
    },
  });
  view.setPhysicsTuning(tuning);
  const optionCallbacks = {
    onOptionChange: (key, value, redraw) => {
      settings.values[key] = value;
      for (const panel of panels) {
        panel.syncValues();
        panel.refreshStatus();
      }
      applyRedraw(redraw);
      save();
    },
    onReset: (keys) => {
      for (const key of keys) settings.values[key] = DEFAULT_SETTINGS[key];
      for (const panel of panels) panel.render();
      applyRedraw(Redraw.fit);
      save();
    },
  };
  panels = [
    new OptionsPanel(
      $("#sbPhysicsOptions"),
      settings,
      { groups: PHYSICS_GROUPS, idPrefix: "sbp" },
      optionCallbacks,
    ),
    new OptionsPanel(
      $("#sbRenderOptions"),
      settings,
      {
        groups: RENDER_GROUPS,
        initiallyOpen: ["nodes", "edges"],
        idPrefix: "sbr",
      },
      optionCallbacks,
    ),
  ];
  for (const panel of panels) panel.render();
  if (["localhost", "127.0.0.1"].includes(location.hostname))
    globalThis.gw2Sandbox = {
      view,
      settings,
      get graph() {
        return graph;
      },
      get tuning() {
        return tuning;
      },
      tests: TESTS,
    }; // console access while developing
  bindTabs();
  bindGraphControls();
  bindTuning();
  bindActions();
  bindTests();
  setInterval(showStats, 250);
  setInterval(showAwake, 100);
  regenerate();
  if (graphOptions.icons) loadIcons();
}

// ---------------------------------------------------------------- the graph

function regenerate() {
  const started = performance.now();
  graph = generateGraph(graphOptions);
  collapsed = new Set();
  selectedId = null;
  const made = performance.now() - started;
  draw({ fit: "smart", grow: true });
  status(
    `${graph.nodes.length.toLocaleString()} items and ${graph.edges.length.toLocaleString()} links, made in ${Math.round(made)} ms; laid out and drawn in ${Math.round(lastLayoutMs)} ms.`,
  );
  save();
}

function elements() {
  let colors = null;
  if (graphOptions.colorBy === "hops" && selectedId) {
    const hops = hopDistances(graph.edges, selectedId);
    colors = new Map(
      graph.nodes.map((node) => [node.id, hopColor(hops.get(node.id))]),
    );
  }
  return sandboxElements(graph, {
    collapsed,
    colorBy: graphOptions.colorBy === "depth" ? "depth" : "rarity",
    states: graphOptions.states,
    icons,
    colors,
  });
}

/** Lay out and draw what's shown (Tether, then Prism morphs from the previous graph). */
function draw({ fit = false, anchorNodeId = null, grow = false } = {}) {
  const result = elements();
  hasChildren = result.hasChildren;
  shownIds = result.nodeElements.map((element) => element.data.id);
  shownEdges = result.edgeElements.map(({ data }) => ({
    source: data.source,
    target: data.target,
  }));
  const started = performance.now();
  view.render({ ...result, fit, anchorNodeId, grow });
  lastLayoutMs = performance.now() - started;
  if (selectedId && shownIds.includes(selectedId)) view.select(selectedId);
}

/** New colours without a new layout: they blend from the old ones. */
function recolour() {
  const { nodeElements, edgeElements } = elements();
  view.updateInPlace(
    nodeElements.map(({ data, classes }) => ({ id: data.id, data, classes })),
    edgeElements.map(({ data }) => ({ id: data.id, data })),
  );
}

function applyRedraw(redraw) {
  if (redraw === Redraw.fit) draw({ fit: true });
  else if (redraw === Redraw.relayout) draw();
  else {
    view.applyStylesheet();
    view.syncBackground();
  }
}

function select(id) {
  selectedId = id;
  view.select(id);
  if (graphOptions.colorBy === "hops") recolour();
}

function toggle(id) {
  if (!hasChildren(id)) return;
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  draw({ anchorNodeId: id });
}

function randomShown(withLinks = false) {
  const pool = withLinks
    ? shownIds.filter(
        (id) =>
          id !== graph.rootId &&
          shownEdges.some((e) => e.source === id || e.target === id),
      )
    : shownIds;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------- tabs and graph controls

function bindTabs() {
  const tabs = $(".sb-tabs");
  const show = (name) => {
    for (const button of tabs.querySelectorAll("[data-tab]"))
      button.setAttribute("aria-selected", String(button.dataset.tab === name));
    for (const page of document.querySelectorAll(".sb-page"))
      page.hidden = page.dataset.page !== name;
    saveTab(name);
  };
  tabs.addEventListener("click", (event) => {
    const name = event.target.closest("[data-tab]")?.dataset.tab;
    if (name) show(name);
  });
  show(saved.tab ?? "graph");
}

function bindGraphControls() {
  const shape = $("#sbShape");
  shape.innerHTML = Object.entries(GRAPH_SHAPES)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  shape.value = graphOptions.shape;
  $("#sbSize").value = String(Math.log10(graphOptions.size));
  $("#sbBranching").value = String(graphOptions.branching);
  $("#sbShared").value = String(graphOptions.shared);
  $("#sbSeed").value = String(graphOptions.seed);
  $("#sbColorBy").value = graphOptions.colorBy;
  $("#sbStates").checked = graphOptions.states;
  $("#sbIcons").checked = graphOptions.icons;
  $("#sbView").value = settings.values.viewMode;
  const outputs = () => {
    $("#sbSizeOut").textContent = graphOptions.size.toLocaleString();
    $("#sbBranchingOut").textContent = String(graphOptions.branching);
    $("#sbSharedOut").textContent = `${Math.round(graphOptions.shared * 100)}%`;
  };
  outputs();
  // Sliders regenerate when let go (a 10,000-item graph shouldn't be rebuilt on every step of a drag).
  const onSlide = (input, apply) => {
    input.addEventListener("input", () => {
      apply(Number(input.value));
      outputs();
    });
    input.addEventListener("change", regenerate);
  };
  onSlide(
    $("#sbSize"),
    (value) => (graphOptions.size = Math.round(10 ** value)),
  );
  onSlide($("#sbBranching"), (value) => (graphOptions.branching = value));
  onSlide($("#sbShared"), (value) => (graphOptions.shared = value));
  shape.addEventListener("change", () => {
    graphOptions.shape = shape.value;
    regenerate();
  });
  $("#sbSeed").addEventListener("change", (event) => {
    graphOptions.seed = Math.max(
      1,
      Math.floor(Number(event.target.value)) || 1,
    );
    regenerate();
  });
  $("#sbReseed").addEventListener("click", () => {
    graphOptions.seed = 1 + Math.floor(Math.random() * 99999);
    $("#sbSeed").value = String(graphOptions.seed);
    regenerate();
  });
  $("#sbView").addEventListener("change", (event) => {
    settings.values.viewMode = event.target.value;
    draw({ fit: true });
    save();
  });
  $("#sbColorBy").addEventListener("change", (event) => {
    graphOptions.colorBy = event.target.value;
    recolour();
    save();
  });
  $("#sbStates").addEventListener("change", (event) => {
    graphOptions.states = event.target.checked;
    draw();
    save();
  });
  $("#sbIcons").addEventListener("change", (event) => {
    graphOptions.icons = event.target.checked;
    if (graphOptions.icons) loadIcons();
    else {
      icons = [];
      draw();
    }
    save();
  });
  $(".sb-tools").addEventListener("click", (event) => {
    const action = event.target.closest("[data-graph]")?.dataset.graph;
    if (action === "fit") view.fit();
    else if (action === "zoom-in") view.zoomBy(1.25);
    else if (action === "zoom-out") view.zoomBy(0.8);
  });
}

// ---------------------------------------------------------------- tuning

function bindTuning() {
  const root = $("#sbTuning");
  const groups = [...new Set(TUNING_OPTIONS.map((option) => option.group))];
  root.innerHTML = groups
    .map(
      (
        group,
      ) => `<details class="sb-tuning-group" open><summary>${group}</summary>
      ${TUNING_OPTIONS.filter((option) => option.group === group)
        .map((option) => {
          const id = `sbt-${option.key}`;
          const control =
            option.min === undefined
              ? `<input id="${id}" type="checkbox" data-tuning-key="${option.key}">`
              : `<input id="${id}" type="range" min="${option.min}" max="${option.max}" step="${option.step}" data-tuning-key="${option.key}">`;
          return `<div class="sb-tuning-row" data-row="${option.key}" title="${escapeHtml(option.hint)}">
            <label for="${id}">${option.label}</label>${control}
            <span class="sb-tuning-value" data-value="${option.key}"></span>
            <button type="button" data-reset-tuning="${option.key}" title="Back to ${PHYSICS_TUNING[option.key]}" aria-label="Reset ${option.label}">↺</button>
          </div>`;
        })
        .join("")}
    </details>`,
    )
    .join("");
  const sync = () => {
    for (const option of TUNING_OPTIONS) {
      const input = root.querySelector(`[data-tuning-key="${option.key}"]`);
      const value = tuning[option.key];
      if (input.type === "checkbox") input.checked = !!value;
      else input.value = String(value);
      root.querySelector(`[data-value="${option.key}"]`).textContent =
        typeof value === "boolean" ? (value ? "on" : "off") : String(value);
      root
        .querySelector(`[data-row="${option.key}"]`)
        .classList.toggle("modified", value !== PHYSICS_TUNING[option.key]);
    }
  };
  sync();
  let relayoutTimer = 0;
  const apply = (keys) => {
    view.setPhysicsTuning(tuning);
    sync();
    save();
    // Simulation and Floating constants shape the layout itself: lay it out again (debounced while sliding).
    const reshapes = keys.some((key) =>
      ["Simulation", "Floating"].includes(
        TUNING_OPTIONS.find((option) => option.key === key)?.group,
      ),
    );
    if (reshapes && $("#sbAutoRelayout").checked) {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(() => draw(), 250);
    }
  };
  root.addEventListener("input", (event) => {
    const key = event.target.dataset.tuningKey;
    if (!key) return;
    tuning[key] =
      event.target.type === "checkbox"
        ? event.target.checked
        : Number(event.target.value);
    apply([key]);
  });
  root.addEventListener("click", (event) => {
    const key = event.target.closest("[data-reset-tuning]")?.dataset
      .resetTuning;
    if (!key) return;
    tuning[key] = PHYSICS_TUNING[key];
    apply([key]);
  });
  const json = $("#sbTuningJson");
  $(".sb-page[data-page=tuning]").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-tuning]")?.dataset.tuning;
    if (action === "relayout") draw();
    else if (action === "reset") {
      tuning = { ...PHYSICS_TUNING };
      apply(Object.keys(tuning));
    } else if (action === "copy") {
      const changed = Object.fromEntries(
        Object.entries(tuning).filter(
          ([key, value]) => value !== PHYSICS_TUNING[key],
        ),
      );
      const text = JSON.stringify(changed, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        status("Copied the changed constants.");
      } catch {
        json.hidden = false;
        json.value = text;
        status("Couldn't reach the clipboard: the JSON is in the box.");
      }
    } else if (action === "paste") {
      json.hidden = !json.hidden;
      if (!json.hidden) json.focus();
    }
  });
  json.addEventListener("change", () => {
    try {
      const values = JSON.parse(json.value);
      const known = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) =>
            key in PHYSICS_TUNING &&
            typeof value === typeof PHYSICS_TUNING[key],
        ),
      );
      tuning = { ...tuning, ...known };
      apply(Object.keys(known));
      status(`Applied ${Object.keys(known).length} constant(s).`);
    } catch (error) {
      status(`That isn't valid JSON: ${error.message}`);
    }
  });
}

// ---------------------------------------------------------------- actions

function bindActions() {
  const actions = {
    regenerate,
    grow,
    collapse: collapseRandom,
    expand: () => {
      collapsed = new Set();
      draw();
    },
    shake: () => view.settle({ heat: 0.7 }),
    scatter: () => view.settle({ scatter: 500, heat: 1 }),
    stop: () => view.stopPhysics(),
    recolour: () => {
      graphOptions.colorBy =
        COLOR_MODES[
          (COLOR_MODES.indexOf(graphOptions.colorBy) + 1) % COLOR_MODES.length
        ];
      $("#sbColorBy").value = graphOptions.colorBy;
      recolour();
      save();
    },
    pulse: () => view.pulse(randomShown()),
    flash: () =>
      view.flash(
        Array.from({ length: 12 }, () => randomShown()),
        2200,
      ),
    lineage: () => select(randomShown(true)),
    fit: () => view.fit(),
    export: () => {
      const link = document.createElement("a");
      link.href = view.toPngDataUri({
        scale: 1,
        backgroundColor: UI_COLORS.canvas,
      });
      link.download = `sandbox-${graphOptions.shape}-${graphOptions.seed}.png`;
      link.click();
    },
    save: () =>
      downloadBlob(
        new Blob([JSON.stringify({ graph, options: graphOptions }, null, 1)], {
          type: "application/json",
        }),
        `sandbox-graph-${graphOptions.shape}-${graphOptions.seed}.json`,
      ),
  };
  document.body.addEventListener("click", (event) => {
    const name = event.target.closest("[data-action]")?.dataset.action;
    if (name) actions[name]?.();
  });
  $("#sbLoad").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const loaded = JSON.parse(await file.text()).graph;
      if (
        !Array.isArray(loaded?.nodes) ||
        !Array.isArray(loaded?.edges) ||
        !loaded.rootId
      )
        throw new Error("no graph in it");
      graph = loaded;
      collapsed = new Set();
      selectedId = null;
      draw({ fit: true, grow: true });
      status(
        `Loaded ${graph.nodes.length.toLocaleString()} items from ${file.name}.`,
      );
    } catch (error) {
      status(`Couldn't load ${file.name}: ${error.message}`);
    }
  });
}

/** A random shown item gets 2–5 new ingredients, which unfold out of it. */
function grow() {
  const parentId = randomShown();
  const parent = graph.nodes.find((node) => node.id === parentId);
  const count = 2 + Math.floor(Math.random() * 4);
  for (let k = 0; k < count; k++) {
    const id = `g${graph.nodes.length}`;
    const namesake = graph.nodes[hash(id) % graph.nodes.length];
    const quantity = 1 + (hash(id) % 20);
    graph.nodes.push({
      id,
      name: namesake.name,
      depth: parent.depth + 1,
      rarity: namesake.rarity,
      quantity,
    });
    graph.edges.push({ source: parent.id, target: id, quantity });
  }
  collapsed.delete(parent.id);
  draw({ anchorNodeId: parent.id });
}

function collapseRandom() {
  const candidates = shownIds.filter(
    (id) => id !== graph.rootId && hasChildren(id) && !collapsed.has(id),
  );
  if (!candidates.length) return;
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  collapsed.add(id);
  draw({ anchorNodeId: id });
}

async function loadIcons() {
  status("Loading item icons…");
  try {
    const response = await fetch(
      "https://api.guildwars2.com/v2/items?page=0&page_size=200",
    );
    icons = (await response.json()).map((item) => item.icon).filter(Boolean);
    status("");
  } catch {
    icons = [];
    status("Couldn't load item icons from the GW2 API.");
  }
  draw();
}

/** "Glow items the physics is moving": the elastic net's awake items, or the floating items still in motion. */
let glowing = false;
function showAwake() {
  if (!view) return;
  if (!$("#sbShowAwake").checked || !view.physicsRunning) {
    if (glowing) view.graph.setEmphasis(null);
    glowing = false;
    return;
  }
  const moving = new Map();
  const net = view.elasticNet;
  if (net)
    for (const i of net.active)
      if (!net.held[i]) moving.set(net.ids[i], "#5ec8e5");
  const simulation = view.simulation;
  if (!net && simulation)
    simulation.ids.forEach((id, i) => {
      if (Math.abs(simulation.vx[i]) + Math.abs(simulation.vy[i]) > 0.05)
        moving.set(id, "#5ec8e5");
    });
  view.graph.setEmphasis(moving.size ? moving : null);
  glowing = true;
}

// ---------------------------------------------------------------- tests

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/** Wait until nothing animates and no physics runs (or give up after `limit` ms). */
async function atRest(limit = 8000) {
  const until = performance.now() + limit;
  while (
    (view.physicsRunning || view.graph.stats.animating > 0) &&
    performance.now() < until
  )
    await wait(50);
}

function snapshot() {
  return new Map(
    shownIds.map((id) => [id, { ...view.graph.livePositionOf(id) }]),
  );
}

function probeTarget() {
  return selectedId && shownIds.includes(selectedId)
    ? selectedId
    : randomShown(true);
}

/** Grab `id`, move it by `dx` screen px over a few frames, hold, measure, let go, measure again. */
async function probe(id, dx) {
  // At zoom 1, so a nudge of N px is N world units whatever the graph's size.
  view.graph.centerOn(id, { zoom: 1, animate: false });
  await atRest();
  const zoom = 1;
  const before = snapshot();
  const hops = hopDistances(shownEdges, id);
  const start = view.graph.livePositionOf(id);
  const drag = view.beginDrag(id);
  const steps = 8;
  for (let k = 1; k <= steps; k++) {
    drag.move(start.x + ((dx / zoom) * k) / steps, start.y);
    await nextFrame();
  }
  await wait(Number($("#sbHold").value) || 1500);
  const held = movementByHops(before, snapshot(), hops);
  drag.end();
  await wait(300);
  await atRest();
  const released = movementByHops(before, snapshot(), hops);
  return { held, released, hops };
}

function hopTable(rows, probedId) {
  const body = rows
    .map(
      (row) =>
        `<tr><td>${row.hops === 0 ? "held" : row.hops === "unlinked" ? "unlinked" : row.hops}</td><td>${row.moved}/${row.count}</td><td>${row.max.toFixed(1)}</td><td>${row.mean.toFixed(2)}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Links from ${escapeHtml(probedId)}</th><th>Moved</th><th>Max</th><th>Mean</th></tr></thead><tbody>${body}</tbody></table>`;
}

const TESTS = {
  /** Grab without moving: nothing else should move. */
  async hold() {
    const id = probeTarget();
    const { held } = await probe(id, 0);
    const others = held.filter((row) => row.hops !== 0);
    const worst = Math.max(0, ...others.map((row) => row.max));
    return {
      title: `Hold probe (${settings.values.physicsMode})`,
      pass: worst < 0.5,
      html: `${hopTable(held, id)}<p>Largest movement anywhere else: ${worst.toFixed(2)} world units.</p>`,
    };
  },
  /** Grab, nudge, hold, let go: the pull should fade with each link. */
  async drag() {
    const id = probeTarget();
    const dx = Number($("#sbNudge").value) || 8;
    const { held, released } = await probe(id, dx);
    const linked = held.filter(
      (row) => typeof row.hops === "number" && row.hops > 0,
    );
    const nearMax = Math.max(
      0,
      ...linked.filter((row) => row.hops === 1).map((row) => row.max),
    );
    const farMax = Math.max(
      0,
      ...linked.filter((row) => row.hops >= 4).map((row) => row.max),
    );
    // Elastic pulls travel along links, so the far ones must move no more than the near ones. Floating repulsion
    // acts through space too, so there the test is that nothing 4+ links away moves as far as the nudge itself.
    const floating = settings.values.physicsMode === "floating";
    return {
      title: `Drag probe: ${dx} px (${settings.values.physicsMode})`,
      pass: floating ? farMax < dx : farMax <= Math.max(1, nearMax),
      html: `<p>While held:</p>${hopTable(held, id)}<p>After letting go:</p>${hopTable(released, id)}<p>Direct links moved up to ${nearMax.toFixed(1)}; 4+ links away up to ${farMax.toFixed(1)}.</p>`,
    };
  },
  /** Tether alone: the same graph and settings must always lay out the same. */
  async determinism() {
    const layoutOnce = () => {
      const layoutGraph = plainLayoutGraph();
      runLayout(layoutGraph, settings.values, { tuning });
      return layoutGraph;
    };
    const a = layoutOnce(),
      b = layoutOnce();
    let worst = 0;
    for (let i = 0; i < a.count; i++)
      worst = Math.max(
        worst,
        Math.abs(a.x[i] - b.x[i]),
        Math.abs(a.y[i] - b.y[i]),
      );
    return {
      title: "Determinism",
      pass: worst === 0,
      html: `<p>${a.count.toLocaleString()} items laid out twice; largest difference ${worst}.</p>`,
    };
  },
  /** How long Tether takes for this graph and these settings. */
  async layout() {
    const times = [];
    for (let k = 0; k < 3; k++) {
      const layoutGraph = plainLayoutGraph();
      const started = performance.now();
      runLayout(layoutGraph, settings.values, { tuning });
      times.push(performance.now() - started);
      await wait(0);
    }
    const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
    const s = settings.values;
    return {
      title: "Layout timing",
      pass: true,
      html: `<p>${shownIds.length.toLocaleString()} items, ${s.direction === "radial" ? "radial" : `tree ${s.direction}`}, ${s.physicsMode}: ${times.map((t) => `${Math.round(t)} ms`).join(", ")} (mean ${Math.round(mean)} ms). Last full render (layout + first draw): ${Math.round(lastLayoutMs)} ms.</p>`,
    };
  },
  /** Prism: pan and zoom for 120 frames. */
  async render() {
    await atRest();
    const engine = view.graph;
    const camera = engine.camera;
    const base = { zoom: camera.zoom, panX: camera.panX, panY: camera.panY };
    const gaps = [],
      cpu = [];
    let last = performance.now();
    for (let k = 0; k < 120; k++) {
      const t = (k / 120) * Math.PI * 2;
      camera.zoom = base.zoom * (1 + 0.8 * Math.sin(t / 2) ** 2);
      camera.panX = base.panX + Math.cos(t) * 120;
      camera.panY = base.panY + Math.sin(t) * 120;
      engine.requestRender();
      const now = await nextFrame();
      gaps.push(now - last);
      last = now;
      cpu.push(engine.stats.drawMs);
    }
    Object.assign(camera, base);
    engine.requestRender();
    gaps.shift();
    const sorted = [...gaps].sort((a, b) => a - b);
    const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return {
      title: "Render benchmark",
      pass: p95 < 34,
      html: `<p>${shownIds.length.toLocaleString()} items: frames ${mean(gaps).toFixed(1)} ms average, ${p95.toFixed(1)} ms p95, ${sorted.at(-1).toFixed(1)} ms worst; CPU ${mean(cpu).toFixed(2)} ms per frame.${document.hidden ? " (The page is hidden, so the browser throttles frames: show it for real numbers.)" : ""}</p>`,
    };
  },
};

/** The shown graph as Tether sees it, with fixed sizes (for layout-only tests). */
function plainLayoutGraph() {
  return new LayoutGraph(
    shownIds.map((id) => ({
      id,
      w: 48,
      h: 48,
      fullW: 150,
      fullH: 64,
      root: id === graph.rootId,
    })),
    shownEdges,
  );
}

function bindTests() {
  const results = $("#sbResults");
  let running = false;
  const run = async (names) => {
    if (running) return;
    running = true;
    for (const name of names) {
      status(`Running ${name}…`);
      try {
        const result = await TESTS[name]();
        results.insertAdjacentHTML(
          "afterbegin",
          `<article class="sb-result"><h4><span>${escapeHtml(result.title)}</span><span class="${result.pass ? "pass" : "fail"}">${result.pass ? "pass" : "check"}</span></h4>${result.html}</article>`,
        );
      } catch (error) {
        results.insertAdjacentHTML(
          "afterbegin",
          `<article class="sb-result"><h4><span>${name}</span><span class="fail">error</span></h4><p>${escapeHtml(error.message)}</p></article>`,
        );
      }
    }
    status("");
    running = false;
  };
  $(".sb-page[data-page=tests]").addEventListener("click", (event) => {
    const name = event.target.closest("[data-test]")?.dataset.test;
    if (!name) return;
    run(
      name === "all"
        ? ["determinism", "layout", "hold", "drag", "render"]
        : [name],
    );
  });
}

// ---------------------------------------------------------------- tooltip and stats

function showTooltip(id, event) {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return;
  const tooltip = $("#sbTooltip");
  tooltip.textContent = `${node.name} · ${node.rarity} · depth ${node.depth} · ${id}${collapsed.has(id) ? " · collapsed" : ""}`;
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const tooltip = $("#sbTooltip");
  if (tooltip.hidden || !event) return;
  const box = $("#cyWrap").getBoundingClientRect();
  tooltip.style.left = `${event.clientX - box.left + 14}px`;
  tooltip.style.top = `${event.clientY - box.top + 14}px`;
}

let lastFrames = 0,
  lastTime = performance.now();
function showStats() {
  const stats = view.graph.stats;
  const now = performance.now();
  const fps = ((stats.frames - lastFrames) * 1000) / (now - lastTime);
  lastFrames = stats.frames;
  lastTime = now;
  const s = settings.values;
  const simulation = view.simulation;
  const net = view.elasticNet;
  const rows = [
    ["Items shown", shownIds.length.toLocaleString()],
    [
      "Layout",
      `${s.direction === "radial" ? "radial" : `tree ${s.direction}`}, ${s.viewMode} seed`,
    ],
    [
      "Physics",
      `${s.physicsMode}, ${view.physicsRunning ? "running" : "at rest"}`,
    ],
    ["Layout + first draw", `${Math.round(lastLayoutMs)} ms`],
    ["Frames drawn", fps < 0.5 ? "idle" : `${Math.round(fps)} / s`],
    [
      "CPU per frame",
      `${stats.drawMs.toFixed(2)} ms`,
      stats.drawMs < 4 ? "sb-good" : "sb-warn",
    ],
    [
      "Last GPU upload",
      `${stats.uploadMs.toFixed(2)} ms, ${stats.partialUpload ? "partial" : "full"}`,
    ],
    ["Animating", stats.animating.toLocaleString()],
    ["Labels drawn", stats.labels.toLocaleString()],
    [
      "Simulation",
      simulation
        ? `heat ${simulation.alpha.toFixed(3)}, fastest ${Number.isFinite(simulation.motion) ? simulation.motion.toFixed(3) : "–"}`
        : "–",
    ],
    ["Elastic net", net ? `${net.active.length} awake` : "–"],
    ["Selected", selectedId ?? "–"],
  ];
  $("#sbStats").innerHTML = rows
    .map(
      ([name, value, tone]) =>
        `<dt>${name}</dt><dd${tone ? ` class="${tone}"` : ""}>${escapeHtml(String(value))}</dd>`,
    )
    .join("");
}

function status(text) {
  $("#statusText").textContent = text;
}

// ---------------------------------------------------------------- storage

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function save() {
  try {
    const changed = (values, defaults) =>
      Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) => value !== defaults[key],
        ),
      );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...load(),
        graph: graphOptions,
        values: changed(settings.values, DEFAULT_SETTINGS),
        tuning: changed(tuning, PHYSICS_TUNING),
      }),
    );
  } catch {
    // Storage blocked (private mode, site data off): the sandbox still works, it just won't remember.
  }
}

function saveTab(tab) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...load(), tab }));
  } catch {
    // Remembering the tab is a convenience.
  }
}

function supportsWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- start (last: everything above is defined)

const account = createAccountSession();
mountSiteChrome({ page: "sandbox", account });
account.restore();
registerServiceWorker();

if (!canDrawGraphs() || !supportsWebGL2()) $("#sbUnsupported").hidden = false;
else start();
