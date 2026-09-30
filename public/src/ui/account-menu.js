import { escapeHtml } from "../utils/dom.js";

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
    const { status, accountName } = this.session;
    if (status === "ready") {
      this.slot.innerHTML = `<div class="account-menu">
        <button type="button" class="account-btn" data-account="toggle" aria-haspopup="menu" aria-expanded="false"
          title="Connected GW2 account">${escapeHtml(accountName)} ▾</button>
        <div class="account-pop" role="menu" hidden>
          <div class="muted small">Connected${this.session.keys.isRemembered() ? " · key saved in this browser" : " · key kept for this tab"}</div>
          <a role="menuitem" href="characters.html">Characters</a>
          <button type="button" role="menuitem" data-account="refresh">Refresh account data</button>
          <button type="button" role="menuitem" data-account="connect">Use a different key…</button>
          <button type="button" role="menuitem" data-account="forget">Forget key</button>
        </div></div>`;
    } else if (status === "connecting") {
      this.slot.innerHTML =
        '<span class="account-btn muted" role="status">Connecting…</span>';
    } else {
      this.slot.innerHTML = `<button type="button" class="account-btn" data-account="connect"${
        status === "error"
          ? ` title="${escapeHtml(this.session.error)}"><span class="account-warn" aria-hidden="true">!</span> Connect account`
          : ">Connect account"
      }</button>`;
    }
    if (this.dialog.open) this.#setBusy(status === "connecting");
  }

  #bind() {
    document.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-account]")?.dataset.account;
      const pop = this.slot.querySelector(".account-pop");
      if (action === "toggle") {
        const open = pop.hidden;
        pop.hidden = !open;
        this.slot
          .querySelector('[data-account="toggle"]')
          .setAttribute("aria-expanded", String(open));
        return;
      }
      if (pop && !pop.hidden && !this.slot.contains(event.target))
        pop.hidden = true;
      if (action === "connect") {
        if (pop) pop.hidden = true;
        this.openDialog();
      } else if (action === "refresh") this.session.refresh();
      else if (action === "forget") this.session.forget();
      else if (action === "close-dialog") this.dialog.close();
    });
    document.addEventListener("keydown", (event) => {
      const pop = this.slot.querySelector(".account-pop");
      if (event.key === "Escape" && pop && !pop.hidden) {
        pop.hidden = true;
        this.slot.querySelector('[data-account="toggle"]')?.focus();
      }
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
