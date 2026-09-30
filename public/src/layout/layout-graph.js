/**
 * The graph as the layouts and the physics see it: plain arrays, no renderer. Each node has its own box (w × h) and
 * its footprint with the label (fullW × fullH, the box they make together); edges run product → ingredient.
 * Positions live in `x` / `y` (centres) and are what every layout reads and writes.
 *
 *   const graph = new LayoutGraph(
 *     [{ id: "result", w: 58, h: 58, fullW: 200, fullH: 58, root: true }, { id: "ore", w: 48, h: 48 }],
 *     [{ source: "result", target: "ore" }],
 *   );
 */
export class LayoutGraph {
  /**
   * @param {{ id: string, w: number, h: number, fullW?: number, fullH?: number, x?: number, y?: number,
   *           root?: boolean, ghost?: boolean }[]} nodes  ghosts are leaving: laid out, but not simulated
   * @param {{ source: string, target: string }[]} edges
   */
  constructor(nodes, edges) {
    const count = (this.count = nodes.length);
    this.ids = nodes.map((node) => node.id);
    this.indexById = new Map(this.ids.map((id, i) => [id, i]));
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.w = new Float64Array(count);
    this.h = new Float64Array(count);
    this.fullW = new Float64Array(count);
    this.fullH = new Float64Array(count);
    this.ghost = new Uint8Array(count);
    this.rootIndex = -1;
    nodes.forEach((node, i) => {
      this.x[i] = node.x ?? 0;
      this.y[i] = node.y ?? 0;
      this.w[i] = node.w;
      this.h[i] = node.h;
      this.fullW[i] = Math.max(node.w, node.fullW ?? node.w);
      this.fullH[i] = Math.max(node.h, node.fullH ?? node.h);
      this.ghost[i] = node.ghost ? 1 : 0;
      if (node.root && this.rootIndex < 0) this.rootIndex = i;
    });
    /** Edges as index pairs (both ends present, no self-loops). */
    this.sources = [];
    this.targets = [];
    for (const { source, target } of edges) {
      const s = this.indexById.get(source),
        t = this.indexById.get(target);
      if (s == null || t == null || s === t) continue;
      this.sources.push(s);
      this.targets.push(t);
    }
  }

  get rootId() {
    return this.rootIndex >= 0 ? this.ids[this.rootIndex] : undefined;
  }

  /**
   * Space node `i` takes up: its box plus a share (0..1) of the label's overhang on each axis. Low shares let labels
   * overlap their neighbours' (tighter packing).
   */
  footprint(i, widthLabelShare = 1, heightLabelShare = 1) {
    return {
      w: this.w[i] + (this.fullW[i] - this.w[i]) * widthLabelShare,
      h: this.h[i] + (this.fullH[i] - this.h[i]) * heightLabelShare,
    };
  }

  positionOf(id) {
    const i = this.indexById.get(id);
    return i == null ? null : { x: this.x[i], y: this.y[i] };
  }

  /** id → { x, y } for every node. */
  positions() {
    return new Map(
      this.ids.map((id, i) => [id, { x: this.x[i], y: this.y[i] }]),
    );
  }
}
