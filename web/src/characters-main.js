/**
 * Entry point for the Characters page, a Svelte app (ui/CharactersPage.svelte): connect an account → character list →
 * one character's armory (`#<name>`). The account comes from the shared AccountSession, which the header's account
 * control connects, refreshes and forgets.
 */
import { mount } from "svelte";
import { CACHE_DB_NAME } from "./config/constants.js";
import { CharacterCatalogs } from "./data/account-client.js";
import { IndexedDbStore } from "./data/indexed-db-store.js";
import { createAccountSession } from "./data/site-account.js";
import { registerServiceWorker } from "./pwa.js";
import CharactersPage from "./ui/CharactersPage.svelte";
import { mountSiteChrome } from "./ui/site-chrome.js";
import { querySelector as $ } from "./utils/dom.js";

const session = createAccountSession();
mountSiteChrome({ page: "characters", account: session });
// Kept with the crafting data, so Settings → Clear cached data clears these too.
const catalogs = new CharacterCatalogs(undefined, {
  store: new IndexedDbStore(CACHE_DB_NAME),
});
const page = mount(CharactersPage, {
  target: $("#charactersMain"),
  props: { session, catalogs },
});
if (["localhost", "127.0.0.1"].includes(location.hostname))
  globalThis.gw2Characters = { page, session, catalogs }; // console access while developing
session.restore();
registerServiceWorker(); // a new release is picked up on the next visit
