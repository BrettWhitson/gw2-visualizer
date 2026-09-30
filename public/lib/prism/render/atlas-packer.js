/**
 * Shelf packing for texture atlases: rectangles are placed left to right in rows ("shelves"); a new shelf starts when a
 * row is full, and a new page when the atlas is. Good enough for icons (all the same size) and label images (one
 * height per font size). Pure: it only hands out positions.
 */
export class AtlasPacker {
  /** @param {number} size  atlas page width and height in pixels */
  constructor(size, padding = 1) {
    this.size = size;
    this.padding = padding;
    this.page = 0;
    this.x = 0;
    this.y = 0;
    this.shelfHeight = 0;
  }

  /**
   * A spot for a `width` × `height` rectangle: `{ page, x, y }`, or null when it can never fit.
   * Positions are in pixels on that page.
   */
  place(width, height) {
    const pad = this.padding;
    if (width + pad > this.size || height + pad > this.size) return null;
    if (this.x + width + pad > this.size) {
      // Next shelf.
      this.x = 0;
      this.y += this.shelfHeight;
      this.shelfHeight = 0;
    }
    if (this.y + height + pad > this.size) {
      // Next page.
      this.page++;
      this.x = 0;
      this.y = 0;
      this.shelfHeight = 0;
    }
    const spot = { page: this.page, x: this.x, y: this.y };
    this.x += width + pad;
    this.shelfHeight = Math.max(this.shelfHeight, height + pad);
    return spot;
  }
}
