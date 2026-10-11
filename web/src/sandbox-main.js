/**
 * Entry point for the engine sandbox: developer tools for Prismatrix on made-up GW2-shaped graphs. Tabs: the graph;
 * the crafting page's layout and physics options; Prismatrix's rendering options; benchmarks; tools to poke the
 * engine. Live engine stats stay visible. Everything here is kept apart from the crafting page's settings (its own
 * storage key).
 */
import {
  CUSTOMIZE_GROUPS,
  DEFAULT_SETTINGS,
  Redraw,
  SETTINGS_GROUPS,
} from "./config/settings-schema.js";
import { UI_COLORS } from "./config/constants.js";
import { createAccountSession } from "./data/site-account.js";
import { layoutGraph } from "prismatrix/layout";
import { registerServiceWorker } from "./pwa.js";
import { layoutSettings, modelOptions } from "./render/prism-settings.js";
import { WebGLGraphView } from "./render/webgl-graph-view.js";
import { GRAPH_SHAPES, generateGraph } from "./sandbox/generate-graph.js";
import { hopColor, hopDistances } from "./sandbox/probes.js";
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
const RENDER_GROUPS = [
  ...CUSTOMIZE_GROUPS.filter((group) =>
    ["nodes", "labels", "edges", "forge", "highlight", "canvas"].includes(
      group.id,
    ),
  ),
  ...SETTINGS_GROUPS.filter((group) =>
    ["interaction", "animation"].includes(group.id),
  ),
];

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
/** The renderer's latest frame stats (Prismatrix's FrameStats), and frames drawn so far. */
let frame = null;
let frames = 0;

function start() {
  view = new WebGLGraphView({
    container: $("#cy"),
    settings,
    handlers: {
      onNodeTap: (id) => select(id),
      onNodeDoubleTap: (id) => toggle(id),
      onNodeContextTap: (id) => view.pulse(id),
      onBackgroundTap: () => select(null),
      onNodeHoverStart: (id, event) => showTooltip(id, event),
      onNodeHoverEnd: () => ($("#sbTooltip").hidden = true),
      onPointerMove: (event) => moveTooltip(event),
      onViewportChange: () => ($("#sbTooltip").hidden = true),
    },
  });
  view.controller.onFrame = (stats) => {
    frame = stats;
    frames++;
  };
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
      tests: TESTS,
    }; // console access while developing
  bindTabs();
  bindGraphControls();
  bindActions();
  bindTests();
  setInterval(showStats, 250);
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
  draw({ fit: "smart" });
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

/** Lay out and draw what's shown (the layout layer, then the view morphs from the previous graph). */
function draw({ fit = false, anchorNodeId = null } = {}) {
  const result = elements();
  hasChildren = result.hasChildren;
  shownIds = result.nodeElements.map((element) => element.data.id);
  shownEdges = result.edgeElements.map(({ data }) => ({
    source: data.source,
    target: data.target,
  }));
  const started = performance.now();
  view.render({ ...result, fit, anchorNodeId });
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
  else view.syncSettings();
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
    reset: () => view.controller.reset(),
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
    export: async () => {
      const link = document.createElement("a");
      try {
        link.href = await view.toPngDataUri({
          scale: 1,
          backgroundColor: UI_COLORS.canvas,
        });
      } catch (error) {
        status(`PNG export failed: ${error.message}`); // too big a canvas
        return;
      }
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
      draw({ fit: true });
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

// ---------------------------------------------------------------- tests

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/** Wait until the view is at rest (or give up after `limit` ms). */
async function atRest(limit = 8000) {
  await Promise.race([view.controller.settled(), wait(limit)]);
}

const TESTS = {
  /** The layout layer alone: the same graph and settings must always lay out the same. */
  async determinism() {
    const a = layoutShown().positions,
      b = layoutShown().positions;
    let worst = 0;
    for (const [id, p] of a)
      worst = Math.max(
        worst,
        Math.abs(p.x - b.get(id).x),
        Math.abs(p.y - b.get(id).y),
      );
    return {
      title: "Determinism",
      pass: worst === 0,
      html: `<p>${a.size.toLocaleString()} items laid out twice; largest difference ${worst}.</p>`,
    };
  },
  /** How long the layout layer takes for this graph and these settings. */
  async layout() {
    const times = [];
    for (let k = 0; k < 3; k++) {
      const started = performance.now();
      layoutShown();
      times.push(performance.now() - started);
      await wait(0);
    }
    const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
    const s = settings.values;
    return {
      title: "Layout timing",
      pass: true,
      html: `<p>${shownIds.length.toLocaleString()} items, ${s.direction === "radial" ? "radial" : `${s.viewMode} ${s.direction}`}: ${times.map((t) => `${Math.round(t)} ms`).join(", ")} (mean ${Math.round(mean)} ms).</p>`,
    };
  },
  /** Prismatrix: pan and zoom for 120 frames. */
  async render() {
    await atRest();
    const c = view.controller;
    const base = { ...c.camera };
    const gaps = [],
      cpu = [];
    let last = performance.now();
    for (let k = 0; k < 120; k++) {
      const t = (k / 120) * Math.PI * 2;
      c.setCamera({
        k: base.k * (1 + 0.8 * Math.sin(t / 2) ** 2),
        x: base.x + (Math.cos(t) * 120) / base.k,
        y: base.y + (Math.sin(t) * 120) / base.k,
      });
      const now = await nextFrame();
      gaps.push(now - last);
      last = now;
      cpu.push(frame?.drawMs ?? 0);
    }
    c.setCamera(base);
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

/** The shown graph laid out by Prismatrix without a screen, with the sandbox's settings (for layout-only tests). */
function layoutShown() {
  const { layout, layoutOptions } = layoutSettings(settings.values);
  const { node, edge } = modelOptions(settings.values);
  return layoutGraph(
    { nodes: shownIds.map((id) => ({ id })), edges: shownEdges },
    { layout, layoutOptions, node, edge },
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
    run(name === "all" ? ["determinism", "layout", "render"] : [name]);
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
  const now = performance.now();
  const fps = ((frames - lastFrames) * 1000) / (now - lastTime);
  lastFrames = frames;
  lastTime = now;
  const s = settings.values;
  const c = view.controller;
  const drawMs = frame?.drawMs ?? 0;
  const rows = [
    ["Items shown", shownIds.length.toLocaleString()],
    [
      "Layout",
      `${c.layout}${s.direction === "radial" ? "" : ` ${s.direction}`}`,
    ],
    ["Physics", `${c.mode}`],
    ["State", frame?.state ?? "–"],
    ["Layout + first draw", `${Math.round(lastLayoutMs)} ms`],
    ["Frames drawn", fps < 0.5 ? "idle" : `${Math.round(fps)} / s`],
    [
      "CPU per frame",
      `${drawMs.toFixed(2)} ms`,
      drawMs < 4 ? "sb-good" : "sb-warn",
    ],
    ["Moving nodes", `${(frame?.simMs ?? 0).toFixed(2)} ms`],
    ["Energy", (frame?.energy ?? 0).toFixed(2)],
    ["Renderer", c.renderer?.name ?? "–"],
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

// ---------------------------------------------------------------- start (last: everything above is defined)

const account = createAccountSession();
mountSiteChrome({ page: "sandbox", account });
account.restore();
registerServiceWorker();

start();
