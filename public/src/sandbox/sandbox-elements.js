import { DEPTH_COLORS, RARITY_COLORS } from "../config/constants.js";

/**
 * A generated graph (generate-graph.js) as the node and edge elements a graph view renders, with what's collapsed
 * left out. Pure.
 *
 * @param {ReturnType<typeof import('./generate-graph.js').generateGraph>} graph
 * @param {{ collapsed?: Set<string>, colorBy?: "rarity" | "depth", states?: boolean, icons?: string[],
 *           colors?: Map<string, string> }} options
 *   states: mark some items owned, a better buy or a Mystic Forge result, so those looks show;
 *   icons: image URLs handed out to items (the same item always gets the same one); colors: per-item colours that
 *   win over colorBy (e.g. by links from a probed item)
 */
export function sandboxElements(
  graph,
  {
    collapsed = new Set(),
    colorBy = "rarity",
    states = true,
    icons = [],
    colors = null,
  } = {},
) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const edge of graph.edges) {
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source).push(edge);
  }

  // Shown: everything reachable from the root without going through a collapsed item.
  const shown = new Set([graph.rootId]);
  const shownEdges = [];
  for (let queue = [graph.rootId], head = 0; head < queue.length;) {
    const id = queue[head++];
    if (collapsed.has(id)) continue;
    for (const edge of children.get(id) ?? []) {
      shownEdges.push(edge);
      if (shown.has(edge.target)) continue;
      shown.add(edge.target);
      queue.push(edge.target);
    }
  }

  const colorOf = (node) =>
    colors?.get(node.id) ??
    (colorBy === "depth"
      ? DEPTH_COLORS[node.depth % DEPTH_COLORS.length]
      : RARITY_COLORS[node.rarity]);
  const forgeIds = new Set();
  const nodeElements = [...shown].map((id) => {
    const node = byId.get(id);
    const classes = [];
    if (id === graph.rootId) classes.push("root");
    if (collapsed.has(id) && children.has(id)) classes.push("hiddenKids");
    if (states) {
      const roll = hash(id) % 100;
      if (roll < 8 && id !== graph.rootId) classes.push("owned");
      else if (roll < 14 && id !== graph.rootId) classes.push("cheaper");
      if (node.depth <= 1 && roll % 3 === 0) {
        classes.push("mf");
        forgeIds.add(id);
      }
    }
    return {
      data: {
        id,
        label:
          id === graph.rootId ? node.name : `${node.quantity} × ${node.name}`,
        color: colorOf(node),
        icon: icons.length ? icons[hash(node.name) % icons.length] : undefined,
      },
      classes: classes.join(" "),
    };
  });
  const edgeElements = shownEdges.map((edge) => {
    const source = byId.get(edge.source),
      target = byId.get(edge.target);
    return {
      data: {
        id: `${edge.source}>${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: String(edge.quantity),
        sourceColor: colorOf(source),
        targetColor: colorOf(target),
      },
      classes: forgeIds.has(edge.source) ? "mf" : "",
    };
  });
  return {
    nodeElements,
    edgeElements,
    /** id → { depth } for the views that stagger growth by depth. */
    nodesById: new Map([...shown].map((id) => [id, byId.get(id)])),
    hasChildren: (id) => children.has(id),
  };
}

/** A small, stable string hash (FNV-1a). */
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
