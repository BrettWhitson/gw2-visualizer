/**
 * Force simulation behind every layout, in the spirit of Obsidian's graph view. Four forces, one slider each, all
 * acting in every direction:
 *
 *  - center:   pulls nodes toward the middle (keeps the graph compact)
 *  - repel:    pushes nodes away from each other
 *  - link:     how strongly links pull their ends toward the link distance (0 = links don't pull at all)
 *  - distance: the length links settle at
 *
 * Plus a structure force for the layout, and collision so nodes (and their labels) don't overlap:
 *  - "free":    no structure (the Force-directed engine);
 *  - "layered": each node is pulled toward the line for its level, `distance` apart along the flow axis;
 *  - "radial":  the result is pinned in the centre; each node is pulled toward the ring for its depth.
 * Center also sets how firmly nodes hold their level or ring (0 loose, 1 crisp).
 *
 * The simulation keeps running while a node is dragged: the dragged node is held under the pointer and everything
 * else reacts (neighbours follow, others make room), then it cools down and settles, as in Obsidian.
 * Deterministic: the same input gives the same layout (no random starts; ties are broken by index).
 */

/** Slider value → simulation strength. */
const SCALE = { repel: 70, center: 0.03, link: 0.9, structure: 1.1 };
const VELOCITY_DECAY = 0.4;
const BARNES_HUT_THETA = 0.9;
const ALPHA_MIN = 0.001;
/** Minimum clear space between the footprints on neighbouring levels. */
const LEVEL_GAP = 24;

/** Ticks to settle a fresh layout: fewer for big graphs (repel is O(n log n) per tick). */
export function ticksFor(nodeCount) {
  return nodeCount < 300 ? 300 : nodeCount < 1000 ? 200 : 120;
}

export class ForceSimulation {
  alpha = 1;
  alphaTarget = 0;

  /**
   * @param {import('cytoscape').Core} cy  current positions are the starting point
   * @param {{ mode: 'free' | 'layered' | 'radial', axis?: 'x' | 'y', center: number, repel: number, link: number,
   *           distance: number, depthById?: Map<string, number>, rootId?: string,
   *           sizeById?: (id: string) => { w: number, h: number } }} options
   *   axis: layered only, the flow axis levels are spread along
   *   depthById / rootId: radial rings
   *   sizeById: collision box per node, including its label (default: the node box)
   */
  constructor(cy, options) {
    this.cy = cy;
    this.options = options;
    this.nodes = cy.nodes().not(".ghost").toArray();
    const count = (this.count = this.nodes.length);
    this.indexById = new Map(this.nodes.map((node, i) => [node.id(), i]));
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    /** Fixed (dragged / pinned) positions, NaN when free. */
    this.fx = new Float64Array(count).fill(NaN);
    this.fy = new Float64Array(count).fill(NaN);
    this.halfW = new Float64Array(count);
    this.halfH = new Float64Array(count);
    this.nodes.forEach((node, i) => {
      const p = node.position();
      // Tiny deterministic offsets so coincident seeds can separate.
      this.x[i] = p.x + ((i % 7) - 3) * 0.01;
      this.y[i] = p.y + ((i % 5) - 2) * 0.01;
      const size =
        options.sizeById?.(node.id()) ??
        node.layoutDimensions({ nodeDimensionsIncludeLabels: false });
      this.halfW[i] = size.w / 2;
      this.halfH[i] = size.h / 2;
    });

    this.links = [];
    this.degree = new Uint32Array(count);
    cy.edges().forEach((edge) => {
      const s = this.indexById.get(edge.data("source")),
        t = this.indexById.get(edge.data("target"));
      if (s == null || t == null || s === t) return;
      this.links.push([s, t]);
      this.degree[s]++;
      this.degree[t]++;
    });

    this.root = this.indexById.get(options.rootId ?? cy.nodes(".root").id());
    this.structureTarget = new Float64Array(count); // level coordinate or ring radius
    if (options.mode === "radial") {
      this.nodes.forEach((node, i) => {
        this.structureTarget[i] =
          (options.depthById?.get(node.id()) ?? 0) * options.distance;
      });
      if (this.root != null) {
        this.fx[this.root] = 0;
        this.fy[this.root] = 0;
      }
    } else if (options.mode === "layered") {
      this.#setUpLevels();
    }
  }

  /** Settle synchronously (a fresh layout). */
  run(ticks = ticksFor(this.count)) {
    const decay = 1 - Math.pow(ALPHA_MIN, 1 / ticks);
    for (let i = 0; i < ticks; i++) this.tick(decay);
    return this;
  }

  /** Still moving? (the live, animated mode stops when this turns false) */
  get isActive() {
    return this.alpha > ALPHA_MIN * 5 || this.alphaTarget > 0;
  }

  /** Warm up again (a node was grabbed) and stay warm while `alphaTarget` > 0. */
  reheat(alphaTarget = 0.3) {
    this.alphaTarget = alphaTarget;
    this.alpha = Math.max(this.alpha, alphaTarget);
  }

  /** Hold a node at a position (while dragged). */
  fix(id, position) {
    const i = this.indexById.get(id);
    if (i == null) return;
    this.fx[i] = position.x;
    this.fy[i] = position.y;
  }

  /** Let a dragged node move freely again (the pinned radial root stays pinned). */
  release(id) {
    const i = this.indexById.get(id);
    if (i == null || (this.options.mode === "radial" && i === this.root))
      return;
    this.fx[i] = NaN;
    this.fy[i] = NaN;
  }

  /** Re-read positions from Cytoscape (nodes may have been moved by hand since the simulation ran). */
  syncFromGraph() {
    this.nodes.forEach((node, i) => {
      if (node.removed()) return;
      const p = node.position();
      this.x[i] = p.x;
      this.y[i] = p.y;
      this.vx[i] = this.vy[i] = 0;
    });
  }

  /** Write positions back to Cytoscape, optionally skipping one node (the one under the pointer). */
  apply(skipId = null) {
    this.cy.batch(() =>
      this.nodes.forEach((node, i) => {
        if (node.id() !== skipId && !node.removed())
          node.position({ x: this.x[i], y: this.y[i] });
      }),
    );
  }

  /** One step. `decay` sets how fast alpha moves toward alphaTarget (≈300 ticks to settle by default). */
  tick(decay = 0.0228) {
    const { center, repel, link } = this.options;
    const alpha = this.alpha;
    this.#links(link * SCALE.link * alpha);
    this.#repel(repel * SCALE.repel * alpha);
    if (this.options.mode !== "radial")
      this.#center(center * SCALE.center * alpha);
    this.#structure(alpha);
    const { x, y, vx, vy, fx, fy } = this;
    for (let i = 0; i < this.count; i++) {
      if (!Number.isNaN(fx[i])) {
        x[i] = fx[i];
        y[i] = fy[i];
        vx[i] = vy[i] = 0;
        continue;
      }
      vx[i] *= 1 - VELOCITY_DECAY;
      vy[i] *= 1 - VELOCITY_DECAY;
      x[i] += vx[i];
      y[i] += vy[i];
    }
    this.#collide();
    this.alpha += (this.alphaTarget - this.alpha) * decay;
  }

  // ---------------------------------------------------------------- forces

  /** Springs toward the link distance; the busier end of a link moves less. */
  #links(strength) {
    if (!strength) return;
    const { x, y, vx, vy, degree } = this;
    const distance = this.options.distance;
    for (const [s, t] of this.links) {
      const dx = x[t] + vx[t] - x[s] - vx[s] || 0.01,
        dy = y[t] + vy[t] - y[s] - vy[s] || 0.01;
      const length = Math.hypot(dx, dy);
      const pull = ((length - distance) / length) * strength * 0.5;
      const bias = degree[s] / (degree[s] + degree[t]);
      vx[t] -= dx * pull * bias;
      vy[t] -= dy * pull * bias;
      vx[s] += dx * pull * (1 - bias);
      vy[s] += dy * pull * (1 - bias);
    }
  }

  #center(strength) {
    if (!strength) return;
    for (let i = 0; i < this.count; i++) {
      this.vx[i] -= this.x[i] * strength;
      this.vy[i] -= this.y[i] * strength;
    }
  }

  /** Levels (layered) or rings (radial). Center sets how firmly nodes hold them. */
  #structure(alpha) {
    const mode = this.options.mode;
    if (mode === "free") return;
    const strength =
      SCALE.structure * (0.15 + 4.25 * this.options.center) * alpha; // 0 loose, default 0.2 → ×1, 1 crisp
    const { x, y, vx, vy, structureTarget: target } = this;
    for (let i = 0; i < this.count; i++) {
      if (mode === "layered") {
        if (this.options.axis === "x") vx[i] += (target[i] - x[i]) * strength;
        else vy[i] += (target[i] - y[i]) * strength;
        continue;
      }
      if (i === this.root) continue;
      const r = Math.hypot(x[i], y[i]) || 0.01;
      const k = ((target[i] - r) / r) * strength;
      vx[i] += x[i] * k;
      vy[i] += y[i] * k;
    }
  }

  /**
   * Levels come from the seed layout's positions along the flow axis (ranked), relative to the result's level. They
   * are `distance` apart, or further when the nodes and labels on two neighbouring levels need more room along the
   * flow (labels beside nodes in left-right layouts): otherwise neighbouring levels collide and can only make room by
   * stacking everything into one tall column.
   */
  #setUpLevels() {
    const horizontal = this.options.axis === "x";
    const along = horizontal ? this.x : this.y;
    const half = horizontal ? this.halfW : this.halfH;
    const rounded = Array.from(along, (value) => Math.round(value));
    const ranks = [...new Set(rounded)].sort((a, b) => a - b);
    const rankOf = new Map(ranks.map((value, rank) => [value, rank]));
    const extent = new Float64Array(ranks.length); // widest half-footprint on each level
    for (let i = 0; i < this.count; i++) {
      const rank = rankOf.get(rounded[i]);
      extent[rank] = Math.max(extent[rank], half[i]);
    }
    const levelAt = new Float64Array(ranks.length);
    for (let rank = 1; rank < ranks.length; rank++)
      levelAt[rank] =
        levelAt[rank - 1] +
        Math.max(
          this.options.distance,
          extent[rank - 1] + extent[rank] + LEVEL_GAP,
        );
    const rootLevel = levelAt[rankOf.get(rounded[this.root ?? 0])];
    for (let i = 0; i < this.count; i++) {
      this.structureTarget[i] = levelAt[rankOf.get(rounded[i])] - rootLevel;
      along[i] = this.structureTarget[i]; // start on the level
    }
  }

  /**
   * Layered only: on each level, push nodes apart across the flow, in their current order, until none overlap;
   * then shift the level back so it stays centred where it was. Exact where collision passes converge slowly (a
   * column of a hundred siblings).
   */
  #separateLevels() {
    const horizontal = this.options.axis === "x";
    const across = horizontal ? this.y : this.x;
    const half = horizontal ? this.halfH : this.halfW;
    const levels = new Map();
    for (let i = 0; i < this.count; i++) {
      const level = this.structureTarget[i];
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push(i);
    }
    for (const members of levels.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => across[a] - across[b] || a - b);
      const before =
        members.reduce((sum, i) => sum + across[i], 0) / members.length;
      for (let k = 1; k < members.length; k++) {
        const previous = members[k - 1],
          current = members[k];
        const minimum = across[previous] + half[previous] + half[current];
        if (across[current] < minimum) across[current] = minimum;
      }
      const shift =
        before -
        members.reduce((sum, i) => sum + across[i], 0) / members.length;
      for (const i of members) across[i] += shift;
    }
  }

  /** Many-body repulsion, approximated with a Barnes-Hut quadtree. */
  #repel(strength) {
    if (!strength) return;
    const { x, y, vx, vy } = this;
    const tree = buildQuadtree(x, y, this.count);
    for (let i = 0; i < this.count; i++) {
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

  /**
   * Keep node boxes (with labels) apart: overlapping pairs are pushed apart along the axis where they overlap least.
   * Layered layouts push only across the flow: along it, the level pull would undo the push next tick, and dense
   * stacks of siblings never separated. A uniform grid finds the neighbours in O(n). Returns whether any overlapped.
   */
  #collide() {
    const { x, y, halfW, halfH, fx } = this;
    const layeredAxis =
      this.options.mode === "layered" ? this.options.axis : null;
    let overlapped = false;
    let cell = 1;
    for (let i = 0; i < this.count; i++)
      cell = Math.max(cell, halfW[i] * 2, halfH[i] * 2);
    const grid = new Map();
    const key = (gx, gy) => `${gx},${gy}`;
    for (let i = 0; i < this.count; i++) {
      const k = key(Math.floor(x[i] / cell), Math.floor(y[i] / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    for (let i = 0; i < this.count; i++) {
      const gx = Math.floor(x[i] / cell),
        gy = Math.floor(y[i] / cell);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          for (const j of grid.get(key(gx + ox, gy + oy)) ?? []) {
            if (j <= i) continue;
            const overlapX = halfW[i] + halfW[j] - Math.abs(x[j] - x[i]),
              overlapY = halfH[i] + halfH[j] - Math.abs(y[j] - y[i]);
            if (overlapX <= 0 || overlapY <= 0) continue;
            overlapped = true;
            const iFixed = !Number.isNaN(fx[i]),
              jFixed = !Number.isNaN(fx[j]);
            if (iFixed && jFixed) continue;
            const share = iFixed ? 0 : jFixed ? 1 : 0.5; // how much of the push i takes
            const pushAlongX = layeredAxis
              ? layeredAxis === "y" // flow along y → spread along x
              : overlapX < overlapY;
            if (pushAlongX) {
              const sign = x[j] > x[i] || (x[j] === x[i] && j > i) ? 1 : -1;
              x[i] -= sign * overlapX * share;
              x[j] += sign * overlapX * (1 - share);
            } else {
              const sign = y[j] > y[i] || (y[j] === y[i] && j > i) ? 1 : -1;
              y[i] -= sign * overlapY * share;
              y[j] += sign * overlapY * (1 - share);
            }
          }
        }
    }
    return overlapped;
  }

  /**
   * Collision passes on their own, until nothing overlaps (or the budget runs out). One pass per tick can leave a
   * dense stack overlapping: each push can create a new overlap further along.
   */
  resolveOverlaps(maxPasses = 50) {
    for (let pass = 0; pass < maxPasses; pass++) if (!this.#collide()) break;
    if (this.options.mode === "layered") this.#separateLevels();
  }
}

/** Build, settle and apply a layout in one go. Returns the simulation (kept for live dragging). */
export function simulateForces(cy, options) {
  if (cy.nodes().length < 2) return null;
  const simulation = new ForceSimulation(cy, options);
  simulation.run(options.ticks);
  simulation.resolveOverlaps();
  simulation.apply();
  simulation.alpha = 0; // settled
  return simulation;
}

// ---------------------------------------------------------------- Barnes-Hut quadtree

function buildQuadtree(x, y, count) {
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
  const root = newCell(minX, minY, Math.max(maxX - minX, maxY - minY, 1));
  for (let i = 0; i < count; i++) insert(root, i, 0);
  summarize(root);
  return root;

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
