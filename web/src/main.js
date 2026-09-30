/** Entry point for the crafting page. Graphs are drawn by Prismatrix, which needs WebGL2. */
import { CraftingTreeApp } from "./app.js";
import { registerServiceWorker } from "./pwa.js";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { canDrawGraphs, NO_WEBGL_MESSAGE } from "./render/webgl-support.js";
import { createAccountSession } from "./data/site-account.js";

const account = createAccountSession();
mountSiteChrome({ page: "crafting", account });

function showFatalError(message) {
  const overlay = document.getElementById("overlay");
  document.getElementById("ovText").textContent = message;
  overlay.hidden = false;
}

if (!canDrawGraphs()) {
  showFatalError(NO_WEBGL_MESSAGE);
} else {
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
