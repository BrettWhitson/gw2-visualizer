/**
 * Entry point for the Characters page: connect an account → character list → one character's armory (`#<name>`).
 * The account comes from the shared AccountSession (the header's account control connects, refreshes and forgets).
 */
import { CACHE_DB_NAME } from "./config/constants.js";
import { CharacterCatalogs } from "./data/account-client.js";
import { IndexedDbStore } from "./data/indexed-db-store.js";
import { createAccountSession } from "./data/site-account.js";
import { activeBuild, buildArmory } from "./model/character-armory.js";
import {
  armoryHtml,
  characterListHtml,
  MISSING_BUILDS_NOTICE,
} from "./ui/character-view.js";
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
  /** The anchor whose hover/focus tooltip is showing (it points at the tip with aria-describedby). */
  describedTip = null;
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
  /** The account `choices` belong to: another account's template or weapon set means nothing here. */
  #choicesAccount = null;

  #onAccountChange() {
    const { status, error, accountName, fetchedAt } = this.account;
    // A background refresh starting (or failing) changes nothing drawn: redraw only for new data.
    const current = `${status}|${accountName}|${fetchedAt}|${error}`;
    if (current === this.#shownAccount) return;
    const sameAccount =
      this.#shownAccount?.startsWith(`ready|${accountName}|`) ?? false;
    this.#shownAccount = current;
    if (status === "ready") {
      $("#keyPanel").hidden = true;
      $("#keyForm").reset(); // connected: the key mustn't linger in the form
      if (accountName !== this.#choicesAccount) {
        this.choices.clear();
        this.#choicesAccount = accountName;
      }
      if (this.account.charactersUnavailable) {
        this.#showMessage(
          `Your characters couldn't be loaded: the GW2 API didn't answer. <button type="button" id="retryCharacters">Try again</button>`,
        );
        $("#retryCharacters")?.addEventListener("click", () =>
          this.account.refresh(),
        );
        return;
      }
      if (!this.characters) {
        this.#showMessage(
          "This API key doesn't have the <b>characters</b> permission. Use the account menu at the top right to connect a key with <b>characters</b> and <b>builds</b>.",
        );
        return;
      }
      // Fresh data for the account already shown: redraw in place, keeping focus and scroll.
      this.render({ inPlace: sameAccount });
    } else if (status === "connecting") {
      this.#invalidate();
      $("#keyPanel").hidden = true;
      this.setContent('<p class="loading">Connecting to your account…</p>');
      this.announce("Connecting to your account…");
    } else {
      this.showKeyPanel(status === "error" ? error : "");
    }
  }

  #showMessage(html) {
    this.#invalidate();
    this.setContent(`<p class="notice">${html}</p>`);
    this.announce($("#characterContent").textContent);
  }

  /** Any view change: an armory still loading must not draw over what replaced it. */
  #invalidate() {
    return ++this.renderToken;
  }

  /** Loading and error messages for screen readers; the content area itself isn't a live region. */
  announce(text) {
    $("#characterStatus").textContent = text;
  }

  /**
   * The key form; view choices are dropped with the account they belonged to. A rejected key stays in the form so a
   * typo can be fixed; otherwise (forgotten, never connected) the form is cleared.
   */
  showKeyPanel(error = "") {
    this.#invalidate();
    this.choices.clear();
    this.#choicesAccount = null;
    if (!error) $("#keyForm").reset();
    $("#keyPanel").hidden = false;
    this.setContent("");
    this.announce("");
    $("#keyError").textContent = error;
  }

  /** `inPlace`: the data is already loaded (a toggle or a refresh), so keep what's shown, focus and scroll. */
  render({ inPlace = false } = {}) {
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
    if (character) this.renderArmory(character, { inPlace });
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
    const notice = !this.account.has("builds") ? MISSING_BUILDS_NOTICE : "";
    this.setContent(
      notice + characterListHtml(summaries, this.account.accountName),
    );
    this.announce("");
  }

  async renderArmory(character, { inPlace = false } = {}) {
    const token = this.#invalidate();
    const restore = inPlace ? this.#captureFocus() : null;
    if (!inPlace) {
      const loading = `Loading ${character.name}'s gear…`;
      this.setContent(`<p class="loading">${escapeHtml(loading)}</p>`);
      this.announce(loading);
    }
    try {
      await this.catalogs.loadFor(character);
      if (token !== this.renderToken) return; // the user moved on while this loaded

      const choice = this.choices.get(character.name) ?? {};
      const armory = buildArmory(character, this.catalogs, choice.tab ?? null);
      const weaponSet = choice.weaponSet ?? armory.defaultSet;
      const { html, tooltips } = armoryHtml(armory, weaponSet, {
        view: this.gearView,
        // Without `builds` there's no equipment to show: say so instead of drawing empty slots and base stats.
        hasGear: this.account.has("builds"),
      });
      this.tooltips = tooltips;
      this.setContent(html);
      this.announce("");
      restore?.();

      const content = $("#characterContent");
      // A toggle redraws in place from the loaded data, keeping focus on the control and the scroll position.
      const choose = (change) => {
        this.choices.set(character.name, {
          ...choice,
          tab: armory.tab,
          ...change,
        });
        this.render({ inPlace: true });
      };
      content
        .querySelectorAll("[data-tab]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            choose({ tab: Number(button.dataset.tab) }),
          ),
        );
      content
        .querySelector("[data-share-open]")
        ?.addEventListener("click", () =>
          openShareDialog(
            armory,
            this.gearView === "full" ? "full" : "compact",
          ),
        );
      content.querySelectorAll("[data-gear-view]").forEach((button) =>
        button.addEventListener("click", () => {
          this.gearView = button.dataset.gearView;
          saveGearView(this.gearView);
          choose({});
        }),
      );
      content
        .querySelectorAll("[data-weapon-set]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            choose({ weaponSet: button.dataset.weaponSet }),
          ),
        );
    } catch (error) {
      if (token === this.renderToken) {
        const message = `Couldn't show ${character.name}'s gear: ${error.message}`;
        this.setContent(`<p class="empty">${escapeHtml(message)}</p>`);
        this.announce(message);
      }
    }
  }

  /**
   * Remembers the focused view control (by its data-tab / data-weapon-set / data-gear-view value and position) and
   * the scroll position; the returned function restores both once the armory has been redrawn.
   */
  #captureFocus() {
    const content = $("#characterContent");
    const { scrollX, scrollY } = window;
    const active = document.activeElement;
    const attribute = ["data-tab", "data-weapon-set", "data-gear-view"].find(
      (name) => content.contains(active) && active.hasAttribute(name),
    );
    let selector = null,
      index = -1;
    if (attribute) {
      selector = `[${attribute}="${CSS.escape(active.getAttribute(attribute))}"]`;
      // Set 1/2 and the weapon-set titles share a value: the position tells them apart.
      index = [...content.querySelectorAll(selector)].indexOf(active);
    }
    return () => {
      const control = selector && content.querySelectorAll(selector)[index];
      control?.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
    };
  }

  setContent(html) {
    this.hideTip();
    $("#characterContent").innerHTML = html;
  }

  // ---------------------------------------------------------------- tooltips

  /**
   * Hover or focus shows a tooltip (text only: its links read as plain text); click, tap or Enter pins it as a
   * non-modal dialog whose links work. Pinned from the keyboard, focus moves into it; Escape (or tabbing out) closes
   * it and returns focus to the button. A click elsewhere dismisses it.
   */
  bindTooltips() {
    const tip = document.createElement("div");
    tip.className = "gear-tip";
    tip.id = "gearTip";
    tip.hidden = true;
    document.body.append(tip);
    this.tip = tip;

    const content = $("#characterContent");
    const anchorOf = (event) => event.target.closest?.("[data-tip]");
    content.addEventListener("mouseover", (event) => {
      const anchor = anchorOf(event);
      if (anchor && !this.pinnedTip) this.showTip(anchor);
    });
    content.addEventListener("mouseout", (event) => {
      if (
        !this.pinnedTip &&
        anchorOf(event) &&
        !anchorOf(event).contains(event.relatedTarget)
      )
        this.hideTip();
    });
    content.addEventListener("focusin", (event) => {
      const anchor = anchorOf(event);
      if (anchor && !this.pinnedTip) this.showTip(anchor);
    });
    content.addEventListener("focusout", () => {
      if (!this.pinnedTip) this.hideTip();
    });
    document.addEventListener("click", (event) => {
      const anchor = anchorOf(event);
      if (anchor && content.contains(anchor)) {
        const wasPinned = this.pinnedTip === anchor;
        this.hideTip();
        if (wasPinned) return;
        // A click without a pointer (detail 0) is Enter or Space on the button.
        this.showTip(anchor, { pinned: true, focus: event.detail === 0 });
      } else if (this.pinnedTip && !tip.contains(event.target)) {
        this.hideTip();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !tip.hidden) this.#closeTip();
      else if (event.key === "Tab" && tip.contains(event.target)) {
        const links = [...tip.querySelectorAll("a[href]")];
        const leaving = event.shiftKey
          ? event.target === tip || event.target === links[0]
          : !links.length || event.target === links.at(-1);
        if (leaving) {
          event.preventDefault();
          this.#closeTip();
        }
      }
    });
    tip.addEventListener("focusout", (event) => {
      const to = event.relatedTarget;
      if (this.pinnedTip && to && !tip.contains(to) && to !== this.pinnedTip)
        this.hideTip();
    });
    window.addEventListener(
      "scroll",
      () => {
        if (this.pinnedTip) this.placeTip(this.pinnedTip);
        else this.hideTip();
      },
      { passive: true },
    );
  }

  /** Hover or focus: a tooltip describing `anchor`. Pinned: a non-modal dialog, focused when `focus`. */
  showTip(anchor, { pinned = false, focus = false } = {}) {
    const tip = this.tip;
    tip.innerHTML = this.tooltips.get(anchor.dataset.tip) ?? "";
    if (pinned) {
      this.pinnedTip = anchor;
      anchor.classList.add("pinned");
      if (anchor.hasAttribute("aria-expanded"))
        anchor.setAttribute("aria-expanded", "true");
      tip.setAttribute("role", "dialog");
      tip.setAttribute(
        "aria-label",
        anchor.getAttribute("aria-label") || anchor.textContent.trim(),
      );
      tip.tabIndex = -1;
    } else {
      // A tooltip can't hold interactive content: its links read as text until it's pinned.
      for (const link of tip.querySelectorAll("a")) {
        const text = document.createElement("span");
        text.className = link.className;
        text.textContent = link.textContent;
        link.replaceWith(text);
      }
      tip.setAttribute("role", "tooltip");
      tip.removeAttribute("aria-label");
      tip.removeAttribute("tabindex");
      anchor.setAttribute("aria-describedby", tip.id);
      this.describedTip = anchor;
    }
    tip.hidden = false;
    this.placeTip(anchor);
    if (focus) (tip.querySelector("a[href]") ?? tip).focus();
  }

  /** Escape or tabbing out: close, and hand focus back to the button if it was inside the tip. */
  #closeTip() {
    const anchor = this.pinnedTip;
    const focusWasInTip = this.tip.contains(document.activeElement);
    this.hideTip();
    if (anchor && focusWasInTip) anchor.focus();
  }

  hideTip() {
    if (!this.tip) return;
    this.tip.hidden = true;
    this.describedTip?.removeAttribute("aria-describedby");
    this.describedTip = null;
    if (this.pinnedTip?.hasAttribute("aria-expanded"))
      this.pinnedTip.setAttribute("aria-expanded", "false");
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
