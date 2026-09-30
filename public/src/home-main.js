/** Entry point for the home page. */
import { ApiKeyStore } from "./core/api-key-store.js";
import { registerServiceWorker } from "./pwa.js";
import { mountSiteChrome } from "./ui/site-chrome.js";

// The crafting explorer used to live at the site root: keep old links like /#item=123 working.
if (/[#&]item=\d+/.test(location.hash))
  location.replace(`crafting.html${location.hash}`);
else {
  mountSiteChrome({ page: "home" });
  if (new ApiKeyStore().get())
    document.getElementById("charactersGo").textContent =
      "See your characters →";
  registerServiceWorker();
}
