import { activateOnEnterOrSpace, copyText, escapeHtml } from "../utils/dom.js";
import { formatCoinsHtml, formatQuantity, isCoin } from "../utils/format.js";
import { collectShoppingList } from "../model/craft-tree.js";

/** Side-panel "Shopping list" tab: every leaf of the visible tree, with trading-post totals. */
export class ShoppingListPanel {
  /**
   * @param {HTMLElement} element
   * @param {{ gameData: import('../data/game-data.js').GameData, settings: import('../core/settings-store.js').SettingsStore }} context
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
      if (entry.isFullyPriced) total += entry.totalCost;
      else if (!isCoin(entry.kind, entry.entityId)) unpricedCount++;
      return `<tr role="button" tabindex="0" data-kind="${entry.kind}" data-entity-id="${escapeHtml(entry.entityId)}">
        <td>${entity.icon ? `<img src="${escapeHtml(entity.icon)}" alt="" loading="lazy" decoding="async">` : ""}</td>
        <td><span style="color:${gameData.getEntityColor(entry.kind, entry.entityId)}">${escapeHtml(entity.name)}</span>${entry.isCraftable ? ' <span class="badge no" title="Craftable but collapsed">craftable</span>' : ""}</td>
        <td class="n">${escapeHtml(formatQuantity(entry.kind, entry.entityId, entry.quantity))}</td>
        ${showPrices ? `<td class="n">${entry.isFullyPriced ? formatCoinsHtml(entry.totalCost) : '<span class="muted">—</span>'}</td>` : ""}</tr>`;
    });
    const footer = showPrices
      ? `<tfoot><tr><td></td><td>Total${unpricedCount ? ` <span class="muted small">(${unpricedCount} unpriced)</span>` : ""}</td><td></td><td class="n">${formatCoinsHtml(total)}</td></tr></tfoot>`
      : "";
    this.element.innerHTML = `<p class="muted small">Leaf nodes of the current tree — collapse a node to buy it instead of crafting it.</p>
      <div class="btnrow"><button type="button" data-action="copy">Copy as text</button></div>
      <table class="mats"><tbody>${rows.join("")}</tbody>${footer}</table>`;
  }

  #handleClick(event) {
    if (event.target.closest('[data-action="copy"]')) {
      const { gameData } = this.context;
      const text = this.entries
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
