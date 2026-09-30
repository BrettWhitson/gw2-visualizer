/**
 * The graph's physics: a force simulation behind every layout, in the spirit of Obsidian's graph view. Four forces,
 * one slider each, all acting in every direction:
 *
 *  - center:   pulls nodes toward the middle (keeps the graph compact)
 *  - repel:    pushes nodes away from each other (Barnes-Hut, O(n log n))
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
 * else reacts (neighbours follow, others make room), then it cools down and settles.
 * Deterministic: the same input gives the same layout (no random starts; ties are broken by index).
 * Works on plain arrays (see layout-graph.js) and allocates nothing per tick beyond its first.
 */

/** Slider value → simulation strength. */
const SCALE = { repel: 70, center: 0.03, link: 0.9, structure: 1.1 };
const VELOCITY_DECAY = 0.4;
const BARNES_HUT_THETA = 0.9;
const ALPHA_MIN = 0.001;
/** Minimum clear space between the footprints on neighbouring levels. */
const LEVEL_GAP = 24;
const MAX_TREE_DEPTH = 24;

/** Ticks to settle a fresh layout: fewer for big graphs (repel is O(n log n) per tick). */
export function ticksFor(nodeCount) {
  return nodeCount < 300 ? 300 : nodeCount < 1000 ? 200 : 120;
}

export class ForceSimulation {
  alpha = 1;
  alphaTarget = 0;

  /**
   * @param {import('./layout-graph.js').LayoutGraph} graph  current positions are the starting point; ghosts sit out
   * @param {{ mode: 'free' | 'layered' | 'radial', axis?: 'x' | 'y', center: number, repel: number, link: number,
   *           distance: number, depthById?: Map<string, number>, rootId?: string,
   *           sizeOf?: (graphIndex: number) => { w: number, h: number } }} options
   *   axis: layered only, the flow axis levels are spread along
   *   depthById / rootId: radial rings
   *   sizeOf: collision box per node, including its label (default: the node box)
   */
  constructor(graph, options) {
    this.options = options;
    /** Graph index of each simulated node. */
    this.members = [];
    for (let i = 0; i < graph.count; i++)
      if (!graph.ghost[i]) this.members.push(i);
    const count = (this.count = this.members.length);
    this.ids = this.members.map((i) => graph.ids[i]);
    this.indexById = new Map(this.ids.map((id, i) => [id, i]));
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    /** Fixed (dragged / pinned) positions, NaN when free. */
    this.fx = new Float64Array(count).fill(NaN);
    this.fy = new Float64Array(count).fill(NaN);
    this.halfW = new Float64Array(count);
    this.halfH = new Float64Array(count);
    this.members.forEach((g, i) => {
      // Tiny deterministic offsets so coincident seeds can separate.
      this.x[i] = graph.x[g] + ((i % 7) - 3) * 0.01;
      this.y[i] = graph.y[g] + ((i % 5) - 2) * 0.01;
      const size = options.sizeOf?.(g) ?? { w: graph.w[g], h: graph.h[g] };
      this.halfW[i] = size.w / 2;
      this.halfH[i] = size.h / 2;
    });

    const local = new Int32Array(graph.count).fill(-1);
    this.members.forEach((g, i) => (local[g] = i));
    const sources = [],
      targets = [];
    this.degree = new Uint32Array(count);
    for (let e = 0; e < graph.sources.length; e++) {
      const s = local[graph.sources[e]],
        t = local[graph.targets[e]];
      if (s < 0 || t < 0 || s === t) continue;
      sources.push(s);
      targets.push(t);
      this.degree[s]++;
      this.degree[t]++;
    }
    this.linkSources = Int32Array.from(sources);
    this.linkTargets = Int32Array.from(targets);

    const rootId = options.rootId ?? graph.rootId;
    this.root = this.indexById.get(rootId) ?? null;
    this.structureTarget = new Float64Array(count); // level coordinate or ring radius
    if (options.mode === "radial") {
      this.ids.forEach((id, i) => {
        this.structureTarget[i] =
          (options.depthById?.get(id) ?? 0) * options.distance;
      });
      if (this.root != null) {
        this.fx[this.root] = 0;
        this.fy[this.root] = 0;
      }
    } else if (options.mode === "layered") {
      this.#setUpLevels();
    }
    // Each link's resting length: the link distance, or in layered layouts at least the gap between its ends'
    // levels. A link across three levels can't be one link distance long; pulling it that hard only drags its ends
    // sideways across everything in between (merged graphs, where shared ingredients link to several levels).
    this.restLength = new Float64Array(this.linkSources.length).fill(
      options.distance,
    );
    if (options.mode === "layered")
      for (let e = 0; e < this.linkSources.length; e++)
        this.restLength[e] = Math.max(
          options.distance,
          Math.abs(
            this.structureTarget[this.linkTargets[e]] -
              this.structureTarget[this.linkSources[e]],
          ),
        );

    this.#tree = new Quadtree(count);
    this.#grid = new CollisionGrid(count);
  }

  #tree;
  #grid;

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

  /** Start again from these positions (id → { x, y }; nodes moved by hand since), at rest. */
  setPositions(positionOf) {
    this.ids.forEach((id, i) => {
      const p = positionOf(id);
      if (!p) return;
      this.x[i] = p.x;
      this.y[i] = p.y;
      this.vx[i] = this.vy[i] = 0;
    });
  }

  /** Copy positions into the graph's arrays (the simulated nodes only). */
  writeTo(graph) {
    this.ids.forEach((id, i) => {
      const g = graph.indexById.get(id);
      if (g == null) return;
      graph.x[g] = this.x[i];
      graph.y[g] = this.y[i];
    });
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

  /**
   * Collision passes on their own, until nothing overlaps (or the budget runs out). One pass per tick can leave a
   * dense stack overlapping: each push can create a new overlap further along.
   */
  resolveOverlaps(maxPasses = 50) {
    if (this.options.mode !== "layered") return; // free and radial: per-tick collision, rings kept exact
    for (let pass = 0; pass < maxPasses; pass++) if (!this.#collide()) break;
    this.#separateLevels();
  }

  // ---------------------------------------------------------------- forces

  /** Springs toward the link distance; the busier end of a link moves less. */
  #links(strength) {
    if (!strength) return;
    const { x, y, vx, vy, degree, linkSources, linkTargets, restLength } = this;
    for (let e = 0; e < linkSources.length; e++) {
      const distance = restLength[e];
      const s = linkSources[e],
        t = linkTargets[e];
      const dx = x[t] + vx[t] - x[s] - vx[s] || 0.01,
        dy = y[t] + vy[t] - y[s] - vy[s] || 0.01;
      const length = Math.sqrt(dx * dx + dy * dy);
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
    if (mode === "layered") {
      const along = this.options.axis === "x" ? x : y;
      const velocity = this.options.axis === "x" ? vx : vy;
      for (let i = 0; i < this.count; i++)
        velocity[i] += (target[i] - along[i]) * strength;
      return;
    }
    for (let i = 0; i < this.count; i++) {
      if (i === this.root) continue;
      const r = Math.sqrt(x[i] * x[i] + y[i] * y[i]) || 0.01;
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
    const tree = this.#tree;
    tree.build(x, y, this.count);
    const { mass, cx, cy, size, index, child } = tree;
    const theta2 = BARNES_HUT_THETA * BARNES_HUT_THETA;
    const stack = tree.stack;
    for (let i = 0; i < this.count; i++) {
      let top = 0;
      stack[top++] = 0;
      while (top) {
        const cell = stack[--top];
        if (!mass[cell]) continue;
        const dx = cx[cell] - x[i],
          dy = cy[cell] - y[i];
        const distanceSquared = Math.max(dx * dx + dy * dy, 1);
        const leaf = !tree.internal[cell];
        if (leaf || (size[cell] * size[cell]) / distanceSquared < theta2) {
          if (index[cell] === i) continue;
          const push = (strength * mass[cell]) / distanceSquared;
          vx[i] -= dx * push;
          vy[i] -= dy * push;
        } else
          for (let q = 0; q < 4; q++) {
            const c = child[cell * 4 + q];
            if (c) stack[top++] = c;
          }
      }
    }
  }

  /**
   * Keep node boxes (with labels) apart: overlapping pairs are pushed apart along the axis where they overlap least.
   * In layered layouts, nodes on the same level are pushed only across the flow: along it, the level pull would undo
   * the push next tick, and dense stacks of siblings never separated. A uniform grid finds the neighbours in O(n).
   * Returns whether any pair that can move overlapped.
   */
  #collide() {
    const { x, y, halfW, halfH, fx, structureTarget } = this;
    const layeredAxis =
      this.options.mode === "layered" ? this.options.axis : null;
    let overlapped = false;
    let cellSize = 1;
    for (let i = 0; i < this.count; i++)
      cellSize = Math.max(cellSize, halfW[i] * 2, halfH[i] * 2);
    const grid = this.#grid;
    grid.build(x, y, this.count, cellSize);
    const { next } = grid;
    for (let i = 0; i < this.count; i++) {
      const gx = Math.floor(x[i] / cellSize),
        gy = Math.floor(y[i] / cellSize);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          for (let j = grid.first(gx + ox, gy + oy); j >= 0; j = next[j]) {
            if (j <= i) continue;
            const overlapX = halfW[i] + halfW[j] - Math.abs(x[j] - x[i]),
              overlapY = halfH[i] + halfH[j] - Math.abs(y[j] - y[i]);
            if (overlapX <= 0 || overlapY <= 0) continue;
            const iFixed = !Number.isNaN(fx[i]),
              jFixed = !Number.isNaN(fx[j]);
            if (iFixed && jFixed) continue;
            overlapped = true;
            const share = iFixed ? 0 : jFixed ? 1 : 0.5; // how much of the push i takes
            const pushAlongX =
              layeredAxis && structureTarget[i] === structureTarget[j]
                ? layeredAxis === "y" // same level, flow along y → spread along x
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
}

/**
 * Build, settle and write back a layout in one go. Returns the simulation (kept for live dragging), or null for
 * fewer than two nodes.
 * @param {import('./layout-graph.js').LayoutGraph} graph
 */
export function simulateForces(graph, options) {
  const simulation = new ForceSimulation(graph, options);
  if (simulation.count < 2) return null;
  simulation.run(options.ticks);
  simulation.resolveOverlaps();
  simulation.writeTo(graph);
  simulation.alpha = 0; // settled
  return simulation;
}

// ---------------------------------------------------------------- Barnes-Hut quadtree

/**
 * A quadtree over points in flat typed arrays, rebuilt every tick without allocating. Cell 0 is the root; a cell is
 * a leaf holding one point (index ≥ 0), an internal cell with up to four children, or empty. Coincident points past
 * MAX_TREE_DEPTH merge into one leaf's mass.
 */
export class Quadtree {
  constructor(points) {
    this.#grow(Math.max(16, points * 4 + 8));
  }

  #grow(capacity) {
    const copy = (Type, old, factor = 1) => {
      const array = new Type(capacity * factor);
      if (old) array.set(old);
      return array;
    };
    this.left = copy(Float64Array, this.left);
    this.top = copy(Float64Array, this.top);
    this.size = copy(Float64Array, this.size);
    this.mass = copy(Float64Array, this.mass);
    this.cx = copy(Float64Array, this.cx);
    this.cy = copy(Float64Array, this.cy);
    this.index = copy(Int32Array, this.index);
    this.internal = copy(Uint8Array, this.internal);
    this.child = copy(Int32Array, this.child, 4); // 0: no child (cell 0 is the root, never a child)
    this.stack = new Int32Array(capacity);
    this.capacity = capacity;
  }

  #newCell(left, top, size) {
    if (this.cells === this.capacity) this.#grow(this.capacity * 2);
    const cell = this.cells++;
    this.left[cell] = left;
    this.top[cell] = top;
    this.size[cell] = size;
    this.mass[cell] = 0;
    this.cx[cell] = this.cy[cell] = 0;
    this.index[cell] = -1;
    this.internal[cell] = 0;
    this.child.fill(0, cell * 4, cell * 4 + 4);
    return cell;
  }

  build(x, y, count) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      if (x[i] < minX) minX = x[i];
      if (y[i] < minY) minY = y[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] > maxY) maxY = y[i];
    }
    this.cells = 0;
    this.#newCell(minX, minY, Math.max(maxX - minX, maxY - minY, 1));
    for (let i = 0; i < count; i++) this.#insert(i, x, y);
    this.#summarise(x, y);
  }

  #insert(i, x, y) {
    let cell = 0;
    for (let depth = 0; ; depth++) {
      if (!this.internal[cell]) {
        if (this.index[cell] < 0) {
          this.index[cell] = i; // an empty leaf
          this.mass[cell] = 1;
          return;
        }
        if (depth > MAX_TREE_DEPTH) {
          this.mass[cell]++; // coincident points: merge
          return;
        }
        // Split the leaf: its point moves one level down, into a fresh (empty) child.
        const previous = this.index[cell];
        this.index[cell] = -1;
        this.mass[cell] = 0;
        this.internal[cell] = 1;
        const child = this.#childFor(cell, previous, x, y);
        this.index[child] = previous;
        this.mass[child] = 1;
      }
      cell = this.#childFor(cell, i, x, y);
    }
  }

  /** The child of `cell` that point i falls in, created if needed. */
  #childFor(cell, i, x, y) {
    const half = this.size[cell] / 2;
    const right = x[i] >= this.left[cell] + half ? 1 : 0,
      bottom = y[i] >= this.top[cell] + half ? 1 : 0;
    const slot = cell * 4 + right + bottom * 2;
    if (!this.child[slot]) {
      // Create first: growing replaces the arrays, so `this.child` must be read after.
      const created = this.#newCell(
        this.left[cell] + right * half,
        this.top[cell] + bottom * half,
        half,
      );
      this.child[slot] = created;
    }
    return this.child[slot];
  }

  /** Centres of mass, children before parents (cells are created after their parents, so walk backwards). */
  #summarise(x, y) {
    const { mass, cx, cy, index, child, internal } = this;
    for (let cell = this.cells - 1; cell >= 0; cell--) {
      if (!internal[cell]) {
        if (index[cell] >= 0) {
          cx[cell] = x[index[cell]];
          cy[cell] = y[index[cell]];
        }
        continue;
      }
      let total = 0,
        sx = 0,
        sy = 0;
      for (let q = 0; q < 4; q++) {
        const c = child[cell * 4 + q];
        if (!c) continue;
        total += mass[c];
        sx += cx[c] * mass[c];
        sy += cy[c] * mass[c];
      }
      mass[cell] = total;
      cx[cell] = total ? sx / total : 0;
      cy[cell] = total ? sy / total : 0;
    }
  }
}

// ---------------------------------------------------------------- collision grid

/** A uniform grid of linked lists over points, rebuilt every tick: `first(gx, gy)` then follow `next`. */
class CollisionGrid {
  constructor(points) {
    this.next = new Int32Array(Math.max(1, points));
    this.heads = new Map();
  }

  build(x, y, count, cellSize) {
    this.heads.clear();
    for (let i = count - 1; i >= 0; i--) {
      const key = cellKey(
        Math.floor(x[i] / cellSize),
        Math.floor(y[i] / cellSize),
      );
      const head = this.heads.get(key);
      this.next[i] = head ?? -1;
      this.heads.set(key, i);
    }
  }

  first(gx, gy) {
    return this.heads.get(cellKey(gx, gy)) ?? -1;
  }
}

function cellKey(gx, gy) {
  // Exact for |gx|, |gy| < 2^25: plenty for any graph that fits on screen.
  return (gx + 33554432) * 67108864 + (gy + 33554432);
}
