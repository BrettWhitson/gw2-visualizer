/**
 * Measurements for the sandbox's physics probes: how many links apart items are, and how far each group moved.
 * Pure.
 */

/**
 * Links between `fromId` and every item it's connected to, ignoring direction (breadth-first).
 * @param {{ source: string, target: string }[]} edges
 * @returns {Map<string, number>} unconnected items are left out
 */
export function hopDistances(edges, fromId) {
  const neighbours = new Map();
  const add = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, []);
    neighbours.get(a).push(b);
  };
  for (const { source, target } of edges) {
    add(source, target);
    add(target, source);
  }
  const hops = new Map([[fromId, 0]]);
  for (let queue = [fromId], head = 0; head < queue.length;) {
    const id = queue[head++];
    for (const next of neighbours.get(id) ?? [])
      if (!hops.has(next)) {
        hops.set(next, hops.get(id) + 1);
        queue.push(next);
      }
  }
  return hops;
}

/**
 * How far items moved between two snapshots, grouped by links from the probed item.
 * @param {Map<string, { x: number, y: number }>} before
 * @param {Map<string, { x: number, y: number }>} after
 * @param {Map<string, number>} hops  from hopDistances; items missing from it are "unlinked"
 * @param {number} [moveThreshold]  distances above this count as moved
 * @returns {{ hops: number | "unlinked", count: number, moved: number, max: number, mean: number }[]}
 *   by hops, nearest first, unlinked last
 */
export function movementByHops(before, after, hops, moveThreshold = 0.5) {
  const groups = new Map();
  for (const [id, start] of before) {
    const end = after.get(id);
    if (!end) continue;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const key = hops.has(id) ? hops.get(id) : "unlinked";
    let group = groups.get(key);
    if (!group)
      groups.set(
        key,
        (group = { hops: key, count: 0, moved: 0, max: 0, sum: 0 }),
      );
    group.count++;
    group.sum += distance;
    if (distance > moveThreshold) group.moved++;
    group.max = Math.max(group.max, distance);
  }
  return [...groups.values()]
    .sort((a, b) =>
      a.hops === "unlinked" ? 1 : b.hops === "unlinked" ? -1 : a.hops - b.hops,
    )
    .map(({ sum, ...group }) => ({ ...group, mean: sum / group.count }));
}

const HOP_COLORS = [
  "#ffffff",
  "#f0c46a",
  "#f29d4b",
  "#e86bb4",
  "#b98bf0",
  "#62a4da",
  "#5ec8e5",
  "#7ac46b",
];

/** A colour per link distance (the probed item white, then warm to cool); unlinked items grey. */
export function hopColor(hops) {
  if (hops == null) return "#4a5263";
  return HOP_COLORS[Math.min(hops, HOP_COLORS.length - 1)];
}
