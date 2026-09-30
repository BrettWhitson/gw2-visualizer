/**
 * Entry point for the Characters page: API key → character list → one character's armory (`#<name>`).
 */
import { ARENANET_NOTICE } from "./config/constants.js";
import { ApiKeyStore } from "./core/api-key-store.js";
import {
  AccountClient,
  CHARACTER_SCOPES,
  CharacterCatalogs,
  looksLikeApiKey,
} from "./data/account-client.js";
import { activeBuild, buildArmory } from "./model/character-armory.js";
import { armoryHtml, characterListHtml } from "./ui/character-view.js";
import { escapeHtml, querySelector as $ } from "./utils/dom.js";
import { registerServiceWorker } from "./pwa.js";

class CharactersPage {
  keys = new ApiKeyStore();
  catalogs = new CharacterCatalogs();
  /** @type {object[] | null} raw /v2/characters entries */
  characters = null;
  accountName = null;
  /** Per-character view choices, kept while the page is open. */
  choices = new Map();
  tooltips = new Map();
  pinnedTip = null;
  renderToken = 0;

  start() {
    $("#pageFooter").textContent = ARENANET_NOTICE;
    $("#keyForm").addEventListener("submit", (event) => {
      event.preventDefault();
      this.connect($("#apiKey").value, $("#rememberKey").checked);
    });
    $("#changeKey").addEventListener("click", () => this.showKeyPanel());
    $("#forgetKey").addEventListener("click", () => {
      this.keys.clear();
      this.showKeyPanel();
    });
    window.addEventListener("hashchange", () => this.render());
    this.bindTooltips();

    const saved = this.keys.get();
    if (saved) this.connect(saved, true, { saved: true });
    else this.showKeyPanel();
  }

  /** Any view change: an armory still loading must not draw over what replaced it. */
  #invalidate() {
    return ++this.renderToken;
  }

  /** Back to the key form; the previous account's data is dropped so nothing of it can reappear. */
  showKeyPanel(error = "", { keepInput = false } = {}) {
    this.#invalidate();
    this.characters = null;
    this.accountName = null;
    this.choices.clear();
    $("#keyPanel").hidden = false;
    $("#keyStatus").hidden = true;
    this.setContent("");
    $("#keyError").textContent = error;
    if (!keepInput) $("#apiKey").value = "";
    $("#apiKey").focus();
  }

  async connect(rawKey, remember, { saved = false } = {}) {
    const key = rawKey.trim();
    if (!looksLikeApiKey(key)) {
      this.showKeyPanel(
        "That doesn't look like a GW2 API key: it should be 72 characters of letters, digits and hyphens.",
        { keepInput: true },
      );
      return;
    }
    const token = this.#invalidate();
    $("#keyPanel").hidden = true;
    this.setContent('<p class="loading">Connecting to your account…</p>');
    const client = new AccountClient(key);
    let account, characters, missing;
    try {
      const info = await client.tokenInfo();
      missing = CHARACTER_SCOPES.filter(
        (scope) => !info.permissions?.includes(scope),
      );
      if (missing.includes("characters")) {
        if (saved) this.keys.clear();
        this.showKeyPanel(
          `This key doesn't have the characters permission. Create a key with: ${CHARACTER_SCOPES.join(", ")}.`,
        );
        return;
      }
      [account, characters] = await Promise.all([
        client.account(),
        client.characters(),
        this.catalogs.loadSpecializations(),
      ]);
    } catch (error) {
      if (token !== this.renderToken) return;
      // The API answers an invalid key with 400, a deleted one with 401 / 403.
      const rejected = [400, 401, 403].includes(error.status);
      if (rejected && saved) this.keys.clear();
      this.showKeyPanel(
        rejected
          ? "The API rejected this key. It may have been deleted, or mistyped."
          : `Couldn't reach the Guild Wars 2 API (${error.message}). Try again in a moment.`,
      );
      return;
    }
    if (token !== this.renderToken) return; // the key form was reopened meanwhile
    this.keys.set(key, { remember });
    this.accountName = account.name;
    this.characters = characters;
    this.missingScopes = missing;
    $("#keyAccount").textContent = this.accountName;
    $("#keyStatus").hidden = false;
    this.render();
  }

  render() {
    if (!this.characters) return;
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

  renderList() {
    const summaries = this.characters.map((character) => ({
      ...character,
      build: activeBuild(character, this.catalogs.specializations),
    }));
    const notice = this.missingScopes?.includes("builds")
      ? '<p class="notice">This key lacks the <b>builds</b> permission, so equipment templates and build specializations are unavailable.</p>'
      : "";
    this.setContent(notice + characterListHtml(summaries, this.accountName));
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
      const { html, tooltips } = armoryHtml(armory, weaponSet);
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

const page = new CharactersPage();
if (["localhost", "127.0.0.1"].includes(location.hostname))
  globalThis.gw2Characters = page; // console access while developing
page.start();
registerServiceWorker(); // a new release is picked up on the next visit
