/**
 * Lab page (not deployed): the same synthetic graphs drawn by our WebGL renderer and by Cytoscape in the app's
 * configurations, timed on first frame and on a scripted zoom/pan.
 */
import { WebGLGraph } from "../../lib/prism/render/webgl-graph.js";
import { buildStylesheet } from "../graph/stylesheet.js";
import { DEFAULT_SETTINGS } from "../config/settings-schema.js";
import { RARITY_COLORS } from "../config/constants.js";

const $ = (selector) => document.querySelector(selector);
const NODE_SIZE = 50;
const FRAMES = 120;

let icons = [];
let current = null; // { name, destroy(), setView(zoom, panX, panY), fit(), drawMs? }

/** Deterministic pseudo-random numbers, so every renderer gets the same graph. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** A crafting-style tree of `count` nodes, laid out left to right (depth → x, leaves stacked on y). */
function makeGraph(count) {
  const next = random(count);
  const rarities = Object.keys(RARITY_COLORS);
  const nodes = [{ id: "n0", depth: 0, children: [] }];
  const queue = [nodes[0]];
  while (nodes.length < count && queue.length) {
    const parent = queue.shift();
    const children = 2 + Math.floor(next() * 5);
    for (let i = 0; i < children && nodes.length < count; i++) {
      const node = {
        id: `n${nodes.length}`,
        depth: parent.depth + 1,
        children: [],
        parent,
      };
      parent.children.push(node);
      nodes.push(node);
      queue.push(node);
    }
  }
  let leafY = 0;
  const place = (node) => {
    if (!node.children.length) node.y = leafY++ * 70;
    else {
      node.children.forEach(place);
      node.y = (node.children[0].y + node.children.at(-1).y) / 2;
    }
    node.x = node.depth * 320;
  };
  place(nodes[0]);
  for (const node of nodes) {
    const item = icons[Math.floor(next() * icons.length)] ?? {};
    node.label = `${1 + Math.floor(next() * 250)} × ${item.name ?? "Item"}`;
    node.icon = item.icon ?? null;
    node.color =
      RARITY_COLORS[item.rarity] ??
      RARITY_COLORS[rarities[Math.floor(next() * rarities.length)]];
  }
  const edges = nodes
    .filter((node) => node.parent)
    .map((node) => ({
      id: `${node.parent.id}-${node.id}`,
      source: node.parent.id,
      target: node.id,
    }));
  return { nodes, edges };
}

// ---------------------------------------------------------------- renderers

function mountOurs(graph, stage) {
  const element = document.createElement("div");
  stage.append(element);
  const view = new WebGLGraph(
    element,
    {},
    {
      preserveDrawingBuffer: new URLSearchParams(location.search).has(
        "screenshot",
      ),
    },
  );
  view.setOptions({ labels: { position: "right" } });
  view.setGraph({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: NODE_SIZE,
      height: NODE_SIZE,
      style: {
        shape: "round-rectangle",
        fill: "#1a2030",
        fillAlpha: 1,
        border: node.color,
        borderWidth: 3,
        pattern: "solid",
        iconAlpha: 1,
        aura: null,
        ring: null,
        badge: false,
        icon: node.icon,
        label: node.label,
        fontSize: 11,
        bold: node.depth === 0,
        labelPriority: node.depth === 0 ? 1 : 0,
      },
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      style: {
        color: "#3b4558",
        width: 1.6,
        alpha: 1,
        pattern: null,
        arrowAtSource: null,
        arrowAtTarget: "triangle",
        arrowScale: 1,
        label: "",
        glow: false,
      },
    })),
    routing: "taxi",
    flowAxis: "x",
  });
  view.fitView({ animate: false });
  return {
    /** Light every edge with flowing pulses (the costliest edge effect). */
    flow: (on) =>
      view.setEdgeEmphasis(
        on
          ? new Map(
              graph.edges.map((edge) => [
                edge.id,
                { color: "#62a4da", flow: 1 },
              ]),
            )
          : null,
      ),
    destroy: () => {
      view.destroy();
      element.remove();
    },
    setView: (zoom, panX, panY) => {
      Object.assign(view.camera, { zoom, panX, panY });
      view.requestRender();
    },
    view: () => ({
      zoom: view.camera.zoom,
      panX: view.camera.panX,
      panY: view.camera.panY,
    }),
    drawMs: () => view.stats.drawMs,
    engine: view, // for console experiments
  };
}

function mountCytoscape(graph, stage, mode) {
  const element = document.createElement("div");
  stage.append(element);
  const settings = { ...DEFAULT_SETTINGS, direction: "RL" };
  const cy = globalThis.cytoscape({
    container: element,
    style: buildStylesheet(settings),
    layout: { name: "preset" },
    elements: [
      ...graph.nodes.map((node) => ({
        group: "nodes",
        data: {
          id: node.id,
          label: node.label,
          color: node.color,
          ...(node.icon ? { icon: node.icon } : {}),
        },
        position: { x: node.x, y: node.y },
        classes: node.depth === 0 ? "root" : "",
      })),
      ...graph.edges.map((edge) => ({
        group: "edges",
        data: {
          ...edge,
          label: "",
          sourceColor: "#3b4558",
          targetColor: "#3b4558",
          controlPointDistances: [0],
          controlPointWeights: [0.5],
        },
      })),
    ],
    ...(mode === "cy-webgl"
      ? { renderer: { name: "canvas", webgl: true } }
      : {}),
  });
  const renderer = cy.renderer();
  if (mode === "cy-app") {
    // What graph-view.js does (#tuneRendererFor).
    const elements = graph.nodes.length + graph.edges.length;
    renderer.textureOnViewport = elements > 500;
    renderer.hideEdgesOnViewport = elements > 2500;
  } else {
    renderer.textureOnViewport = false;
    renderer.hideEdgesOnViewport = false;
  }
  renderer.motionBlur = false;
  cy.fit(undefined, 40);
  return {
    destroy: () => {
      cy.destroy();
      element.remove();
    },
    setView: (zoom, panX, panY) =>
      cy.viewport({ zoom, pan: { x: panX, y: panY } }),
    view: () => ({ zoom: cy.zoom(), panX: cy.pan().x, panY: cy.pan().y }),
    drawMs: () => null,
    flow: null,
  };
}

const RENDERERS = {
  "webgl-graph": { name: "Ours (WebGL2 + label layer)", mount: mountOurs },
  "cy-app": {
    name: "Cytoscape, as the app runs it",
    mount: (g, s) => mountCytoscape(g, s, "cy-app"),
  },
  "cy-full": {
    name: "Cytoscape, full quality",
    mount: (g, s) => mountCytoscape(g, s, "cy-full"),
  },
  "cy-webgl": {
    name: "Cytoscape WebGL mode",
    mount: (g, s) => mountCytoscape(g, s, "cy-webgl"),
  },
};

// ---------------------------------------------------------------- measuring

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

async function show(rendererKey, size) {
  current?.destroy();
  $("#stage").innerHTML = "";
  const graph = makeGraph(size);
  const started = performance.now();
  current = RENDERERS[rendererKey].mount(graph, $("#stage"));
  if (flowing) current.flow?.(true); // the toggle outlives the renderer
  await nextFrame();
  await nextFrame();
  return performance.now() - started;
}

/**
 * scenario "overview": zoom from the fitted view in to ~3× and back, drifting around (labels mostly hidden).
 * "closeup": zoom 1, panning across the middle of the graph (dozens of labels and icons on screen every frame).
 */
async function benchmark(rendererKey, size, scenario = "overview") {
  $("#status").textContent =
    `Running ${RENDERERS[rendererKey].name}, ${size} nodes…`;
  const firstFrame = await show(rendererKey, size);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // icons arrive
  const base = current.view();
  const gaps = [],
    draws = [];
  let last = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    const t = (i / FRAMES) * Math.PI * 2;
    const width = $("#stage").clientWidth,
      height = $("#stage").clientHeight;
    const middleX = (width / 2 - base.panX) / base.zoom,
      middleY = (height / 2 - base.panY) / base.zoom;
    const zoom =
      scenario === "closeup" ? 1 : base.zoom * (1 + 1.8 * Math.sin(t / 2) ** 2);
    const centreX =
      middleX + Math.cos(t) * (scenario === "closeup" ? 600 : 400);
    const centreY =
      middleY + Math.sin(t) * (scenario === "closeup" ? 1500 : 400);
    current.setView(
      zoom,
      width / 2 - centreX * zoom,
      height / 2 - centreY * zoom,
    );
    const now = await nextFrame();
    gaps.push(now - last);
    last = now;
    const draw = current.drawMs();
    if (draw != null) draws.push(draw);
  }
  gaps.shift(); // the first gap includes setup
  gaps.sort((a, b) => a - b);
  const average = (list) => list.reduce((sum, x) => sum + x, 0) / list.length;
  return {
    renderer:
      RENDERERS[rendererKey].name +
      (scenario === "closeup" ? " (close-up)" : "") +
      (flowing && current.flow ? " (flow)" : ""),
    size,
    firstFrame,
    average: average(gaps),
    p95: gaps[Math.floor(gaps.length * 0.95)],
    worst: gaps.at(-1),
    draw: draws.length ? average(draws) : null,
  };
}

const results = [];
function addResult(result) {
  results.push(result);
  const cell = (value) => (value == null ? "—" : value.toFixed(1));
  $("#results tbody").insertAdjacentHTML(
    "beforeend",
    `<tr><td>${result.renderer}</td><td>${result.size}</td><td>${cell(result.firstFrame)}</td><td>${cell(result.average)}</td><td>${cell(result.p95)}</td><td>${cell(result.worst)}</td><td>${cell(result.draw)}</td></tr>`,
  );
}

async function loadIcons() {
  $("#status").textContent = "Loading item icons…";
  try {
    const response = await fetch(
      "https://api.guildwars2.com/v2/items?page=0&page_size=200",
    );
    icons = (await response.json()).map(({ name, icon, rarity }) => ({
      name,
      icon,
      rarity,
    }));
  } catch {
    icons = [];
  }
  $("#status").textContent = "";
}

let flowing = false;
$("#flow").addEventListener("click", () => {
  flowing = !flowing;
  current?.flow?.(flowing);
});
$("#show").addEventListener("click", () =>
  show($("#renderer").value, Number($("#size").value)),
);
$("#run").addEventListener("click", async () =>
  addResult(await benchmark($("#renderer").value, Number($("#size").value))),
);
$("#runAll").addEventListener("click", async () => {
  for (const size of [250, 1000, 3000, 10000])
    for (const key of Object.keys(RENDERERS))
      addResult(await benchmark(key, size));
  $("#status").textContent = "Done.";
});
globalThis.renderBench = {
  flow: (on) => {
    flowing = on;
    current?.flow?.(on);
  },
  benchmark,
  show,
  results,
  get current() {
    return current;
  },
}; // for scripted runs
await loadIcons();
show($("#renderer").value, Number($("#size").value));
