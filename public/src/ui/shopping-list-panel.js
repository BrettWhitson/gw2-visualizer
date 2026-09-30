import { EntityKind } from "../config/constants.js";
import { activateOnEnterOrSpace, copyText, escapeHtml } from "../utils/dom.js";
import {
  formatCoinsHtml,
  formatNumber,
  formatQuantity,
  isCoin,
} from "../utils/format.js";
import {
  collectMissingCraftingLevels,
  collectShoppingList,
  walkTree,
} from "../model/craft-tree.js";

/**
 * Side-panel "Shopping list" tab: every leaf of the visible tree, with trading-post totals. With a connected account
 * it lists what's still needed after owned items are used, and crafting levels no character has.
 */
export class ShoppingListPanel {
  /**
   * @param {HTMLElement} element
   * @param {{ gameData: import('../data/game-data.js').GameData, settings: import('../core/settings-store.js').SettingsStore,
   *           account?: import('../data/account-session.js').AccountSession }} context
   * @param {{ focusEntity(kind: string, entityId: string): void, notify(message: string): void }} actions
   */
  constructor(element, context, actions) {
    this.element = element;
    this.context = context;
    this.actions = actions;
    this.entries = [];
    element.addEventListener("click", (event) => this.#handleClick(event));
    element.addEventListener("keydown", (event) =>
      activateOnEnterOrSpace(event, (e) => this.#handleClick(e)),
    );
  }

  /** @param {import('../types.js').TreeNode | null} root */
  render(root) {
    if (!root) {
      this.element.innerHTML = "";
      return;
    }
    const { gameData, settings } = this.context;
    const showPrices = settings.values.priceBasis !== "off";
    this.entries = collectShoppingList(root);

    let total = 0,
      unpricedCount = 0;
    const rows = this.entries.map((entry) => {
      const entity = gameData.getEntity(entry.kind, entry.entityId);
      const isCovered = entry.quantity === 0 && entry.owned > 0;
      if (entry.isFullyPriced) total += entry.totalCost;
      else if (!isCoin(entry.kind, entry.entityId)) unpricedCount++;
      const quantity = isCovered
        ? '<span class="owned" title="Covered by what you own">✓</span>'
        : escapeHtml(
            formatQuantity(entry.kind, entry.entityId, entry.quantity),
          );
      const owned = entry.owned
        ? ` <span class="badge owned" title="Taken from what you own">have ${formatNumber(entry.owned)}</span>`
        : "";
      return `<tr role="button" tabindex="0" data-kind="${entry.kind}" data-entity-id="${escapeHtml(entry.entityId)}"${isCovered ? ' class="covered"' : ""}>
        <td>${entity.icon ? `<img src="${escapeHtml(entity.icon)}" alt="" loading="lazy" decoding="async">` : ""}</td>
        <td><span style="color:${gameData.getEntityColor(entry.kind, entry.entityId)}">${escapeHtml(entity.name)}</span>${entry.isCraftable && !isCovered ? ' <span class="badge no" title="Craftable but collapsed">craftable</span>' : ""}${owned}</td>
        <td class="n">${quantity}</td>
        ${showPrices ? `<td class="n">${isCovered ? "" : entry.isFullyPriced ? formatCoinsHtml(entry.totalCost) : '<span class="muted">—</span>'}</td>` : ""}</tr>`;
    });
    const footer = showPrices
      ? `<tfoot><tr><td></td><td>Total${unpricedCount ? ` <span class="muted small">(${unpricedCount} unpriced)</span>` : ""}</td><td></td><td class="n">${formatCoinsHtml(total)}</td></tr></tfoot>`
      : "";
    this.element.innerHTML = `${this.#accountHtml(root, showPrices)}
      <p class="muted small">Leaf nodes of the current tree — collapse a node to buy it instead of crafting it.</p>
      <div class="btnrow"><button type="button" data-action="copy">Copy as text</button></div>
      <table class="mats"><tbody>${rows.join("")}</tbody>${footer}</table>
      ${this.#craftingLevelsHtml(root)}`;
  }

  /** What the connected account contributes, or how to connect one. */
  #accountHtml(root, showPrices) {
    const { account, settings } = this.context;
    if (!account || account.status === "none" || account.status === "error")
      return '<p class="account-note muted small">Connect your account (top right) to subtract what you already own.</p>';
    if (account.status === "connecting")
      return '<p class="account-note muted small">Loading what your account owns…</p>';
    if (!settings.values.useOwned)
      return `<p class="account-note muted small">Not using what <b>${escapeHtml(account.accountName)}</b> owns: turn on <i>Use what I own</i> in the ribbon's Recipes section.</p>`;
    if (!account.has("inventories"))
      return '<p class="account-note muted small">Your API key lacks the <b>inventories</b> permission, so the bank, material storage and bags can\'t be read.</p>';

    let ownedUnits = 0,
      ownedValue = 0;
    walkTree(root, (node) => {
      ownedUnits += node.ownedQuantity ?? 0;
      ownedValue += node.ownedValue ?? 0;
    });
    return `<p class="account-note small">Using what <b>${escapeHtml(account.accountName)}</b> owns: ${
      ownedUnits
        ? `${formatNumber(ownedUnits)} items from your account${showPrices && ownedValue ? `, worth ${formatCoinsHtml(ownedValue)} at current prices` : ""}.`
        : "nothing in this tree."
    } <button type="button" class="linklike" data-action="refresh-account" title="The API updates account data every few minutes">Refresh</button></p>`;
  }

  #craftingLevelsHtml(root) {
    const missing = collectMissingCraftingLevels(root);
    if (!missing.length) return "";
    const { gameData } = this.context;
    const items = missing.map(({ options, itemIds }) => {
      const need = options
        .map(
          ({ discipline, rating, have }) =>
            `${escapeHtml(discipline)} ${rating} <span class="muted">(best ${have})</span>`,
        )
        .join(" or ");
      const names = [...itemIds]
        .map((id) => escapeHtml(gameData.getEntity(EntityKind.item, id).name))
        .join(", ");
      return `<li><span class="bad">${need}</span><br><span class="muted small">${names}</span></li>`;
    });
    return `<h4>Crafting levels you lack</h4><ul class="missing-levels">${items.join("")}</ul>`;
  }

  #handleClick(event) {
    if (event.target.closest('[data-action="refresh-account"]')) {
      this.context.account?.refresh();
      return;
    }
    if (event.target.closest('[data-action="copy"]')) {
      const { gameData } = this.context;
      const text = this.entries
        .filter((e) => e.quantity > 0)
        .map(
          (e) =>
            `${formatQuantity(e.kind, e.entityId, e.quantity)}\t${gameData.getEntity(e.kind, e.entityId).name}`,
        )
        .join("\n");
      copyText(text, "Shopping list copied", this.actions.notify);
      return;
    }
    const row = event.target.closest("tr[data-entity-id]");
    if (row) this.actions.focusEntity(row.dataset.kind, row.dataset.entityId);
  }
}
