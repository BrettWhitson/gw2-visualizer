/**
 * The view onto the graph: a zoom and a pan, mapping world coordinates (where the layout put the nodes) to screen
 * pixels. screen = world × zoom + pan. Pure: no DOM.
 */
export class Camera {
  /** @param {{ minZoom?: number, maxZoom?: number }} [limits] */
  constructor({ minZoom = 0.005, maxZoom = 4 } = {}) {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  toScreen(x, y) {
    return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY };
  }

  toWorld(x, y) {
    return { x: (x - this.panX) / this.zoom, y: (y - this.panY) / this.zoom };
  }

  /** Zoom by `factor`, keeping the world point under screen point (sx, sy) where it is. */
  zoomAround(factor, sx, sy) {
    const next = Math.min(
      this.maxZoom,
      Math.max(this.minZoom, this.zoom * factor),
    );
    const world = this.toWorld(sx, sy);
    this.zoom = next;
    this.panX = sx - world.x * next;
    this.panY = sy - world.y * next;
  }

  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
  }

  /**
   * Show the world box `bounds` centred in a `width` × `height` viewport with `padding` pixels around it, never zooming
   * in past `maxFitZoom` (so a single node isn't blown up to fill the screen).
   */
  fit(bounds, width, height, { padding = 40, maxFitZoom = 1.6 } = {}) {
    const boxWidth = Math.max(1, bounds.x2 - bounds.x1);
    const boxHeight = Math.max(1, bounds.y2 - bounds.y1);
    const zoom = Math.min(
      maxFitZoom,
      Math.max(0, width - 2 * padding) / boxWidth,
      Math.max(0, height - 2 * padding) / boxHeight,
    );
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.panX = width / 2 - ((bounds.x1 + bounds.x2) / 2) * this.zoom;
    this.panY = height / 2 - ((bounds.y1 + bounds.y2) / 2) * this.zoom;
  }

  /** The world box currently on screen (for culling), with `margin` screen pixels to spare. */
  visibleWorld(width, height, margin = 0) {
    const topLeft = this.toWorld(-margin, -margin);
    const bottomRight = this.toWorld(width + margin, height + margin);
    return {
      x1: topLeft.x,
      y1: topLeft.y,
      x2: bottomRight.x,
      y2: bottomRight.y,
    };
  }

  /** Column-major 3×3 matrix mapping world coordinates to WebGL clip space for a `width` × `height` viewport. */
  clipMatrix(width, height) {
    const sx = (2 * this.zoom) / width;
    const sy = (-2 * this.zoom) / height;
    return new Float32Array([
      sx,
      0,
      0,
      0,
      sy,
      0,
      (2 * this.panX) / width - 1,
      1 - (2 * this.panY) / height,
      1,
    ]);
  }
}
