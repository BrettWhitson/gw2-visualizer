import { EntityKind, RecipeSource } from "../config/constants.js";
import { escapeHtml } from "../utils/dom.js";
import {
  formatCoinsHtml,
  formatNumber,
  formatQuantity,
} from "../utils/format.js";
import { isForgeResult } from "../model/graph-model.js";
import {
  FORGE_CHIP_HTML,
  entitySubtitle,
  entityIcon,
  accountRows,
  definitionList,
} from "./html-fragments.js";

const CURSOR_OFFSET_PX = 16;
const VIEWPORT_MARGIN_PX = 8;

/** Hover card for graph nodes; follows the cursor and flips to stay on screen. */
export class Tooltip {
  #size = { width: 0, height: 0 };

  /**
   * @param {HTMLElement} element
   * @param {{ gameData: import('../data/game-data.js').GameData, priceBook: import('../data/price-book.js').PriceBook,
   *           settings: import('../core/settings-store.js').SettingsStore }} context
   */
  constructor(element, context) {
    this.element = element;
    this.context = context;
  }

  /** @param {import('../types.js').GraphNode} node  @param {MouseEvent} [pointerEvent] */
  show(node, pointerEvent) {
    this.element.innerHTML = this.#buildHtml(node);
    this.element.hidden = false;
    // Measure once per show; reading offsetWidth on every mousemove would force layout.
    this.#size = {
      width: this.element.offsetWidth,
      height: this.element.offsetHeight,
    };
    this.moveTo(pointerEvent);
  }

  hide() {
    this.element.hidden = true;
  }

  moveTo(pointerEvent) {
    if (this.element.hidden || !pointerEvent) return;
    const { width, height } = this.#size;
    let left = pointerEvent.clientX + CURSOR_OFFSET_PX,
      top = pointerEvent.clientY + CURSOR_OFFSET_PX;
    if (left + width > innerWidth - VIEWPORT_MARGIN_PX)
      left = pointerEvent.clientX - width - CURSOR_OFFSET_PX;
    if (top + height > innerHeight - VIEWPORT_MARGIN_PX)
      top = Math.max(
        VIEWPORT_MARGIN_PX,
        pointerEvent.clientY - height - CURSOR_OFFSET_PX,
      );
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  #buildHtml(node) {
    const { gameData, priceBook, settings } = this.context;
    const entity = gameData.getEntity(node.kind, node.entityId);
    const color = gameData.getEntityColor(node.kind, node.entityId);
    const recipe = node.recipe;
    const rows = [];

    rows.push([
      "Needed",
      `<b>${escapeHtml(formatQuantity(node.kind, node.entityId, node.quantity))}</b>` +
        (node.occurrenceCount > 1
          ? ` <span class="muted">(${node.occurrenceCount} places)</span>`
          : ""),
    ]);
    if (recipe) {
      rows.push([
        "Recipe",
        escapeHtml(recipe.disciplines.join(", ") || recipe.type) +
          (recipe.minRating ? ` · ${recipe.minRating}` : "") +
          (recipe.source === RecipeSource.custom ? " · <i>custom</i>" : "") +
          (recipe.isPromotion ? " · <i>promotion</i>" : ""),
      ]);
      rows.push([
        "Crafts",
        `${formatNumber(node.craftCount)} × (makes ${recipe.outputCount})`,
      ]);
      if (node.alternativeRecipeCount > 1)
        rows.push([
          "Recipes",
          `${node.recipeIndex + 1} of ${node.alternativeRecipeCount} <span class="muted">(right-click to cycle)</span>`,
        ]);
      if (
        recipe.source !== RecipeSource.mysticForge &&
        gameData.hasForgeRecipe(node.entityId)
      )
        rows.push([
          "",
          '<span class="mfc">&#10022; Mystic Forge recipe also available</span>',
        ]);
    }

    const priceBasis = settings.values.priceBasis;
    if (priceBasis !== "off" && node.kind === EntityKind.item) {
      const unitPrice = priceBook.getUnitPrice(node.entityId, priceBasis);
      const unitHtml =
        unitPrice != null
          ? formatCoinsHtml(unitPrice)
          : priceBook.has(node.entityId)
            ? '<span class="muted">not tradeable</span>'
            : '<span class="muted">loading…</span>';
      rows.push(["TP unit", unitHtml]);
      if (node.buyCost != null)
        rows.push([
          node.ownedQuantity ? "Buy the rest" : "Buy all",
          formatCoinsHtml(node.buyCost),
        ]);
      if (node.hasChildren && node.craftCost != null)
        rows.push([
          "Craft cost",
          formatCoinsHtml(node.craftCost) +
            (node.isCostComplete
              ? ""
              : ' <span class="muted">(partial)</span>'),
        ]);
      if (node.isBuyCheaper)
        rows.push([
          "",
          '<span class="good">Buying is cheaper than crafting</span>',
        ]);
    }

    rows.push(
      ...accountRows(node, this.context.account, settings.values.useOwned),
    );

    const hints = [];
    if (node.isOwnedEnough)
      hints.push("You own enough: its ingredients aren't needed");
    else if (node.isCollapsed) hints.push("Double-click to expand");
    else if (node.hasChildren) hints.push("Double-click to collapse");
    if (node.isCycle) hints.push("Recursive recipe — not expanded");
    if (node.kind === EntityKind.item && !node.isRoot)
      hints.push("Shift+click to make root");

    return `<div class="th">${entityIcon(entity, color)}
      <div><b style="color:${color}">${escapeHtml(entity.name)}</b>${isForgeResult(node) ? " " + FORGE_CHIP_HTML : ""}
      <div class="muted small">${entitySubtitle(entity, node.kind)}</div></div></div>
      ${definitionList(rows)}
      ${hints.length ? `<div class="hint">${hints.join(" · ")}</div>` : ""}`;
  }
}
