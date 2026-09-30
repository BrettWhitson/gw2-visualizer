import { EntityKind } from "../config/constants.js";
import { rootEconomics } from "../model/root-economics.js";
import { formatCoinsHtml } from "../utils/format.js";

/**
 * The strip over the graph's top-right corner: the root item's craft cost, what buying it on the Trading Post costs,
 * what selling it brings after fees, and the profit or loss with its margin.
 */
export class KpiStrip {
  #element;
  #priceBook;
  #settings;

  /**
   * @param {HTMLElement} element
   * @param {{ priceBook: import('../data/price-book.js').PriceBook,
   *           settings: import('../core/settings-store.js').SettingsStore }} context
   */
  constructor(element, { priceBook, settings }) {
    this.#element = element;
    this.#priceBook = priceBook;
    this.#settings = settings;
  }

  /** @param {import('../types.js').TreeNode | null} tree  the root of the drawn tree, or null for none */
  render(tree) {
    const show =
      this.#settings.values.showKpiStrip &&
      !!tree &&
      tree.kind === EntityKind.item &&
      this.#settings.values.priceBasis !== "off";
    this.#element.hidden = !show;
    if (!show) return;

    const quote = this.#priceBook.getQuote(tree.entityId);
    const figures = rootEconomics({
      craftCost: tree.craftCost ?? tree.effectiveCost,
      sellPrice: quote?.sell || null,
      quantity: tree.quantity,
    });
    const coins = (copper) =>
      copper == null ? '<span class="muted">—</span>' : formatCoinsHtml(copper);
    const partial = tree.isCraftCostPartial
      ? ' <span class="muted" title="Some ingredients have no price">(partial)</span>'
      : "";
    const cell = (label, value, tone = "") =>
      `<div class="kpi${tone}"><span>${label}</span><b>${value}</b></div>`;

    if (figures.buyNow == null) {
      const unknown =
        quote || this.#priceBook.fetchFailed(tree.entityId)
          ? "not sold there"
          : "loading prices…";
      this.#element.innerHTML =
        cell("Craft cost", coins(figures.craftCost) + partial) +
        cell("Trading Post", `<span class="muted">${unknown}</span>`);
      return;
    }
    const tone =
      figures.profit == null ? "" : figures.profit >= 0 ? " up" : " down";
    const margin =
      figures.margin == null
        ? ""
        : ` <i class="kpi-chip${tone}">${figures.margin >= 0 ? "+" : "−"}${Math.abs(figures.margin * 100).toFixed(0)}%</i>`;
    this.#element.innerHTML =
      cell("Craft cost", coins(figures.craftCost) + partial) +
      cell("Buy on TP", coins(figures.buyNow)) +
      cell("Sell after fees", coins(figures.sellNet)) +
      cell(
        figures.profit != null && figures.profit < 0 ? "Loss" : "Profit",
        (figures.profit == null
          ? coins(null)
          : coins(Math.abs(figures.profit))) + margin,
        tone,
      );
  }
}
