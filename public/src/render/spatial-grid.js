/**
 * A uniform grid over world space for "what's here?" questions: which node is under the pointer, which nodes and
 * labels are on screen. Items are boxes; each is filed under every cell it overlaps. Pure: no DOM.
 */
export class SpatialGrid {
  /** @param {number} cellSize  world units per cell (a few node widths works well) */
  constructor(cellSize) {
    this.cellSize = cellSize;
    /** @type {Map<string, number[]>} */
    this.cells = new Map();
    /** @type {{ x1: number, y1: number, x2: number, y2: number }[]} */
    this.boxes = [];
  }

  #key(cx, cy) {
    return `${cx},${cy}`;
  }

  /** File box number `index` (the caller's index into its own item list). */
  insert(index, box) {
    this.boxes[index] = box;
    const size = this.cellSize;
    for (
      let cx = Math.floor(box.x1 / size);
      cx <= Math.floor(box.x2 / size);
      cx++
    )
      for (
        let cy = Math.floor(box.y1 / size);
        cy <= Math.floor(box.y2 / size);
        cy++
      ) {
        const key = this.#key(cx, cy);
        const cell = this.cells.get(key);
        if (cell) cell.push(index);
        else this.cells.set(key, [index]);
      }
  }

  /**
   * Move box number `index` to `box` in place (a few nodes moved: cheaper than rebuilding the grid). Cells stay in
   * index order, so hit() still finds the topmost of overlapping boxes.
   */
  move(index, box) {
    const old = this.boxes[index];
    if (old)
      this.#forEachCell(old, (key) => {
        const cell = this.cells.get(key);
        const at = cell?.indexOf(index) ?? -1;
        if (at >= 0) cell.splice(at, 1);
        if (cell && !cell.length) this.cells.delete(key);
      });
    this.boxes[index] = box;
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

  #forEachCell(box, visit) {
    const size = this.cellSize;
    for (
      let cx = Math.floor(box.x1 / size);
      cx <= Math.floor(box.x2 / size);
      cx++
    )
      for (
        let cy = Math.floor(box.y1 / size);
        cy <= Math.floor(box.y2 / size);
        cy++
      )
        visit(this.#key(cx, cy));
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
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > this.cells.size) {
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
    return found;
  }

  /** The topmost (last inserted) box containing the point, or -1. */
  hit(x, y) {
    const cell =
      this.cells.get(
        this.#key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)),
      ) ?? [];
    for (let i = cell.length - 1; i >= 0; i--) {
      const box = this.boxes[cell[i]];
      if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2)
        return cell[i];
    }
    return -1;
  }
}

export const overlaps = (a, b) =>
  a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
