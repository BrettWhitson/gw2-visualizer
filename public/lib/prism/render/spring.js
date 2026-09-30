/**
 * Springs drive every motion in the renderer: node positions, fades, glows and the camera. Each value chases a target;
 * retargeting mid-flight just bends the motion (no restarts, no jumps), which is what makes interrupted transitions,
 * drags and rapid clicks feel continuous. Pure: no DOM.
 */

/**
 * Spring constants for an animation that should settle in about `durationMs`, in the given feel:
 *  - smooth: critically damped (no overshoot);
 *  - snappy: critically damped, quicker off the mark;
 *  - bouncy: underdamped, overshoots once and settles;
 *  - linear: heavily damped, an even glide.
 * @returns {{ omega: number, zeta: number }}  angular frequency (1/s) and damping ratio
 */
export function springFor(durationMs, feel = "smooth") {
  const seconds = Math.max(0.05, durationMs / 1000);
  switch (feel) {
    case "snappy":
      return { omega: 9 / seconds, zeta: 1 };
    case "bouncy":
      return { omega: 7 / seconds, zeta: 0.5 };
    case "linear":
      return { omega: 9 / seconds, zeta: 1.6 };
    default:
      return { omega: 6.6 / seconds, zeta: 1 };
  }
}

/**
 * Advance one spring value by `dt` seconds toward `target`. `state` is { value, velocity } and is updated in place.
 * Semi-implicit Euler in small sub-steps: stable for any frame time a browser produces. Within `precision` (and
 * barely moving) it lands exactly on the target and stops.
 * @returns {boolean} still moving
 */
export function stepSpring(
  state,
  target,
  dt,
  { omega, zeta },
  precision = 0.004,
) {
  const steps = Math.max(1, Math.ceil((dt * omega) / 0.5));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const acceleration =
      -omega * omega * (state.value - target) -
      2 * zeta * omega * state.velocity;
    state.velocity += acceleration * h;
    state.value += state.velocity * h;
  }
  const settled =
    Math.abs(state.value - target) < precision &&
    Math.abs(state.velocity) < precision * 10;
  if (settled) {
    state.value = target;
    state.velocity = 0;
  }
  return !settled;
}

/** A value with a spring attached. */
export class Spring {
  /**
   * @param {number} value  @param {{ omega: number, zeta: number }} params
   * @param {number} [precision]  how close counts as there (in the value's own units)
   */
  constructor(value, params, precision = 0.004) {
    if (!Number.isFinite(value)) value = 0;
    this.precision = precision;
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.params = params;
  }

  /** Chase a new target (from wherever it is now, keeping its velocity). NaN and ±Infinity are ignored. */
  set(target) {
    if (Number.isFinite(target)) this.target = target;
  }

  /** Jump there, no motion. NaN and ±Infinity are ignored. */
  snap(value) {
    if (!Number.isFinite(value)) return;
    this.value = this.target = value;
    this.velocity = 0;
  }

  get moving() {
    return this.value !== this.target || this.velocity !== 0;
  }

  /** @returns {boolean} still moving */
  step(dt) {
    if (!this.moving) return false;
    return stepSpring(this, this.target, dt, this.params, this.precision);
  }
}
