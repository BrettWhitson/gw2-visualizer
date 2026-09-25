/** Holding − / + repeats after this delay, at this interval. */
const HOLD_DELAY_MS = 380;
const HOLD_INTERVAL_MS = 70;

/**
 * Move a range input by `direction` steps (−1 / +1), clamped to its bounds and snapped to its step.
 * @param {HTMLInputElement} input
 * @returns {boolean} whether the value changed
 */
export function stepRange(input, direction) {
  const step = Number(input.step) || 1;
  const decimals = (String(input.step).split(".")[1] ?? "").length;
  const next = Math.min(
    Number(input.max),
    Math.max(Number(input.min), Number(input.value) + direction * step),
  ).toFixed(decimals);
  if (Number(next) === Number(input.value)) return false;
  input.value = next;
  return true;
}

/** Disable the −/+ buttons in `container` at the ends of `input`'s range. */
export function syncStepButtons(container, input) {
  const value = Number(input.value);
  for (const button of container.querySelectorAll(".step"))
    button.disabled =
      Number(button.dataset.step) < 0
        ? value <= Number(input.min)
        : value >= Number(input.max);
}

/**
 * Wire −/+ buttons (`.step[data-step="-1" | "1"]`) inside `root` to the range input in their closest `container`:
 * press to step, hold to repeat, keyboard activation (Enter / Space) steps once. Used by the ribbon and Customize.
 * @param {HTMLElement} root
 * @param {string} container  selector for the element holding one range and its buttons
 * @param {(input: HTMLInputElement) => void} onStep  after each step (update readouts, schedule a commit)
 */
export function bindRangeSteppers(root, container, onStep) {
  const step = (button) => {
    const row = button.closest(container);
    const input = row?.querySelector('input[type="range"]');
    if (!input || !stepRange(input, Number(button.dataset.step))) return;
    syncStepButtons(row, input);
    onStep(input);
  };
  let holdTimer = 0;
  const stopHold = () => clearTimeout(holdTimer);
  root.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".step");
    if (!button || button.disabled || event.button !== 0) return;
    event.preventDefault(); // keep focus where it is; no text selection while holding
    step(button);
    const repeat = () => {
      if (button.disabled) return;
      step(button);
      holdTimer = setTimeout(repeat, HOLD_INTERVAL_MS);
    };
    holdTimer = setTimeout(repeat, HOLD_DELAY_MS);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"])
    root.addEventListener(type, stopHold);
  root.addEventListener("click", (event) => {
    const button = event.target.closest(".step");
    if (button && event.detail === 0) step(button); // keyboard: pointer clicks already stepped on pointerdown
  });
}
