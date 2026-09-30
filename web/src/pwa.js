import { APP_VERSION } from "./config/constants.js";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Register the service worker (offline support + installability).
 *
 * Skipped on localhost so development always runs fresh code — add `?sw=1` to the URL to test it locally.
 * `onUpdateReady` fires when a new release has taken control, so the page can offer a reload.
 *
 * @param {{ onUpdateReady?: () => void }} [options]
 */
export async function registerServiceWorker({ onUpdateReady } = {}) {
  if (!("serviceWorker" in navigator)) return;
  const isLocal = LOCAL_HOSTNAMES.has(location.hostname);
  if (isLocal && !new URLSearchParams(location.search).has("sw")) return;

  try {
    const hadController = !!navigator.serviceWorker.controller;
    await navigator.serviceWorker.register(
      `sw.js?v=${encodeURIComponent(APP_VERSION)}`,
    );
    // A controller change after an existing one means a new version activated (not the very first install).
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) onUpdateReady?.();
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}
