/**
 * Entry point for the Characters page: connect an account → character list → one character's armory (`#<name>`).
 * The account comes from the shared AccountSession (the header's account control connects, refreshes and forgets).
 */
import { CACHE_DB_NAME } from "./config/constants.js";
import { CharacterCatalogs } from "./data/account-client.js";
import { IndexedDbStore } from "./data/indexed-db-store.js";
import { createAccountSession } from "./data/site-account.js";
import { activeBuild, buildArmory } from "./model/character-armory.js";
import { armoryHtml, characterListHtml } from "./ui/character-view.js";
import { openShareDialog } from "./ui/share-image.js";
import { escapeHtml, querySelector as $ } from "./utils/dom.js";
import { registerServiceWorker } from "./pwa.js";
import { mountSiteChrome } from "./ui/site-chrome.js";

class CharactersPage {
  // Kept with the crafting data, so Settings → Clear cached data clears these too.
  catalogs = new CharacterCatalogs(undefined, {
    store: new IndexedDbStore(CACHE_DB_NAME),
  });
  /** Per-character view choices, kept while the page is open. */
  choices = new Map();
  tooltips = new Map();
  pinnedTip = null;
  renderToken = 0;
  /** Icons or Full: a per-viewer preference, remembered in this browser. */
  gearView = readGearView();

  /** @param {AccountSession} account */
  constructor(account) {
    this.account = account;
  }

  get characters() {
    return this.account.characters;
  }

  start() {
    $("#keyForm").addEventListener("submit", (event) => {
      event.preventDefault();
      this.account.connect($("#apiKey").value, {
        remember: $("#rememberKey").checked,
      });
    });
    window.addEventListener("hashchange", () => this.render());
    this.account.addEventListener("change", () => this.#onAccountChange());
    this.bindTooltips();
    this.#onAccountChange();
  }

  #shownAccount = null;

  #onAccountChange() {
    const { status, error, accountName, fetchedAt } = this.account;
    // A background refresh starting (or failing) changes nothing drawn: redraw only for new data.
    const current = `${status}|${accountName}|${fetchedAt}|${error}`;
    if (current === this.#shownAccount) return;
    this.#shownAccount = current;
    if (status === "ready") {
      $("#keyPanel").hidden = true;
      if (!this.characters) {
        this.#showMessage(
          "This API key doesn't have the <b>characters</b> permission. Use the account menu at the top right to connect a key with <b>characters</b> and <b>builds</b>.",
        );
        return;
      }
      this.render();
    } else if (status === "connecting") {
      this.#invalidate();
      $("#keyPanel").hidden = true;
      this.setContent('<p class="loading">Connecting to your account…</p>');
    } else {
      this.showKeyPanel(status === "error" ? error : "");
    }
  }

  #showMessage(html) {
    this.#invalidate();
    this.setContent(`<p class="notice">${html}</p>`);
  }

  /** Any view change: an armory still loading must not draw over what replaced it. */
  #invalidate() {
    return ++this.renderToken;
  }

  /** The key form; view choices are dropped with the account they belonged to. */
  showKeyPanel(error = "") {
    this.#invalidate();
    this.choices.clear();
    $("#keyPanel").hidden = false;
    this.setContent("");
    $("#keyError").textContent = error;
  }

  render() {
    if (!this.account.isReady || !this.characters) return;
    this.#invalidate();
    let name = "";
    try {
      name = decodeURIComponent(location.hash.slice(1));
    } catch {
      /* malformed hash: show the list */
    }
    const character = name
      ? this.characters.find((candidate) => candidate.name === name)
      : null;
    if (character) this.renderArmory(character);
    else this.renderList();
  }

  async renderList() {
    const token = this.renderToken;
    await this.catalogs.loadSpecializations(); // elite spec names and icons; loaded once
    if (token !== this.renderToken) return;
    const summaries = this.characters.map((character) => ({
      ...character,
      build: activeBuild(character, this.catalogs.specializations),
    }));
    const notice = !this.account.has("builds")
      ? '<p class="notice">This key lacks the <b>builds</b> permission, so equipment templates and build specializations are unavailable.</p>'
      : "";
    this.setContent(
      notice + characterListHtml(summaries, this.account.accountName),
    );
  }

  async renderArmory(character) {
    const token = this.#invalidate();
    this.setContent(
      `<p class="loading">Loading ${escapeHtml(character.name)}'s gear…</p>`,
    );
    try {
      await this.catalogs.loadFor(character);
      if (token !== this.renderToken) return; // the user moved on while this loaded

      const choice = this.choices.get(character.name) ?? {};
      const armory = buildArmory(character, this.catalogs, choice.tab ?? null);
      const weaponSet = choice.weaponSet ?? armory.defaultSet;
      const { html, tooltips } = armoryHtml(armory, weaponSet, {
        view: this.gearView,
      });
      this.tooltips = tooltips;
      this.setContent(html);

      const content = $("#characterContent");
      content.querySelectorAll("[data-tab]").forEach((button) =>
        button.addEventListener("click", () => {
          this.choices.set(character.name, {
            ...choice,
            tab: Number(button.dataset.tab),
          });
          this.renderArmory(character);
        }),
      );
      content
        .querySelector("[data-share-open]")
        .addEventListener("click", () =>
          openShareDialog(
            armory,
            this.gearView === "full" ? "full" : "compact",
          ),
        );
      content.querySelectorAll("[data-gear-view]").forEach((button) =>
        button.addEventListener("click", () => {
          this.gearView = button.dataset.gearView;
          saveGearView(this.gearView);
          this.choices.set(character.name, { ...choice, tab: armory.tab });
          this.renderArmory(character);
        }),
      );
      content.querySelectorAll("[data-weapon-set]").forEach((button) =>
        button.addEventListener("click", () => {
          this.choices.set(character.name, {
            ...choice,
            tab: armory.tab,
            weaponSet: button.dataset.weaponSet,
          });
          this.renderArmory(character);
        }),
      );
    } catch (error) {
      if (token === this.renderToken)
        this.setContent(
          `<p class="empty">Couldn't show ${escapeHtml(character.name)}'s gear: ${escapeHtml(error.message)}</p>`,
        );
    }
  }

  setContent(html) {
    this.hideTip();
    $("#characterContent").innerHTML = html;
  }

  // ---------------------------------------------------------------- tooltips

  /** Hover or focus shows; click or tap pins (so touch works); Escape or a click elsewhere dismisses. */
  bindTooltips() {
    const tip = document.createElement("div");
    tip.className = "gear-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.append(tip);
    this.tip = tip;

    const content = $("#characterContent");
    const anchorOf = (event) => event.target.closest?.("[data-tip]");
    const show = (anchor) => {
      tip.innerHTML = this.tooltips.get(anchor.dataset.tip) ?? "";
      tip.hidden = false;
      this.placeTip(anchor);
    };
    content.addEventListener("mouseover", (event) => {
      const anchor = anchorOf(event);
      if (anchor && !this.pinnedTip) show(anchor);
    });
    content.addEventListener("mouseout", (event) => {
      if (
        !this.pinnedTip &&
        anchorOf(event) &&
        !anchorOf(event).contains(event.relatedTarget)
      )
        tip.hidden = true;
    });
    content.addEventListener("focusin", (event) => {
      const anchor = anchorOf(event);
      if (anchor && !this.pinnedTip) show(anchor);
    });
    content.addEventListener("focusout", () => {
      if (!this.pinnedTip) tip.hidden = true;
    });
    document.addEventListener("click", (event) => {
      const anchor = anchorOf(event);
      if (anchor && content.contains(anchor)) {
        const wasPinned = this.pinnedTip === anchor;
        this.hideTip();
        if (wasPinned) return;
        this.pinnedTip = anchor;
        anchor.classList.add("pinned");
        show(anchor);
      } else if (this.pinnedTip && !tip.contains(event.target)) {
        this.hideTip();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.hideTip();
    });
    window.addEventListener(
      "scroll",
      () => {
        if (this.pinnedTip) this.placeTip(this.pinnedTip);
        else tip.hidden = true;
      },
      { passive: true },
    );
  }

  hideTip() {
    if (!this.tip) return;
    this.tip.hidden = true;
    this.pinnedTip?.classList.remove("pinned");
    this.pinnedTip = null;
  }

  /** Beside the anchor when there's room, otherwise below (or above) it; always inside the viewport. */
  placeTip(anchor) {
    const tip = this.tip;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth,
      height = tip.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth,
      viewportHeight = window.innerHeight;
    const gap = 10,
      pad = 8;
    let x, y;
    if (rect.right + gap + width <= viewportWidth - pad) {
      x = rect.right + gap;
      y = rect.top;
    } else if (rect.left - gap - width >= pad) {
      x = rect.left - gap - width;
      y = rect.top;
    } else {
      x = Math.min(Math.max(pad, rect.left), viewportWidth - width - pad);
      y = rect.bottom + gap;
      if (y + height > viewportHeight - pad) y = rect.top - gap - height;
    }
    y = Math.min(
      Math.max(pad, y),
      Math.max(pad, viewportHeight - height - pad),
    );
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
}

const GEAR_VIEW_KEY = "gw2ct.gearView";

function readGearView() {
  try {
    return localStorage.getItem(GEAR_VIEW_KEY) === "full" ? "full" : "icons";
  } catch {
    return "icons"; // storage blocked
  }
}

function saveGearView(view) {
  try {
    localStorage.setItem(GEAR_VIEW_KEY, view);
  } catch {
    /* private mode: kept for this page only */
  }
}

const account = createAccountSession();
mountSiteChrome({ page: "characters", account });
const page = new CharactersPage(account);
if (["localhost", "127.0.0.1"].includes(location.hostname))
  globalThis.gw2Characters = page; // console access while developing
page.start();
account.restore();
registerServiceWorker(); // a new release is picked up on the next visit
