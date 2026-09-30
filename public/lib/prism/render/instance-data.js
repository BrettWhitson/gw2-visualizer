import { arrowTemplate, edgeRoute } from "./edge-geometry.js";
import { cachedColor } from "./color.js";

/**
 * The per-instance data the GPU draws from: one run of floats for nodes, one for edge pieces (a polyline segment
 * each) and one per arrowhead shape. Pure: records in, floats out; webgl-graph.js uploads the dirty spans.
 *
 * A full `rebuild` writes everything in draw order and remembers where each record went. While the same things are
 * drawn in the same order, `update` rewrites just the records that changed (a hovered node and its edges) in place,
 * so an animated frame costs what moves, not the size of the graph. When the layout of the data would change (an
 * edge appearing or bending into a different number of pieces) `update` declines and the caller rebuilds.
 *
 * Nodes lifted over the rest (selected, hovered, dragged) keep their slot, hidden there, and are drawn again from
 * `topNodes`, a second small run drawn last: lifting a node rewrites two slots, not the whole order.
 *
 * Node records: { px, py, alpha, scale, glow: { value }, hw, hh, fill, border, aura, ring: [r,g,b,a],
 * glowColor: [r,g,b], style }. Edge records: { source, target, alpha, emphasis: { value }, emphasisState, color,
 * style }. Either may carry a colour fade: `colorMix` ({ value } 0 → 1) from `colorFrom` (the same colour fields) to
 * the current ones. They gain bookkeeping fields (slot, pieceAt, …) from here.
 */

export const NODE_FLOATS = 36;
export const EDGE_FLOATS = 16;
export const ARROW_FLOATS = 9;
export const SHAPES = {
  rectangle: 0,
  "round-rectangle": 1,
  ellipse: 2,
  hexagon: 3,
  octagon: 4,
  "round-diamond": 5,
  diamond: 5,
};
const NODE_PATTERNS = { solid: 0, dashed: 1, dotted: 2, stack: 3 };
const EDGE_PATTERNS = { dashed: 1, dotted: 2 };
const NO_ICON = [0, 0, 0, 0];
const ON_TOP = 0.01; // emphasis above this draws an edge over the others
const HIDDEN = 0.004; // edges fainter than this aren't drawn

/** A growable run of floats: `length` of them used, `data` reused from frame to frame, a dirty span to upload. */
export class FloatList {
  constructor(capacity = 1024) {
    this.data = new Float32Array(capacity);
    this.length = 0;
    this.dirtyFrom = Infinity;
    this.dirtyTo = 0;
  }

  clear() {
    this.length = 0;
    return this;
  }

  /** Room for `count` more floats after `length`; returns the (possibly new) array to write into. */
  reserve(count) {
    const needed = this.length + count;
    if (needed > this.data.length) {
      let capacity = this.data.length * 2;
      while (capacity < needed) capacity *= 2;
      const data = new Float32Array(capacity);
      data.set(this.data.subarray(0, this.length));
      this.data = data;
    }
    return this.data;
  }

  markDirty(from, to) {
    if (from < this.dirtyFrom) this.dirtyFrom = from;
    if (to > this.dirtyTo) this.dirtyTo = to;
  }

  /** The span written since the last call ([from, to) in floats), or null. */
  takeDirty() {
    if (this.dirtyFrom >= this.dirtyTo) return null;
    const span = [this.dirtyFrom, this.dirtyTo];
    this.dirtyFrom = Infinity;
    this.dirtyTo = 0;
    return span;
  }
}

/** Arrowhead size in CSS pixels for an edge of `width`. */
export function arrowSize(width, arrowScale = 1) {
  return (7 + width * 2.2) * arrowScale;
}

const insets = new Map();
function arrowInset(shape) {
  if (!insets.has(shape)) insets.set(shape, arrowTemplate(shape).inset);
  return insets.get(shape);
}

export class InstanceData {
  nodes = new FloatList();
  /** The lifted nodes again, drawn after everything else. */
  topNodes = new FloatList(4 * NODE_FLOATS);
  edges = new FloatList();
  /** Arrowhead shape → its instances. */
  arrows = new Map();
  /** Nodes in draw order, and ordered edges with their nodes' edges, as of the last rebuild. */
  #drawnNodes = [];
  #nodeById = new Map();
  #edgesOf = new Map();
  #top = new Set();
  #layout = null;
  #generation = 0; // edges carry the rebuild they were written in

  /** One edge's values for this frame, reused so a frame allocates nothing per edge. */
  #edge = {
    points: null,
    r: 0,
    g: 0,
    b: 0,
    alpha: 0,
    width: 0,
    pattern: 0,
    flow: 0,
    glow: 0,
    arrowSize: 0,
    trimStart: 0,
    trimEnd: 0,
  };

  /** The instances for `shape`'s arrowheads. */
  arrowList(shape) {
    let list = this.arrows.get(shape);
    if (!list) this.arrows.set(shape, (list = new FloatList(256)));
    return list;
  }

  /**
   * Write everything. `scene`: { ghosts, nodes, edges, top (ids drawn over the rest), layout, iconUv(url) → [u0, v0,
   * u1, v1] | null }. Leaving nodes draw underneath, top ones last; emphasised edges over the others.
   */
  rebuild({ ghosts, nodes, edges, top, layout, iconUv }) {
    this.#layout = layout;
    this.#top = new Set(top);
    const generation = ++this.#generation;

    const ordered = [],
      emphasised = [];
    for (const edge of edges)
      (edge.emphasis.value > ON_TOP ? emphasised : ordered).push(edge);
    ordered.push(...emphasised);
    this.#edgesOf = new Map();
    const pieces = this.edges.clear();
    for (const list of this.arrows.values()) list.clear();
    for (const edge of ordered) {
      for (const end of [edge.source, edge.target]) {
        let list = this.#edgesOf.get(end);
        if (!list) this.#edgesOf.set(end, (list = []));
        list.push(edge);
      }
      edge.generation = generation;
      edge.onTop = edge.emphasis.value > ON_TOP;
      edge.pieceCount = 0;
      edge.startArrowAt = edge.endArrowAt = -1;
      if (!this.#measureEdge(edge)) continue;
      const count = edge.points.length - 1;
      pieces.reserve(count * EDGE_FLOATS);
      edge.pieceAt = pieces.length;
      edge.pieceCount = count;
      this.#writePieces(edge);
      pieces.length += count * EDGE_FLOATS;
      const { arrowAtSource, arrowAtTarget } = edge.style;
      if (arrowAtSource)
        edge.startArrowAt = this.#appendArrow(arrowAtSource, edge, true);
      if (arrowAtTarget)
        edge.endArrowAt = this.#appendArrow(arrowAtTarget, edge, false);
    }
    pieces.markDirty(0, pieces.length);
    for (const list of this.arrows.values()) list.markDirty(0, list.length);

    const drawn = [...ghosts, ...nodes];
    this.#drawnNodes = drawn;
    this.#nodeById = new Map(nodes.map((record) => [record.id, record]));
    const list = this.nodes.clear();
    list.reserve(drawn.length * NODE_FLOATS);
    drawn.forEach((record, index) => {
      record.slot = index;
      writeNode(
        list.data,
        index * NODE_FLOATS,
        record,
        iconUv,
        this.#isLifted(record),
      );
    });
    list.length = drawn.length * NODE_FLOATS;
    list.markDirty(0, list.length);
    this.#writeTop(iconUv);
  }

  /** Lifted: drawn from topNodes instead of its own slot (ghosts never are). */
  #isLifted(record) {
    return !record.ghost && this.#top.has(record.id);
  }

  /** The lifted nodes, in draw order. */
  #writeTop(iconUv) {
    const list = this.topNodes.clear();
    const lifted = [];
    for (const id of this.#top) {
      const record = this.#nodeById.get(id);
      if (record && !record.ghost) lifted.push(record);
    }
    lifted.sort((a, b) => a.slot - b.slot);
    list.reserve(lifted.length * NODE_FLOATS);
    lifted.forEach((record, k) =>
      writeNode(list.data, k * NODE_FLOATS, record, iconUv, false),
    );
    list.length = lifted.length * NODE_FLOATS;
    list.markDirty(0, Math.max(list.length, 1));
  }

  /**
   * Rewrite just `records` (nodes and edges whose springs moved this frame) and the edges of those nodes, in place.
   * Records that are no longer drawn are skipped. Returns false when the change needs a rebuild instead (anything
   * already written is then rewritten by it).
   */
  update(records, { top, layout, iconUv }) {
    if (layout !== this.#layout) return false;
    const nodes = [];
    const edges = new Set();
    let topChanged = false;
    if (!sameSet(top, this.#top)) {
      // Nodes that are lifted now, or were: their own slots show or hide them.
      for (const id of new Set([...this.#top, ...top])) {
        const record = this.#nodeById.get(id);
        if (record && this.#drawnNodes[record.slot] === record)
          nodes.push(record);
      }
      this.#top = new Set(top);
      topChanged = true;
    }
    for (const record of records) {
      if (!record.px) {
        edges.add(record);
        continue;
      }
      if (this.#drawnNodes[record.slot] !== record) continue; // no longer drawn
      nodes.push(record);
      for (const edge of this.#edgesOf.get(record) ?? []) edges.add(edge);
    }
    for (const edge of edges) {
      if (edge.generation !== this.#generation) continue; // no longer drawn
      if (edge.emphasis.value > ON_TOP !== edge.onTop) return false;
      const visible = this.#measureEdge(edge);
      if (visible !== edge.pieceCount > 0) return false;
      if (!visible) continue;
      if (edge.points.length - 1 !== edge.pieceCount) return false;
      this.#writePieces(edge);
      this.edges.markDirty(
        edge.pieceAt,
        edge.pieceAt + edge.pieceCount * EDGE_FLOATS,
      );
      const { arrowAtSource, arrowAtTarget } = edge.style;
      if (edge.startArrowAt >= 0)
        this.#writeArrow(arrowAtSource, edge, true, edge.startArrowAt);
      if (edge.endArrowAt >= 0)
        this.#writeArrow(arrowAtTarget, edge, false, edge.endArrowAt);
    }
    const data = this.nodes.data;
    let liftedMoved = topChanged;
    for (const record of nodes) {
      const at = record.slot * NODE_FLOATS;
      const lifted = this.#isLifted(record);
      writeNode(data, at, record, iconUv, lifted);
      this.nodes.markDirty(at, at + NODE_FLOATS);
      liftedMoved ||= lifted;
    }
    if (liftedMoved) this.#writeTop(iconUv);
    return true;
  }

  /** This frame's values for `edge` into #edge (and its route into edge.points); false if it isn't drawn. */
  #measureEdge(edge) {
    const { source, target, style } = edge;
    const alpha =
      edge.alpha.value *
      Math.min(source.alpha.value, target.alpha.value) *
      (style.alpha ?? 1);
    edge.points = null;
    if (alpha < HIDDEN) return false;
    const points = routeOf(edge, this.#layout);
    edge.points = points;
    if (points.length < 2) return false;
    const emphasis = edge.emphasis.value;
    const state = edge.emphasisState;
    let [r, g, b] = edge.color;
    const mix = colorMixOf(edge);
    if (mix < 1) {
      const [fr, fg, fb] = edge.colorFrom.color;
      r = fr + (r - fr) * mix;
      g = fg + (g - fg) * mix;
      b = fb + (b - fb) * mix;
    }
    let width = style.width;
    // Edges with a standing glow (a best route) keep their colour when a lineage lights them; they still flow.
    if (emphasis > 0 && state && !style.glow) {
      const [er, eg, eb] = cachedColor(state.color);
      r += (er - r) * emphasis;
      g += (eg - g) * emphasis;
      b += (eb - b) * emphasis;
      width += (state.boost ?? 1) * emphasis;
    }
    const flow = emphasis > 0.5 && state?.flow ? state.flow : 0;
    const size = arrowSize(width, style.arrowScale ?? 1);
    const e = this.#edge;
    e.points = points;
    e.r = r;
    e.g = g;
    e.b = b;
    e.alpha = alpha;
    e.width = width;
    e.flow = flow;
    e.pattern = flow ? 0 : (EDGE_PATTERNS[style.pattern] ?? 0);
    e.glow = style.glow ? 1 : emphasis * 0.6;
    e.arrowSize = size;
    e.trimStart = style.arrowAtSource
      ? arrowInset(style.arrowAtSource) * size
      : 0;
    e.trimEnd = style.arrowAtTarget
      ? arrowInset(style.arrowAtTarget) * size
      : 0;
    return true;
  }

  /** The measured edge's pieces at edge.pieceAt. */
  #writePieces(edge) {
    const e = this.#edge;
    const { points } = e;
    const d = this.edges.data;
    const last = points.length - 1;
    let o = edge.pieceAt,
      distance = 0;
    for (let i = 1; i <= last; i++, o += EDGE_FLOATS) {
      const a = points[i - 1],
        c = points[i];
      d[o] = a.x;
      d[o + 1] = a.y;
      d[o + 2] = c.x;
      d[o + 3] = c.y;
      d[o + 4] = e.r;
      d[o + 5] = e.g;
      d[o + 6] = e.b;
      d[o + 7] = e.alpha;
      d[o + 8] = e.width;
      d[o + 9] = distance;
      d[o + 10] = e.pattern;
      d[o + 11] = e.flow;
      d[o + 12] = i === 1 ? e.trimStart : 0;
      d[o + 13] = i === last ? e.trimEnd : 0;
      d[o + 14] = e.glow;
      d[o + 15] = 0;
      distance += Math.hypot(c.x - a.x, c.y - a.y);
    }
  }

  #appendArrow(shape, edge, atSource) {
    const list = this.arrowList(shape);
    list.reserve(ARROW_FLOATS);
    const at = list.length;
    this.#writeArrow(shape, edge, atSource, at);
    list.length += ARROW_FLOATS;
    return at;
  }

  #writeArrow(shape, edge, atSource, at) {
    const e = this.#edge;
    const points = e.points;
    const from = atSource ? points[1] : points.at(-2);
    const tip = atSource ? points[0] : points.at(-1);
    const list = this.arrowList(shape);
    const d = list.data;
    d[at] = tip.x;
    d[at + 1] = tip.y;
    d[at + 2] = tip.x - from.x;
    d[at + 3] = tip.y - from.y;
    d[at + 4] = e.r;
    d[at + 5] = e.g;
    d[at + 6] = e.b;
    d[at + 7] = e.alpha;
    d[at + 8] = e.arrowSize;
    list.markDirty(at, at + ARROW_FLOATS);
  }
}

/** How far a record's colour fade has got: 1 when there's none. */
function colorMixOf(record) {
  const mix = record.colorMix?.value;
  return mix == null ? 1 : Math.min(1, Math.max(0, mix));
}

/** One node's instance. `hidden`: drawn from topNodes instead (lifted), so invisible here. */
function writeNode(d, at, record, iconUv, hidden = false) {
  const style = record.style;
  let o = at;
  const put = (values) => {
    for (let i = 0; i < values.length; i++) d[o++] = values[i];
  };
  const mix = colorMixOf(record);
  const from = record.colorFrom;
  const putColor = (key) => {
    if (mix >= 1 || !from) return put(record[key]);
    const to = record[key],
      start = from[key];
    for (let i = 0; i < to.length; i++)
      d[o++] = start[i] + (to[i] - start[i]) * mix;
  };
  d[o++] = record.px.value;
  d[o++] = record.py.value;
  d[o++] = record.hw;
  d[o++] = record.hh;
  putColor("fill");
  putColor("border");
  putColor("aura");
  put(record.glowColor);
  d[o++] = Math.min(1, Math.max(0, record.glow.value));
  putColor("ring");
  put((style.icon && iconUv(style.icon)) || NO_ICON);
  d[o++] = style.borderWidth ?? 3;
  d[o++] = SHAPES[style.shape] ?? 1;
  d[o++] = NODE_PATTERNS[style.pattern] ?? 0;
  d[o++] = style.badge ? 1 : 0;
  d[o++] = hidden ? 0 : Math.max(0, Math.min(1, record.alpha.value));
  d[o++] = Math.max(0.05, record.scale.value);
  d[o++] = style.iconAlpha ?? 1;
  d[o++] = 0;
}

/**
 * An edge's route between its nodes' current boxes, cached on the edge until either box or the layout changes, so
 * a frame only re-routes the edges that touch something moving.
 */
function routeOf(edge, layout) {
  const { source, target } = edge;
  const sx = source.px.value,
    sy = source.py.value,
    shw = source.hw * source.scale.value,
    shh = source.hh * source.scale.value,
    tx = target.px.value,
    ty = target.py.value,
    thw = target.hw * target.scale.value,
    thh = target.hh * target.scale.value;
  const key = edge.routeKey;
  if (
    key &&
    key[0] === layout &&
    key[1] === sx &&
    key[2] === sy &&
    key[3] === shw &&
    key[4] === shh &&
    key[5] === tx &&
    key[6] === ty &&
    key[7] === thw &&
    key[8] === thh
  )
    return edge.route;
  edge.routeKey = [layout, sx, sy, shw, shh, tx, ty, thw, thh];
  edge.route = edgeRoute(
    { x: sx, y: sy, hw: shw, hh: shh },
    { x: tx, y: ty, hw: thw, hh: thh },
    layout,
  );
  return edge.route;
}

/** Whether `ids` (repeats allowed: the selected node can also be the hovered one) are exactly `set`. */
function sameSet(ids, set) {
  const distinct = new Set(ids);
  if (distinct.size !== set.size) return false;
  for (const id of distinct) if (!set.has(id)) return false;
  return true;
}
