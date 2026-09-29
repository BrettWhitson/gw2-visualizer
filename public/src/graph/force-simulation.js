/**
 * Force simulation for every layout, in the spirit of Obsidian's graph view: four forces with one slider each.
 *
 *  - center:   pulls nodes toward the middle (keeps the graph compact); in radial layouts, how tightly nodes hold
 *              to their ring (the result itself is pinned in the middle)
 *  - repel:    pushes nodes away from each other (spacing)
 *  - link:     pulls connected nodes together (how tightly ingredients cluster around their product)
 *  - distance: the length links settle at (the gap between levels / rings)
 *
 * Three modes share those forces:
 *  - "free":    everything moves in 2D (the Force-directed engine);
 *  - "layered": each node stays on its level along the flow axis (level n at n × distance); forces act across
 *               the level, and siblings keep their order so edges never cross;
 *  - "radial":  the result is pinned in the centre and each node is pulled toward the ring for its depth
 *               (depth × distance). Crowded rings bulge a little instead of pushing every outer ring away.
 *
 * Deterministic: the same input always gives the same layout (no random starts; ties are broken by index).
 * Runs synchronously for a fixed number of ticks; GraphView animates from the old positions to the result.
 */

/** Slider value → simulation strength. */
const SCALE = { repel: 70, center: 0.06, link: 0.7, radial: 0.9 };
const VELOCITY_DECAY = 0.4;
const BARNES_HUT_THETA = 0.9;

/** Fewer ticks for big graphs: the seed layout is already close, and repel is O(n log n) per tick. */
export function ticksFor(nodeCount) {
  return nodeCount < 300 ? 300 : nodeCount < 1000 ? 180 : 100;
}

/**
 * @param {import('cytoscape').Core} cy  positions are read (as the seed) and written back
 * @param {{ mode: 'free' | 'layered' | 'radial', axis?: 'x' | 'y', center: number, repel: number, link: number,
 *           distance: number, depthById?: Map<string, number>, rootId?: string, ticks?: number,
 *           minGapById?: (id: string) => number }} options
 *   axis: layered only, the flow axis (levels are spread along it)
 *   depthById / rootId: radial only
 *   minGapById: layered only, the space a node needs across its level (for order-preserving collision)
 */
export function simulateForces(cy, options) {
  const nodes = cy.nodes().toArray();
  const count = nodes.length;
  if (count < 2) return;
  const { mode, center, repel, link, distance } = options;
  const ticks = options.ticks ?? ticksFor(count);
  const indexById = new Map(nodes.map((node, i) => [node.id(), i]));
  const x = new Float64Array(count),
    y = new Float64Array(count),
    vx = new Float64Array(count),
    vy = new Float64Array(count);
  nodes.forEach((node, i) => {
    const p = node.position();
    // Tiny deterministic offsets so coincident seeds can separate.
    x[i] = p.x + ((i % 7) - 3) * 0.01;
    y[i] = p.y + ((i % 5) - 2) * 0.01;
  });

  const links = [];
  const degree = new Uint32Array(count);
  cy.edges().forEach((edge) => {
    const s = indexById.get(edge.data("source")),
      t = indexById.get(edge.data("target"));
    if (s == null || t == null || s === t) return;
    links.push([s, t]);
    degree[s]++;
    degree[t]++;
  });

  const layered = mode === "layered" ? setUpLevels() : null;
  const radial = mode === "radial" ? setUpRings() : null;

  let alpha = 1;
  const alphaDecay = 1 - Math.pow(0.001, 1 / ticks);
  for (let tick = 0; tick < ticks; tick++) {
    applyLinks(alpha);
    if (layered) repelWithinLevels(alpha);
    else repelBarnesHut(alpha);
    applyCenter(alpha);
    if (radial) pullToRings(alpha);
    for (let i = 0; i < count; i++) {
      vx[i] *= 1 - VELOCITY_DECAY;
      vy[i] *= 1 - VELOCITY_DECAY;
      x[i] += vx[i];
      y[i] += vy[i];
    }
    if (layered) keepLevelsAndOrder();
    if (radial) {
      x[radial.root] = 0;
      y[radial.root] = 0;
    }
    alpha -= alpha * alphaDecay;
  }

  cy.batch(() =>
    nodes.forEach((node, i) => node.position({ x: x[i], y: y[i] })),
  );

  // ---------------------------------------------------------------- forces

  function applyLinks(alpha) {
    const strength = link * SCALE.link * alpha;
    if (!strength) return;
    for (const [s, t] of links) {
      const bias = degree[s] / (degree[s] + degree[t]); // the busier end moves less
      if (layered) {
        // Only across the level: pull the ingredient under its product.
        const cross = layered.cross;
        const pull = (cross[t] - cross[s]) * strength * 0.5;
        applyCross(t, -pull * bias);
        applyCross(s, pull * (1 - bias));
        continue;
      }
      const dx = x[t] + vx[t] - x[s] - vx[s] || 0.01,
        dy = y[t] + vy[t] - y[s] - vy[s] || 0.01;
      const length = Math.hypot(dx, dy);
      const pull = ((length - distance) / length) * strength * 0.5;
      vx[t] -= dx * pull * bias;
      vy[t] -= dy * pull * bias;
      vx[s] += dx * pull * (1 - bias);
      vy[s] += dy * pull * (1 - bias);
    }
  }

  function applyCenter(alpha) {
    const strength = center * SCALE.center * alpha;
    if (!strength) return;
    if (layered) {
      // Across levels only: compact each level toward the middle.
      for (let i = 0; i < count; i++)
        applyCross(i, -layered.cross[i] * strength);
      return;
    }
    if (radial) return; // the result is pinned; center sets the ring force instead (pullToRings)
    for (let i = 0; i < count; i++) {
      vx[i] -= x[i] * strength;
      vy[i] -= y[i] * strength;
    }
  }

  /** Many-body repulsion in 2D, approximated with a Barnes-Hut quadtree. */
  function repelBarnesHut(alpha) {
    const strength = repel * SCALE.repel * alpha;
    if (!strength) return;
    const tree = buildQuadtree();
    for (let i = 0; i < count; i++) {
      const stack = [tree];
      while (stack.length) {
        const cell = stack.pop();
        if (!cell.mass) continue;
        const dx = cell.cx - x[i],
          dy = cell.cy - y[i];
        const distanceSquared = Math.max(dx * dx + dy * dy, 1);
        const isFar =
          (cell.size * cell.size) / distanceSquared <
          BARNES_HUT_THETA * BARNES_HUT_THETA;
        if (cell.index != null || isFar) {
          if (cell.index === i) continue;
          const push = (strength * cell.mass) / distanceSquared;
          vx[i] -= dx * push;
          vy[i] -= dy * push;
        } else for (const child of cell.children) if (child) stack.push(child);
      }
    }
  }

  function buildQuadtree() {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, x[i]);
      minY = Math.min(minY, y[i]);
      maxX = Math.max(maxX, x[i]);
      maxY = Math.max(maxY, y[i]);
    }
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const root = newCell(minX, minY, size);
    for (let i = 0; i < count; i++) insert(root, i, 0);
    summarize(root);
    return root;
  }

  function newCell(left, top, size) {
    return {
      left,
      top,
      size,
      index: null,
      children: null,
      mass: 0,
      cx: 0,
      cy: 0,
    };
  }

  function insert(cell, i, depth) {
    if (!cell.children && cell.index == null && !cell.mass) {
      cell.index = i;
      cell.mass = 1;
      return;
    }
    if (!cell.children) {
      if (depth > 24) {
        cell.mass++; // coincident points: merge
        return;
      }
      cell.children = [null, null, null, null];
      const previous = cell.index;
      cell.index = null;
      cell.mass = 0;
      if (previous != null) insertChild(cell, previous, depth);
    }
    insertChild(cell, i, depth);
  }

  function insertChild(cell, i, depth) {
    const half = cell.size / 2;
    const right = x[i] >= cell.left + half ? 1 : 0,
      bottom = y[i] >= cell.top + half ? 1 : 0;
    const slot = right + bottom * 2;
    cell.children[slot] ??= newCell(
      cell.left + right * half,
      cell.top + bottom * half,
      half,
    );
    insert(cell.children[slot], i, depth + 1);
  }

  function summarize(cell) {
    if (cell.index != null) {
      cell.cx = x[cell.index];
      cell.cy = y[cell.index];
      return;
    }
    if (!cell.children) return;
    let mass = 0,
      sx = 0,
      sy = 0;
    for (const child of cell.children) {
      if (!child) continue;
      summarize(child);
      mass += child.mass;
      sx += child.cx * child.mass;
      sy += child.cy * child.mass;
    }
    cell.mass = mass;
    cell.cx = mass ? sx / mass : 0;
    cell.cy = mass ? sy / mass : 0;
  }

  // ---------------------------------------------------------------- layered mode

  /**
   * Levels come from the seed layout's positions along the flow axis (ranked), respaced to `distance` apart.
   * `order` keeps each level's seed order across the axis; the simulation never reorders siblings.
   */
  function setUpLevels() {
    const along = options.axis === "x" ? x : y;
    const cross = options.axis === "x" ? y : x;
    const crossVelocity = options.axis === "x" ? vy : vx;
    const alongVelocity = options.axis === "x" ? vx : vy;
    const rootIndex = indexById.get(cy.nodes(".root").id()) ?? 0;
    const rounded = Array.from(along, (value) => Math.round(value));
    const ranks = [...new Set(rounded)].sort((a, b) => a - b);
    const rankOf = new Map(ranks.map((value, rank) => [value, rank]));
    const rootRank = rankOf.get(rounded[rootIndex]);
    const target = new Float64Array(count);
    const levels = new Map();
    for (let i = 0; i < count; i++) {
      const rank = rankOf.get(rounded[i]);
      target[i] = (rank - rootRank) * distance;
      if (!levels.has(rank)) levels.set(rank, []);
      levels.get(rank).push(i);
    }
    for (const level of levels.values())
      level.sort((a, b) => cross[a] - cross[b] || a - b);
    const gap = new Float64Array(count);
    nodes.forEach((node, i) => {
      gap[i] = options.minGapById?.(node.id()) ?? 40;
    });
    return {
      along,
      cross,
      crossVelocity,
      alongVelocity,
      target,
      levels: [...levels.values()],
      gap,
    };
  }

  function applyCross(i, amount) {
    layered.crossVelocity[i] += amount;
  }

  /** Repulsion between near neighbours on the same level (1D, so O(n) per tick). */
  function repelWithinLevels(alpha) {
    const strength = repel * SCALE.repel * alpha;
    if (!strength) return;
    const cross = layered.cross;
    for (const level of layered.levels) {
      for (let a = 0; a < level.length; a++) {
        for (let b = a + 1; b < Math.min(level.length, a + 4); b++) {
          const i = level[a],
            j = level[b];
          const d = Math.max(cross[j] - cross[i], 1);
          const push = strength / (d * d);
          applyCross(i, -push * d * 0.5);
          applyCross(j, push * d * 0.5);
        }
      }
    }
  }

  /**
   * Fix each node on its level, and keep siblings in their seed order at least their footprint apart. Two sweeps
   * (left→right, right→left) each give a valid placement; their average is valid too and doesn't drift sideways.
   */
  function keepLevelsAndOrder() {
    const { along, alongVelocity, cross, target, levels, gap } = layered;
    for (let i = 0; i < count; i++) {
      along[i] = target[i];
      alongVelocity[i] = 0;
    }
    for (const level of levels) {
      const n = level.length;
      if (n < 2) continue;
      const forward = new Float64Array(n),
        backward = new Float64Array(n);
      forward[0] = cross[level[0]];
      for (let k = 1; k < n; k++) {
        const minimum =
          forward[k - 1] + (gap[level[k - 1]] + gap[level[k]]) / 2;
        forward[k] = Math.max(cross[level[k]], minimum);
      }
      backward[n - 1] = cross[level[n - 1]];
      for (let k = n - 2; k >= 0; k--) {
        const maximum =
          backward[k + 1] - (gap[level[k + 1]] + gap[level[k]]) / 2;
        backward[k] = Math.min(cross[level[k]], maximum);
      }
      for (let k = 0; k < n; k++)
        cross[level[k]] = (forward[k] + backward[k]) / 2;
    }
  }

  // ---------------------------------------------------------------- radial mode

  function setUpRings() {
    const root = indexById.get(options.rootId) ?? 0;
    const ring = new Float64Array(count);
    nodes.forEach((node, i) => {
      ring[i] = (options.depthById?.get(node.id()) ?? 0) * distance;
    });
    return { root, ring };
  }

  /** Pull every node toward the ring for its depth: loosely at center 0 (organic), firmly at 1 (crisp rings). */
  function pullToRings(alpha) {
    const strength = SCALE.radial * (0.75 + 1.25 * center) * alpha; // default center 0.2 → ×1
    for (let i = 0; i < count; i++) {
      if (i === radial.root) continue;
      const r = Math.hypot(x[i], y[i]) || 0.01;
      const k = ((radial.ring[i] - r) / r) * strength;
      vx[i] += x[i] * k;
      vy[i] += y[i] * k;
    }
  }
}
