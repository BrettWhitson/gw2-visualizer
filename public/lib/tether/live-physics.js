import { ElasticNetwork } from "./elastic.js";
import { isDirectionalLayout, isHorizontalDirection } from "./directions.js";
import { PHYSICS_TUNING } from "./tuning.js";

/**
 * Tether's physics after the layout: dragging, shaking, floating into place. A renderer tells it what the pointer
 * does and calls step() once per frame while `active`, drawing the positions it returns; everything that moves
 * (and how) is decided here, in the chosen physics mode:
 *
 *  - elastic: the graph is an elastic net around where it rests (elastic.js). The held node's neighbours follow,
 *    theirs less, fading with every link; what isn't connected, or is far enough away, stays still. Letting go keeps
 *    the pulled shape. Link force sets how far a pull reaches, center force how firmly nodes hold on.
 *  - floating: the whole graph is live (the layout's force simulation, physics.js): the held node drags its
 *    neighbours, the rest sways and makes room, and it all settles again after you let go.
 *
 *   const physics = new LivePhysics(settings);
 *   physics.simulation = runLayout(graph, settings);
 *   physics.grab(id, { ids, links, positionOf });   // then physics.drag(id, point) as the pointer moves
 *   while (physics.active) draw(physics.step().moved);
 *
 * Positions are read through `positionOf(id)`, so the physics starts from what's on screen (a transition may still
 * be under way). A drag stays in the mode it started in, even if the mode setting changes before it ends.
 */
export class LivePhysics {
  #simulation = null;
  #settings;
  #tuning = { ...PHYSICS_TUNING };
  /** What step() advances: "net" (the elastic net), "simulation", or null (nothing moving). */
  #running = null;
  /** For a simulation run: its own finish line, or null (until it cools). */
  #until = null;
  #net = null;
  #netIds = [];
  /** The node being dragged and the engine holding it ("net" or "simulation"), or null. */
  #held = null;
  /** step()'s list of moved nodes for a simulation run, reused frame to frame. */
  #moved = [];

  /**
   * @param {{ physicsMode?: string, linkForce: number, centerForce: number, direction: string }} settings
   *   read on every grab, so the caller may change them in place
   */
  constructor(settings) {
    this.#settings = settings;
  }

  /** The layout's force simulation (from runLayout), or null. Floating mode, shake() and floatIn() need one. */
  get simulation() {
    return this.#simulation;
  }

  /** A new layout's simulation: whatever the old one was doing stops (and lets go of a held node). */
  set simulation(simulation) {
    if (simulation === this.#simulation) return;
    this.stop();
    this.#simulation = simulation ?? null;
    this.#moved = [];
  }

  get tuning() {
    return { ...this.#tuning };
  }

  /**
   * PHYSICS_TUNING (tuning.js) with these overrides; every other constant goes back to its default. Applies to the
   * running simulation too.
   */
  set tuning(tuning) {
    this.#tuning = { ...PHYSICS_TUNING, ...tuning };
    if (this.#simulation) Object.assign(this.#simulation.tuning, this.#tuning);
  }

  /** Does step() have anything to move? */
  get active() {
    return this.#running !== null;
  }

  /** The elastic net while a node is held and until it settles, or null (for developer tools). */
  get elasticNet() {
    return this.#net;
  }

  /**
   * A node is grabbed. Nodes `positionOf` knows nothing about (on their way out, say) sit the drag out.
   * @param {string} id
   * @param {{ ids: string[], links: { source: string, target: string }[],
   *           positionOf: (id: string) => { x: number, y: number } | null | undefined }} graph  what's on screen
   */
  grab(id, { ids, links, positionOf }) {
    this.stop();
    const at = positionOf(id);
    if (!at) return;
    if (this.#settings.physicsMode === "floating") {
      const started = this.#runSimulation(positionOf, (simulation) => {
        simulation.reheat(this.#tuning.dragHeat);
        // What's on screen is rest: only what the drag changes moves anything.
        simulation.holdRest();
        simulation.fix(id, at);
      });
      if (started) this.#held = { id, engine: "simulation" };
      return;
    }
    const placed = [],
      xs = [],
      ys = [];
    for (const nodeId of ids) {
      const p = positionOf(nodeId);
      if (!p) continue;
      placed.push(nodeId);
      xs.push(p.x);
      ys.push(p.y);
    }
    const index = new Map(placed.map((nodeId, i) => [nodeId, i]));
    const sources = [],
      targets = [];
    for (const link of links) {
      const s = index.get(link.source),
        t = index.get(link.target);
      if (s == null || t == null || s === t) continue;
      sources.push(s);
      targets.push(t);
    }
    const s = this.#settings,
      t = this.#tuning;
    this.#net = new ElasticNetwork(
      { ids: placed, x: xs, y: ys, sources, targets },
      {
        stiffness:
          t.elasticStiffnessBase + t.elasticStiffnessPerLink * s.linkForce,
        anchor: t.elasticAnchorBase + t.elasticAnchorPerCenter * s.centerForce,
        damping: t.elasticDamping,
        // Trees hold their levels more firmly than their place along them.
        alongAxis: isDirectionalLayout(s)
          ? isHorizontalDirection(s.direction)
            ? "x"
            : "y"
          : null,
        alongHold: t.elasticAlongHold,
        wake: t.elasticWake,
        rest: t.elasticRest,
      },
    );
    this.#netIds = placed;
    this.#net.grab(id, at);
    this.#held = { id, engine: "net" };
    this.#running = "net";
  }

  /** The held node moved to `point`. */
  drag(id, point) {
    if (this.#held?.id !== id) return;
    if (this.#held.engine === "simulation") {
      if (!this.#simulation) return;
      this.#simulation.fix(id, point);
      this.#running ??= "simulation";
      return;
    }
    if (!this.#net) return;
    this.#net.move(id, point);
    this.#running ??= "net";
  }

  /** The held node was let go. */
  release(id) {
    if (this.#held?.id !== id) return;
    const { engine } = this.#held;
    this.#held = null;
    if (engine === "simulation") {
      if (!this.#simulation) return;
      this.#simulation.release(id);
      this.#simulation.reheat(0); // cool down from here
      this.#running ??= "simulation";
      return;
    }
    if (!this.#net) return;
    this.#net.release(id);
    this.#running ??= "net";
  }

  /**
   * Shake the physics and let it settle: optionally scatter every node by up to `scatter` world units (the same way
   * each time), heat the simulation to `heat` (0..1) and let it cool. Returns false without a simulation.
   */
  shake(positionOf, { heat = 0.6, scatter = 0 } = {}) {
    return this.#runSimulation(positionOf, (simulation) => {
      if (scatter)
        for (let i = 0; i < simulation.count; i++) {
          simulation.x[i] += (unitNoise(i * 2) * 2 - 1) * scatter;
          simulation.y[i] += (unitNoise(i * 2 + 1) * 2 - 1) * scatter;
        }
      simulation.alphaTarget = 0;
      simulation.alpha = Math.max(simulation.alpha, heat);
    });
  }

  /**
   * A new layout floats into place from its seed (runLayout with `settle: false`), cooling to the drag heat and
   * stopping once still there (or after floatInTicks: crowded graphs can jitter at that heat for good), so a node
   * grabbed later only moves what's near it. Returns false without a simulation.
   */
  floatIn() {
    let ticks = 0;
    return this.#runSimulation(
      null,
      (simulation) => {
        simulation.alpha = 1;
        simulation.alphaTarget = this.#tuning.dragHeat;
      },
      (simulation) =>
        ++ticks >= this.#tuning.floatInTicks ||
        (simulation.alpha - simulation.alphaTarget < 0.01 &&
          simulation.motion < this.#tuning.stillness),
    );
  }

  /** Stop whatever is moving (a drag settling, a shake, floating in), and let go of a held node. */
  stop() {
    if (this.#held?.engine === "simulation" && this.#simulation) {
      this.#simulation.release(this.#held.id);
      this.#simulation.reheat(0);
    }
    this.#held = null;
    this.#running = null;
    this.#until = null;
    this.#net = null;
  }

  /**
   * Advance one frame. `moved` lists [id, x, y] for every node that moved (for a simulation run the same array is
   * reused next frame, so read it before calling step() again); `moving` is false once everything is still (then
   * `active` is false too, until the next grab, drag, release or shake).
   * @returns {{ moving: boolean, moved: [string, number, number][] }}
   */
  step() {
    if (this.#running === "net") {
      const net = this.#net,
        ids = this.#netIds;
      const moving = net.step();
      const moved = net.changed.map((i) => [ids[i], net.x[i], net.y[i]]);
      if (!moving) {
        this.#running = null;
        if (!net.held.includes(1)) this.#net = null;
      }
      return { moving, moved };
    }
    if (this.#running === "simulation") {
      const simulation = this.#simulation;
      if (!simulation) {
        this.stop();
        return { moving: false, moved: [] };
      }
      simulation.tick();
      const { ids, x, y } = simulation;
      if (this.#moved.length !== ids.length)
        this.#moved = ids.map((id) => [id, 0, 0]);
      const moved = this.#moved;
      for (let i = 0; i < ids.length; i++) {
        moved[i][1] = x[i];
        moved[i][2] = y[i];
      }
      const until = this.#until;
      const done = until ? until(simulation) : !simulation.isActive;
      if (done) {
        if (until) simulation.alpha = simulation.alphaTarget = 0;
        this.#running = this.#until = null;
      }
      return { moving: !done, moved };
    }
    return { moving: false, moved: [] };
  }

  /** Run the simulation from what's on screen (or, without `positionOf`, its own positions) after `prepare`. */
  #runSimulation(positionOf, prepare, until = null) {
    const simulation = this.#simulation;
    if (!simulation) return false;
    this.stop();
    if (positionOf) simulation.setPositions(positionOf);
    prepare(simulation);
    this.#until = until;
    this.#running = "simulation";
    return true;
  }
}

/** A repeatable pseudo-random number in [0, 1) for an integer. */
function unitNoise(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
