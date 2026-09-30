import { escapeHtml } from "../utils/dom.js";
import { formatAge } from "../utils/format.js";
import {
  DataUpdates,
  getDataUpdates,
  setDataUpdates,
} from "../core/data-preferences.js";

/** Permissions worth granting, with what each unlocks here. `account` is always included by ArenaNet. */
const PERMISSIONS = [
  ["characters", "character list, crafting levels and bags"],
  ["builds", "equipped gear and templates"],
  ["inventories", "bank, material storage, shared slots and bags"],
  ["wallet", "currencies"],
  ["tradingpost", "items waiting for pickup"],
];

/**
 * The header's account control, the same on every page: "Connect account" opens a dialog for an API key; once
 * connected it shows the account name with a menu to refresh or forget the key. Driven by an AccountSession.
 */
export class AccountMenu {
  /**
   * @param {HTMLElement} slot  where the control goes in the header
   * @param {import('../data/account-session.js').AccountSession} session
   */
  constructor(slot, session) {
    this.slot = slot;
    this.session = session;
    document.body.insertAdjacentHTML("beforeend", dialogHtml());
    this.dialog = document.getElementById("accountDialog");
    this.#bind();
    session.addEventListener("change", () => this.render());
    this.render();
  }

  /** Open the connect dialog (also used by pages' own "Connect" buttons). */
  openDialog() {
    const form = this.dialog.querySelector("form");
    form.reset();
    form.elements.remember.checked = this.session.keys.isRemembered();
    this.#showError(this.session.status === "error" ? this.session.error : "");
    this.dialog.showModal();
    form.elements.apiKey.focus();
  }

  render() {
    const { status, accountName, fetchedAt, refreshing } = this.session;
    const wasOpen = this.slot.querySelector(".account-pop")?.hidden === false;
    // Rebuilding the control drops focus; put it back on the same control afterwards.
    const focusKey = focusKeyOf(this.slot, document.activeElement);
    if (status === "ready") {
      const mode = getDataUpdates();
      const age =
        fetchedAt != null
          ? ` · data from ${formatAge(Date.now() - fetchedAt)}`
          : "";
      // A disclosure panel, not an ARIA menu: it holds a radio group and uses plain Tab navigation.
      this.slot.innerHTML = `<div class="account-menu">
        <button type="button" class="account-btn" data-account="toggle" aria-expanded="${wasOpen}" aria-controls="accountPop"
          title="Connected GW2 account">${escapeHtml(accountName)}${refreshing ? " ⟳" : ""} ▾</button>
        <div class="account-pop" id="accountPop"${wasOpen ? "" : " hidden"}>
          <div class="muted small">Connected${this.session.keys.isRemembered() ? " · key saved in this browser" : " · key kept for this tab"}${escapeHtml(age)}</div>
          <a href="characters.html">Characters</a>
          <button type="button" data-account="refresh"${refreshing ? ' aria-disabled="true"' : ""}>${refreshing ? "Refreshing…" : "Refresh account data"}</button>
          <fieldset class="account-updates">
            <legend class="muted small">Update account data and prices</legend>
            <label title="Pages open instantly on what was saved"><input type="radio" name="dataUpdates" value="${DataUpdates.manual}"${mode === DataUpdates.manual ? " checked" : ""}> When I refresh</label>
            <label title="Saved data shows at once; anything older than a few minutes is refreshed in the background"><input type="radio" name="dataUpdates" value="${DataUpdates.auto}"${mode === DataUpdates.auto ? " checked" : ""}> Automatically</label>
          </fieldset>
          <button type="button" data-account="connect">Use a different key…</button>
          <button type="button" data-account="forget">Forget key</button>
        </div></div>`;
    } else if (status === "connecting") {
      this.slot.innerHTML =
        '<span class="account-btn muted" role="status">Connecting…</span>';
    } else if (status === "error" && this.session.key) {
      // A saved key the API couldn't be reached with (network, server error) is still there: offer to try it again.
      const retrying = this.#retrying;
      this.slot.innerHTML = `<div class="account-menu">
        <button type="button" class="account-btn" data-account="toggle" aria-expanded="${wasOpen}" aria-controls="accountPop"
          title="${escapeHtml(this.session.error)}"><span class="account-warn" aria-hidden="true">!</span> Account unavailable ▾</button>
        <div class="account-pop" id="accountPop"${wasOpen ? "" : " hidden"}>
          <div class="muted small">${escapeHtml(this.session.error)}</div>
          <button type="button" data-account="retry"${retrying ? ' aria-disabled="true"' : ""}>${retrying ? "Retrying…" : "Retry"}</button>
          <button type="button" data-account="connect">Connect account…</button>
          <button type="button" data-account="forget">Forget key</button>
        </div></div>`;
    } else {
      this.slot.innerHTML = `<button type="button" class="account-btn" data-account="connect"${
        status === "error"
          ? ` title="${escapeHtml(this.session.error)}"><span class="account-warn" aria-hidden="true">!</span> Connect account`
          : ">Connect account"
      }</button>`;
    }
    // The same control, or (when it's gone, e.g. Retry after reconnecting) the account button itself.
    if (focusKey)
      (
        this.slot.querySelector(focusKey) ??
        this.slot.querySelector("button.account-btn")
      )?.focus();
    if (this.dialog.open) this.#setBusy(status === "connecting");
  }

  #retrying = false;

  async #retry() {
    if (this.#retrying) return;
    this.#retrying = true;
    this.render();
    try {
      await this.session.refresh();
    } finally {
      this.#retrying = false;
      this.render();
    }
  }

  /** Show or hide the account panel, keeping the toggle's aria-expanded in step. */
  #setOpen(open) {
    const pop = this.slot.querySelector(".account-pop");
    if (!pop) return;
    pop.hidden = !open;
    this.slot
      .querySelector('[data-account="toggle"]')
      ?.setAttribute("aria-expanded", String(open));
  }

  #bind() {
    document.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-account]")?.dataset.account;
      const pop = this.slot.querySelector(".account-pop");
      if (action === "toggle") {
        this.#setOpen(pop.hidden);
        return;
      }
      if (pop && !pop.hidden && !this.slot.contains(event.target))
        this.#setOpen(false);
      if (action === "connect") {
        this.#setOpen(false);
        this.openDialog();
      } else if (action === "refresh") {
        if (!this.session.refreshing) this.session.refresh();
      } else if (action === "retry") this.#retry();
      else if (action === "forget") this.session.forget();
      else if (action === "close-dialog") this.dialog.close();
    });
    document.addEventListener("keydown", (event) => {
      const pop = this.slot.querySelector(".account-pop");
      if (event.key === "Escape" && pop && !pop.hidden) {
        this.#setOpen(false);
        this.slot.querySelector('[data-account="toggle"]')?.focus();
      }
    });
    this.slot.addEventListener("change", (event) => {
      if (event.target.name === "dataUpdates")
        setDataUpdates(event.target.value);
    });
    this.dialog
      .querySelector("form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.target;
        this.#showError("");
        const connected = await this.session.connect(
          form.elements.apiKey.value,
          {
            remember: form.elements.remember.checked,
          },
        );
        if (connected) this.dialog.close();
        else this.#showError(this.session.error);
      });
  }

  #showError(message) {
    this.dialog.querySelector(".key-error").textContent = message;
  }

  #setBusy(isBusy) {
    const submit = this.dialog.querySelector('button[type="submit"]');
    submit.disabled = isBusy;
    submit.textContent = isBusy ? "Connecting…" : "Connect";
  }
}

/** A selector that finds `element` again after the slot is rebuilt, or null when focus isn't in the slot. */
function focusKeyOf(slot, element) {
  if (!element || !slot.contains(element)) return null;
  if (element.dataset.account)
    return `[data-account="${element.dataset.account}"]`;
  if (element.name === "dataUpdates")
    return `input[name="dataUpdates"][value="${element.value}"]`;
  if (element.matches('a[href="characters.html"]'))
    return 'a[href="characters.html"]';
  return null;
}

function dialogHtml() {
  const permissions = PERMISSIONS.map(
    ([name, use]) => `<li><b>${name}</b>: ${use}</li>`,
  ).join("");
  return `<dialog id="accountDialog" class="account-dialog" aria-labelledby="accountDialogTitle">
    <h2 id="accountDialogTitle">Connect your Guild Wars 2 account</h2>
    <p>Paste an API key from
      <a href="https://account.arena.net/applications" target="_blank" rel="noopener noreferrer">account.arena.net/applications</a>.
      Grant what you want to use here:</p>
    <ul class="small">${permissions}</ul>
    <form class="key-form" autocomplete="off">
      <label for="accountApiKey" class="sr-only">API key</label>
      <input id="accountApiKey" name="apiKey" type="password" spellcheck="false" placeholder="XXXXXXXX-XXXX-…" autocomplete="off" required>
      <label class="remember"><input name="remember" type="checkbox"> Remember in this browser</label>
      <button type="submit" class="primary">Connect</button>
    </form>
    <p class="key-error" role="alert"></p>
    <p class="muted small">The key stays in this browser (kept only for this tab unless you tick Remember) and is sent
      only to the official API at api.guildwars2.com. Keys are read-only and can be revoked at any time.</p>
    <div class="btnrow"><button type="button" data-account="close-dialog">Cancel</button></div>
  </dialog>`;
}
