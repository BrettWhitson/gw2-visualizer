import { SMOOTH_ZOOM } from "../config/constants.js";

/**
 * Replaces Cytoscape's stepwise wheel zoom with a glide: wheel and pinch events move a zoom *target*, and each
 * animation frame eases the view toward it (in log space, so zooming in and out feel symmetric), keeping the point
 * under the pointer fixed. When `smoothZoom` is off, events pass through to Cytoscape untouched.
 */
export class SmoothWheelZoom {
  #cy;
  #settings;
  #container;
  #targetZoom = 1;
  #anchor = { x: 0, y: 0 };
  #frame = 0;
  #lastFrameTime = 0;

  /**
   * @param {import('cytoscape').Core} cy
   * @param {HTMLElement} eventTarget  an ancestor of the Cytoscape container (listens in the capture phase)
   * @param {HTMLElement} container  the Cytoscape container (for pointer coordinates)
   * @param {import('../core/settings-store.js').SettingsStore} settings
   */
  constructor(cy, eventTarget, container, settings) {
    this.#cy = cy;
    this.#container = container;
    this.#settings = settings;
    eventTarget.addEventListener("wheel", (event) => this.#onWheel(event), {
      capture: true,
      passive: false,
    });
  }

  /** Stop gliding (e.g. when another viewport animation takes over). */
  cancel() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #onWheel(event) {
    const { smoothZoom, zoomSpeed } = this.#settings.values;
    const cy = this.#cy;
    if (!smoothZoom || !cy.userZoomingEnabled() || cy.elements().empty())
      return;
    if (!this.#container.contains(/** @type {Node} */ (event.target))) return; // let overlays (legend…) scroll
    event.preventDefault();
    event.stopPropagation(); // keep Cytoscape's own wheel handler out of it

    const unit =
      event.deltaMode === 1
        ? SMOOTH_ZOOM.lineHeightPx
        : event.deltaMode === 2
          ? SMOOTH_ZOOM.pageHeightPx
          : 1;
    const pixels = Math.max(
      -SMOOTH_ZOOM.maxStepPixels,
      Math.min(SMOOTH_ZOOM.maxStepPixels, event.deltaY * unit),
    );
    const boost = event.ctrlKey ? SMOOTH_ZOOM.pinchBoost : 1; // trackpad pinch arrives as ctrl+wheel with small deltas
    const factor = Math.exp(-pixels * SMOOTH_ZOOM.perPixel * zoomSpeed * boost);

    if (!this.#frame) {
      cy.stop(true, false); // interrupt fit/zoom-button animations
      this.#targetZoom = cy.zoom();
    }
    this.#targetZoom = Math.max(
      cy.minZoom(),
      Math.min(cy.maxZoom(), this.#targetZoom * factor),
    );
    const bounds = this.#container.getBoundingClientRect();
    this.#anchor = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };

    if (!this.#frame) {
      this.#lastFrameTime = performance.now();
      this.#frame = requestAnimationFrame((time) => this.#step(time));
    }
  }

  #step(time) {
    const cy = this.#cy;
    const elapsed = Math.min(64, Math.max(1, time - this.#lastFrameTime));
    this.#lastFrameTime = time;
    const currentLog = Math.log(cy.zoom()),
      targetLog = Math.log(this.#targetZoom);
    const remaining = targetLog - currentLog;
    const isDone = Math.abs(remaining) < 0.002;
    const nextLog = isDone
      ? targetLog
      : currentLog +
        remaining * (1 - Math.exp(-elapsed / SMOOTH_ZOOM.easeTimeMs));
    cy.zoom({ level: Math.exp(nextLog), renderedPosition: this.#anchor });
    this.#frame = isDone
      ? 0
      : requestAnimationFrame((next) => this.#step(next));
  }
}
