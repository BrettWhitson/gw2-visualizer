/**
 * A uniform grid over world space for "what's here?" questions: which node is under the pointer, which nodes and
 * labels are on screen. Items are boxes; each is filed under every cell it overlaps. Pure: no DOM.
 */
/** A box spanning more cells than this (or with a coordinate that isn't finite) is kept aside and checked directly. */
const MAX_CELLS_PER_BOX = 4096;

export class SpatialGrid {
  /** @param {number} cellSize  world units per cell (a few node widths works well) */
  constructor(cellSize) {
    this.cellSize = cellSize;
    /** @type {Map<string, number[]>} */
    this.cells = new Map();
    /** @type {{ x1: number, y1: number, x2: number, y2: number }[]} */
    this.boxes = [];
    /** Indexes of boxes too big (or too far out) to file in cells. */
    this.wide = new Set();
  }

  #key(cx, cy) {
    return `${cx},${cy}`;
  }

  /** File box number `index` (the caller's index into its own item list). */
  insert(index, box) {
    this.boxes[index] = box;
    if (!this.#span(box)) {
      this.wide.add(index);
      return;
    }
    this.#forEachCell(box, (key) => {
      const cell = this.cells.get(key);
      if (cell) cell.push(index);
      else this.cells.set(key, [index]);
    });
  }

  /**
   * Move box number `index` to `box` in place (a few nodes moved: cheaper than rebuilding the grid). Cells stay in
   * index order, so hit() still finds the topmost of overlapping boxes.
   */
  move(index, box) {
    const old = this.boxes[index];
    if (!this.wide.delete(index) && old)
      this.#forEachCell(old, (key) => {
        const cell = this.cells.get(key);
        const at = cell?.indexOf(index) ?? -1;
        if (at >= 0) cell.splice(at, 1);
        if (cell && !cell.length) this.cells.delete(key);
      });
    this.boxes[index] = box;
    if (!this.#span(box)) {
      this.wide.add(index);
      return;
    }
    this.#forEachCell(box, (key) => {
      const cell = this.cells.get(key);
      if (!cell) {
        this.cells.set(key, [index]);
        return;
      }
      let low = 0,
        high = cell.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (cell[middle] < index) low = middle + 1;
        else high = middle;
      }
      cell.splice(low, 0, index);
    });
  }

  /** The cells a box covers, or null when it can't be filed in cells (see MAX_CELLS_PER_BOX). */
  #span(box) {
    const size = this.cellSize;
    const x1 = Math.floor(box.x1 / size),
      x2 = Math.floor(box.x2 / size),
      y1 = Math.floor(box.y1 / size),
      y2 = Math.floor(box.y2 / size);
    if (![x1, x2, y1, y2].every(Number.isFinite)) return null;
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > MAX_CELLS_PER_BOX) return null;
    return { x1, x2, y1, y2 };
  }

  #forEachCell(box, visit) {
    const span = this.#span(box);
    if (!span) return;
    for (let cx = span.x1; cx <= span.x2; cx++)
      for (let cy = span.y1; cy <= span.y2; cy++) visit(this.#key(cx, cy));
  }

  /** Indexes of the boxes overlapping `area`, each once. */
  query(area) {
    const size = this.cellSize;
    const found = new Set();
    const x1 = Math.floor(area.x1 / size),
      x2 = Math.floor(area.x2 / size),
      y1 = Math.floor(area.y1 / size),
      y2 = Math.floor(area.y2 / size);
    // A huge area (zoomed far out) covers more cells than there are items: just test every box.
    const cellCount = (x2 - x1 + 1) * (y2 - y1 + 1);
    if (!(cellCount <= this.cells.size)) {
      this.boxes.forEach((box, index) => {
        if (box && overlaps(box, area)) found.add(index);
      });
      return found;
    }
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++)
        for (const index of this.cells.get(this.#key(cx, cy)) ?? [])
          if (!found.has(index) && overlaps(this.boxes[index], area))
            found.add(index);
    for (const index of this.wide)
      if (overlaps(this.boxes[index], area)) found.add(index);
    return found;
  }

  /** The topmost (last inserted) box containing the point, or -1. `accept(index)` can pass over some boxes. */
  hit(x, y, accept = null) {
    const contains = (index) => {
      const box = this.boxes[index];
      return (
        x >= box.x1 &&
        x <= box.x2 &&
        y >= box.y1 &&
        y <= box.y2 &&
        (!accept || accept(index))
      );
    };
    let best = -1;
    for (const index of this.wide)
      if (index > best && contains(index)) best = index;
    const cell =
      this.cells.get(
        this.#key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)),
      ) ?? [];
    for (let i = cell.length - 1; i >= 0; i--)
      if (contains(cell[i])) return Math.max(best, cell[i]);
    return best;
  }
}

export const overlaps = (a, b) =>
  a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
