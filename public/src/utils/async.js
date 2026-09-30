/** Async / collection helpers. */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size)
    chunks.push(array.slice(i, i + size));
  return chunks;
}

/**
 * Run async tasks with at most `concurrency` in flight.
 * @param {Array<() => Promise<unknown>>} tasks
 * @param {number} concurrency
 * @param {(completed: number, total: number) => void} [onProgress]
 */
export async function runWithConcurrency(tasks, concurrency, onProgress) {
  let nextIndex = 0,
    completed = 0;
  const worker = async () => {
    while (nextIndex < tasks.length) {
      await tasks[nextIndex++]();
      onProgress?.(++completed, tasks.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
}

/** Returns a function that delays `fn` until calls stop for `waitMs`. */
export function debounce(fn, waitMs) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

/**
 * Give the page a turn (input, rendering) between slices of long work. Unlike setTimeout(0), this isn't throttled to
 * once a second in a background tab: scheduler.yield() where available, otherwise a message-channel round trip.
 */
export function yieldToPage() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
