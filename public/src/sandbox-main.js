/**
 * Entry point for the engine sandbox: Prism (src/render/) and Tether (src/layout/) driven by made-up graphs, with
 * every graph option from the crafting page, play buttons and live engine stats. Its options are kept apart from
 * the crafting page's (their own storage key), so playing here changes nothing there.
 */
import {
  CUSTOMIZE_GROUPS,
  DEFAULT_SETTINGS,
  Redraw,
  SETTINGS_GROUPS,
} from "./config/settings-schema.js";
import { UI_COLORS } from "./config/constants.js";
import { createAccountSession } from "./data/site-account.js";
import { registerServiceWorker } from "./pwa.js";
import { WebGLGraphView } from "./render/webgl-graph-view.js";
import { canDrawGraphs } from "./render/choose-graph-view.js";
import { GRAPH_SHAPES, generateGraph } from "./sandbox/generate-graph.js";
import { hash, sandboxElements } from "./sandbox/sandbox-elements.js";
import { OptionsPanel } from "./ui/options-panel.js";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { querySelector as $ } from "./utils/dom.js";

const STORAGE_KEY = "gw2viz.sandbox.v1";
/** Options that make no sense here: which renderer (this page is Prism's) and the crafting page's filters. */
const LEFT_OUT = new Set(["graphRenderer"]);
const GROUPS = [
  ...CUSTOMIZE_GROUPS.filter((group) => group.id !== "filter"),
  ...SETTINGS_GROUPS.filter((group) =>
    ["interaction", "animation"].includes(group.id),
  ),
].map((group) => ({
  ...group,
  options: group.options.filter((option) => !LEFT_OUT.has(option.key)),
}));

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
let lastLayoutMs = 0;

const account = createAccountSession();
mountSiteChrome({ page: "sandbox", account });
account.restore();
registerServiceWorker();

if (!canDrawGraphs() || !supportsWebGL2()) $("#sbUnsupported").hidden = false;
else start();

function start() {
  view = new WebGLGraphView({
    container: $("#cy"),
    canvasWrapper: $("#cyWrap"),
    settings,
    handlers: {
      onNodeTap: (id) => view.select(id),
      onNodeDoubleTap: (id) => toggle(id),
      onNodeContextTap: (id) => view.pulse(id),
      onBackgroundTap: () => view.select(null),
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
  const panel = new OptionsPanel(
    $("#sbOptions"),
    settings,
    { groups: GROUPS, initiallyOpen: ["layout", "forces"], idPrefix: "sb" },
    {
      onOptionChange: (key, value, redraw) => {
        settings.values[key] = value;
        panel.syncValues();
        panel.refreshStatus();
        applyRedraw(redraw);
        save();
      },
      onReset: (keys) => {
        for (const key of keys) settings.values[key] = DEFAULT_SETTINGS[key];
        panel.render();
        applyRedraw(Redraw.fit);
        save();
      },
    },
  );
  panel.render();
  if (["localhost", "127.0.0.1"].includes(location.hostname))
    globalThis.gw2Sandbox = {
      view,
      settings,
      get graph() {
        return graph;
      },
    }; // console access while developing
  bindGraphControls();
  bindPlay();
  setInterval(showStats, 250);
  regenerate();
  if (graphOptions.icons) loadIcons();
}

// ---------------------------------------------------------------- the graph

function regenerate() {
  const started = performance.now();
  graph = generateGraph(graphOptions);
  collapsed = new Set();
  const made = performance.now() - started;
  draw({ fit: "smart", grow: true });
  status(
    `${graph.nodes.length.toLocaleString()} items and ${graph.edges.length.toLocaleString()} links, made in ${Math.round(made)} ms, laid out and drawn in ${Math.round(lastLayoutMs)} ms.`,
  );
  save();
}

function elements() {
  return sandboxElements(graph, {
    collapsed,
    colorBy: graphOptions.colorBy,
    states: graphOptions.states,
    icons,
  });
}

/** Lay out and draw what's shown (Tether, then Prism morphs from the previous graph). */
function draw({ fit = false, anchorNodeId = null, grow = false } = {}) {
  const result = elements();
  hasChildren = result.hasChildren;
  shownIds = result.nodeElements.map((element) => element.data.id);
  const started = performance.now();
  view.render({ ...result, fit, anchorNodeId, grow });
  lastLayoutMs = performance.now() - started;
}

function applyRedraw(redraw) {
  if (redraw === Redraw.fit) draw({ fit: true });
  else if (redraw === Redraw.relayout) draw();
  else {
    view.applyStylesheet();
    view.syncBackground();
  }
}

function toggle(id) {
  if (!hasChildren(id)) return;
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  draw({ anchorNodeId: id });
}

// ---------------------------------------------------------------- controls

function bindGraphControls() {
  const shape = $("#sbShape");
  shape.innerHTML = Object.entries(GRAPH_SHAPES)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  shape.value = graphOptions.shape;
  const size = $("#sbSize");
  size.value = String(Math.log10(graphOptions.size));
  $("#sbBranching").value = String(graphOptions.branching);
  $("#sbShared").value = String(graphOptions.shared);
  $("#sbSeed").value = String(graphOptions.seed);
  $("#sbColorBy").value = graphOptions.colorBy;
  $("#sbStates").checked = graphOptions.states;
  $("#sbIcons").checked = graphOptions.icons;
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
  onSlide(size, (value) => (graphOptions.size = Math.round(10 ** value)));
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
  $("#sbColorBy").addEventListener("change", (event) => {
    graphOptions.colorBy = event.target.value;
    recolour();
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

function bindPlay() {
  const actions = {
    grow,
    collapse: collapseRandom,
    expand: () => {
      collapsed = new Set();
      draw();
    },
    scatter: () => view.settle({ scatter: 500, heat: 1 }),
    shake: () => view.settle({ heat: 0.7 }),
    recolour: () => {
      graphOptions.colorBy =
        graphOptions.colorBy === "rarity" ? "depth" : "rarity";
      $("#sbColorBy").value = graphOptions.colorBy;
      recolour();
    },
    pulse: () => view.pulse(randomShown()),
    flash: () =>
      view.flash(
        Array.from({ length: 12 }, () => randomShown()),
        2200,
      ),
    lineage: () => view.select(randomShown()),
    export: exportPng,
  };
  $(".sb-buttons").addEventListener("click", (event) => {
    const name = event.target.closest("[data-action]")?.dataset.action;
    actions[name]?.();
  });
}

/** New colours without a new layout: they blend from the old ones. */
function recolour() {
  const { nodeElements, edgeElements } = elements();
  view.updateInPlace(
    nodeElements.map(({ data, classes }) => ({ id: data.id, data, classes })),
    edgeElements.map(({ data }) => ({ id: data.id, data })),
  );
  save();
}

/** A random shown item gets 2–5 new ingredients, which unfold out of it. */
function grow() {
  const parentId = randomShown();
  const parent = graph.nodes.find((node) => node.id === parentId);
  const count = 2 + Math.floor(Math.random() * 4);
  for (let k = 0; k < count; k++) {
    const id = `g${graph.nodes.length}`;
    // Borrow a name from the graph: the sandbox's items are made up anyway.
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

function randomShown() {
  return shownIds[Math.floor(Math.random() * shownIds.length)];
}

function exportPng() {
  const link = document.createElement("a");
  link.href = view.toPngDataUri({
    scale: 1,
    backgroundColor: UI_COLORS.canvas,
  });
  link.download = `sandbox-${graphOptions.shape}-${graphOptions.seed}.png`;
  link.click();
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

// ---------------------------------------------------------------- tooltip and stats

function showTooltip(id, event) {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return;
  const tooltip = $("#sbTooltip");
  tooltip.textContent = `${node.name} · ${node.rarity} · depth ${node.depth}${collapsed.has(id) ? " · collapsed" : ""}`;
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
  const rows = [
    ["Items shown", shownIds.length.toLocaleString()],
    ["Layout + first draw", `${Math.round(lastLayoutMs)} ms`],
    [
      "Frames drawn",
      fps < 0.5 ? "idle (nothing moving)" : `${Math.round(fps)} / s`,
    ],
    [
      "CPU per frame",
      `${stats.drawMs.toFixed(2)} ms`,
      stats.drawMs < 4 ? "sb-good" : "sb-warn",
    ],
    [
      "Last GPU upload",
      `${stats.uploadMs.toFixed(2)} ms, ${stats.partialUpload ? "only what moved" : "everything"}`,
    ],
    ["Animating", stats.animating.toLocaleString()],
    ["Labels drawn", stats.labels.toLocaleString()],
    ["Physics", view.physicsRunning ? "running" : "at rest"],
  ];
  $("#sbStats").innerHTML = rows
    .map(
      ([name, value, tone]) =>
        `<dt>${name}</dt><dd${tone ? ` class="${tone}"` : ""}>${value}</dd>`,
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
    const changed = Object.fromEntries(
      Object.entries(settings.values).filter(
        ([key, value]) => value !== DEFAULT_SETTINGS[key],
      ),
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ graph: graphOptions, values: changed }),
    );
  } catch {
    // Storage blocked (private mode, site data off): the sandbox still works, it just won't remember.
  }
}

function supportsWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}
