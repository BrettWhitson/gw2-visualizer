/**
 * One animation loop for a whole graph transition (instead of one Cytoscape animation per element):
 * every frame moves all nodes inside a single `cy.batch`, so large graphs pay for one style/render pass per frame.
 *
 * Fades use the stylesheet's own opacity transition: an element starts with an `opacity: 0` bypass, and the bypass is
 * dropped when its (possibly staggered) turn comes, which lets Cytoscape ease it back in.
 */

/**
 * Mid-transition, nodes glide through each other (new ones start on top of their parent), so for a few frames some
 * edges have no drawable endpoints. Cytoscape skips drawing those and logs "Edge … has invalid endpoints … expected
 * behaviour when the source node and the target node overlap" for each — hundreds of warnings per merged-view
 * transition. Those warnings are silenced only while a transition runs; final layouts still report real problems.
 */
let runningTransitions = 0;
const setCytoscapeWarnings = (isEnabled) =>
  globalThis.cytoscape?.warnings?.(isEnabled);

/** JS versions of the user-facing easing options (see EASING_FUNCTIONS for the Cytoscape names). */
export const EASING_CURVES = {
  smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  snappy: (t) => 1 - (1 - t) ** 5,
  bouncy: (t) => {
    const c = 1.6;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  }, // overshoots, then settles
  linear: (t) => t,
};

export class GraphTransition {
  #cy;
  #duration;
  #ease;
  #nodeTracks = [];
  #edgeReveals = [];
  #ghostTracks = [];
  #viewport = null;
  #frame = 0;
  #startTime = 0;
  #isFinished = false;
  #started = false;
  #onFinish;

  /**
   * @param {import('cytoscape').Core} cy
   * @param {{ duration: number, easing: string, onFinish?: () => void }} options
   */
  constructor(cy, { duration, easing, onFinish }) {
    this.#cy = cy;
    this.#duration = Math.max(1, duration);
    this.#ease = EASING_CURVES[easing] ?? EASING_CURVES.smooth;
    this.#onFinish = onFinish;
  }

  get isRunning() {
    return this.#frame !== 0;
  }

  /** Move a node from → to after `delay` ms; `fadeIn` reveals it when its move starts. */
  moveNode(node, from, to, { delay = 0, fadeIn = false } = {}) {
    node.position(from);
    if (fadeIn) node.style("opacity", 0);
    this.#nodeTracks.push({ node, from, to, delay, fadeIn, progress: -1 });
  }

  /** Reveal an edge (it starts hidden) once `delay` ms have passed. */
  revealEdge(edge, delay) {
    edge.style("opacity", 0);
    this.#edgeReveals.push({ edge, delay, done: false });
  }

  /** A removed node's stand-in: glides to `to` while fading out, then is removed. */
  addGhost(ghost, to) {
    this.#ghostTracks.push({ ghost, from: { ...ghost.position() }, to });
  }

  /** Animate the viewport in the same loop so camera and nodes stay in step. */
  setViewport(from, to) {
    this.#viewport = { from, to };
  }

  start() {
    const cy = this.#cy;
    cy.batch(() =>
      this.#ghostTracks.forEach(({ ghost }) => ghost.style({ opacity: 0 })),
    );
    if (runningTransitions++ === 0) setCytoscapeWarnings(false);
    this.#started = true;
    this.#startTime = performance.now();
    this.#frame = requestAnimationFrame((time) => this.#tick(time));
  }

  /** Jump to the end state (also used when a new render interrupts this one). */
  finish() {
    if (this.#isFinished) return;
    this.#isFinished = true;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    const cy = this.#cy;
    cy.batch(() => {
      for (const track of this.#nodeTracks) {
        if (track.node.removed()) continue;
        track.node.position(track.to);
        if (track.fadeIn) track.node.removeStyle("opacity");
      }
      for (const reveal of this.#edgeReveals)
        if (!reveal.edge.removed()) reveal.edge.removeStyle("opacity");
      for (const { ghost } of this.#ghostTracks)
        if (!ghost.removed()) ghost.remove();
    });
    if (this.#viewport) cy.viewport(this.#viewport.to);
    // Re-enable after Cytoscape has drawn the final frame, so the last in-between frame can't warn either.
    if (this.#started)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (--runningTransitions === 0) setCytoscapeWarnings(true);
        }),
      );
    this.#onFinish?.();
  }

  #tick(now) {
    const elapsed = now - this.#startTime;
    const duration = this.#duration,
      ease = this.#ease;
    let isActive = false;

    this.#cy.batch(() => {
      for (const track of this.#nodeTracks) {
        if (elapsed < track.delay) {
          isActive = true;
          continue;
        } // staggered: not its turn yet
        const progress = Math.min(1, (elapsed - track.delay) / duration);
        if (progress < 1) isActive = true;
        if (progress === track.progress) continue;
        if (track.fadeIn && track.progress < 0)
          track.node.removeStyle("opacity");
        track.progress = progress;
        const eased = ease(progress);
        track.node.position({
          x: track.from.x + (track.to.x - track.from.x) * eased,
          y: track.from.y + (track.to.y - track.from.y) * eased,
        });
      }
      for (const reveal of this.#edgeReveals) {
        if (reveal.done) continue;
        if (elapsed >= reveal.delay) {
          reveal.edge.removeStyle("opacity");
          reveal.done = true;
        } else isActive = true;
      }
      const ghostProgress = Math.min(1, elapsed / (duration * 0.8));
      if (ghostProgress < 1) isActive = true;
      const ghostEased = ease(ghostProgress);
      for (const { ghost, from, to } of this.#ghostTracks) {
        ghost.position({
          x: from.x + (to.x - from.x) * ghostEased,
          y: from.y + (to.y - from.y) * ghostEased,
        });
      }
    });

    if (this.#viewport) {
      const progress = Math.min(1, elapsed / duration),
        eased = EASING_CURVES.smooth(progress);
      const { from, to } = this.#viewport;
      const zoom = from.zoom * (to.zoom / from.zoom) ** eased; // geometric: zooming feels uniform
      this.#cy.viewport({
        zoom,
        pan: {
          x: from.pan.x + (to.pan.x - from.pan.x) * eased,
          y: from.pan.y + (to.pan.y - from.pan.y) * eased,
        },
      });
      if (progress < 1) isActive = true;
    }

    if (isActive)
      this.#frame = requestAnimationFrame((time) => this.#tick(time));
    else this.finish();
  }
}
