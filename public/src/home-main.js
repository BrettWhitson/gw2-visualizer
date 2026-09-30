/** Entry point for the home page. */
import { AccountSession } from "./data/account-session.js";
import { registerServiceWorker } from "./pwa.js";
import { mountSiteChrome } from "./ui/site-chrome.js";

// The crafting explorer used to live at the site root: keep old links like /#item=123 working.
if (/[#&]item=\d+/.test(location.hash))
  location.replace(`crafting.html${location.hash}`);
else {
  const account = new AccountSession();
  mountSiteChrome({ page: "home", account });
  account.addEventListener("change", () => {
    document.getElementById("charactersGo").textContent = account.isReady
      ? "See your characters →"
      : "Connect your account →";
  });
  account.restore();
  registerServiceWorker();
}
