/**
 * Made-up crafting graphs for the engine sandbox: the same shape of data the crafting page draws (a result, its
 * ingredients, theirs, and raw materials shared between branches), at any size, from a seed. Pure: the same options
 * always give the same graph.
 */

export const GRAPH_SHAPES = {
  crafting: "Crafting tree (shared raw materials)",
  tree: "Even tree",
  wide: "Wide (one result, many ingredients)",
  deep: "Deep (long chains)",
  web: "Tangled web",
};

const PREFIXES = [
  "Mithril",
  "Orichalcum",
  "Elder",
  "Ancient",
  "Gossamer",
  "Hardened",
  "Cured",
  "Mystic",
  "Charged",
  "Crystalline",
  "Obsidian",
  "Darksteel",
  "Platinum",
  "Deldrimor",
  "Spiritwood",
  "Bolt of",
  "Vial of",
  "Pile of",
  "Glob of",
  "Gift of",
];
const NOUNS = [
  "Ingot",
  "Plank",
  "Leather",
  "Dust",
  "Shard",
  "Scrap",
  "Ore",
  "Log",
  "Clover",
  "Lodestone",
  "Core",
  "Insignia",
  "Inscription",
  "Blade",
  "Hilt",
  "Essence",
  "Coin",
  "Silk",
  "Blood",
  "Fang",
];
/** Deeper items are commoner, like real recipes: the result is legendary, raw materials mostly basic or fine. */
const RARITY_BY_DEPTH = [
  ["Legendary"],
  ["Ascended", "Exotic", "Legendary"],
  ["Exotic", "Rare", "Ascended"],
  ["Rare", "Masterwork", "Exotic"],
  ["Masterwork", "Fine", "Rare"],
  ["Fine", "Basic", "Masterwork"],
];

/** A small, fast, seeded generator (mulberry32): numbers in [0, 1). */
export function randomSource(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{ shape?: keyof typeof GRAPH_SHAPES, size?: number, branching?: number, shared?: number, seed?: number }}
 *   options  size: items (≥ 1); branching: typical ingredients per recipe; shared: 0..1, how often an ingredient
 *   is one another recipe already uses (merged graphs have many)
 * @returns {{ nodes: { id: string, name: string, depth: number, rarity: string, quantity: number }[],
 *             edges: { source: string, target: string, quantity: number }[], rootId: string }}
 *   edges run product → ingredient, as on the crafting page; nodes are in the order they were made (the root first)
 */
export function generateGraph({
  shape = "crafting",
  size = 120,
  branching = 4,
  shared = 0.15,
  seed = 1,
} = {}) {
  const random = randomSource(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const count = Math.max(1, Math.floor(size));
  const nodes = [];
  const edges = [];
  const edgeKeys = new Set();
  const childCount = new Map();

  const addNode = (depth) => {
    const id = `n${nodes.length}`;
    const rarities =
      RARITY_BY_DEPTH[Math.min(depth, RARITY_BY_DEPTH.length - 1)];
    nodes.push({
      id,
      name: `${pick(PREFIXES)} ${pick(NOUNS)}`,
      depth,
      rarity: depth === 0 ? "Legendary" : pick(rarities),
      quantity: 1,
    });
    childCount.set(id, 0);
    return nodes[nodes.length - 1];
  };
  const link = (parent, child) => {
    const key = `${parent.id}>${child.id}`;
    if (parent === child || edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    // Deeper links carry bigger stacks, as raw materials do.
    const quantity =
      child.depth >= 3
        ? 5 * Math.ceil(random() * 50)
        : Math.ceil(random() * (child.depth + 1) * 2);
    edges.push({ source: parent.id, target: child.id, quantity });
    childCount.set(parent.id, childCount.get(parent.id) + 1);
    return true;
  };

  const root = addNode(0);
  // Breadth-first growth: each item gets its ingredients until there are `count` items.
  const queue = [root];
  const fanOut = (node) => {
    switch (shape) {
      case "tree":
        return branching;
      case "wide":
        return node.depth === 0 ? count : 0;
      case "deep":
        return node.depth === 0 ? branching : random() < 0.25 ? 2 : 1;
      default:
        return Math.max(
          1,
          Math.round(branching * (0.5 + random()) - node.depth * 0.3),
        );
    }
  };
  for (let head = 0; head < queue.length && nodes.length < count; head++) {
    const parent = queue[head];
    const wanted = fanOut(parent);
    for (let k = 0; k < wanted && nodes.length < count; k++) {
      // Shared: reuse an item from a deeper or equal level, so the graph stays acyclic (edges go down).
      if (shared > 0 && nodes.length > 3 && random() < shared) {
        // Nodes are made breadth-first, so the deeper ones are a suffix of the list.
        const start = firstDeeper(nodes, parent.depth);
        if (start < nodes.length) {
          const reused =
            nodes[start + Math.floor(random() * (nodes.length - start))];
          if (link(parent, reused)) continue;
        }
      }
      const child = addNode(parent.depth + 1);
      link(parent, child);
      queue.push(child);
    }
  }
  // Web: extra links across the graph, still always downward.
  if (shape === "web")
    for (let k = 0; k < count * 0.4; k++) {
      const a = pick(nodes),
        b = pick(nodes);
      if (a.depth < b.depth) link(a, b);
      else if (b.depth < a.depth) link(b, a);
    }
  const firstUse = new Map();
  for (const edge of edges)
    if (!firstUse.has(edge.target)) firstUse.set(edge.target, edge.quantity);
  for (const node of nodes) node.quantity = firstUse.get(node.id) ?? 1;
  return { nodes, edges, rootId: root.id };
}

/** Index of the first node deeper than `depth` (nodes sorted by depth), by binary search. */
function firstDeeper(nodes, depth) {
  let low = 0,
    high = nodes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (nodes[middle].depth > depth) high = middle;
    else low = middle + 1;
  }
  return low;
}
