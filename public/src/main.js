/**
 * Entry point. Cytoscape and the dagre layout are vendored UMD scripts (lib/) loaded before this module,
 * so they're available as globals.
 */
import { CraftingTreeApp } from "./app.js";
import { registerServiceWorker } from "./pwa.js";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { createAccountSession } from "./data/site-account.js";

const account = createAccountSession();
mountSiteChrome({ page: "crafting", account });

function showFatalError(message) {
  const overlay = document.getElementById("overlay");
  document.getElementById("ovText").textContent = message;
  overlay.hidden = false;
}

if (!globalThis.cytoscape) {
  showFatalError(
    "The graph library failed to load. Check your connection and reload the page.",
  );
} else {
  try {
    globalThis.cytoscape.use(globalThis.cytoscapeDagre);
  } catch {
    // cytoscape-dagre registers itself when loaded after cytoscape; use() then throws "already registered".
  }

  const app = new CraftingTreeApp({ account });
  if (["localhost", "127.0.0.1"].includes(location.hostname))
    globalThis.gw2CraftingTree = app; // console access while developing

  // Surface unexpected failures instead of failing silently.
  window.addEventListener("error", (event) =>
    app.reportError(event.error ?? event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    app.reportError(event.reason),
  );

  app.start();
  account.restore(); // owned items fill in when the account loads
  registerServiceWorker({ onUpdateReady: () => app.offerReload() });
}
