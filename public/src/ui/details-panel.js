import {
  EntityKind,
  GW2_WIKI_SEARCH_URL,
  INGREDIENT_TYPE_TO_KIND,
  RARITY_COLORS,
  RecipeSource,
} from "../config/constants.js";
import { activateOnEnterOrSpace, copyText, escapeHtml } from "../utils/dom.js";
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
  definitionList,
} from "./html-fragments.js";

const MAX_USED_IN_ROWS = 60;

/**
 * Side-panel "Details" tab for the selected node: pricing, actions, the chosen recipe and "Used in".
 * User actions are forwarded to the app through `actions`.
 */
export class DetailsPanel {
  /**
   * @param {HTMLElement} element
   * @param {{ gameData: import('../data/game-data.js').GameData, priceBook: import('../data/price-book.js').PriceBook,
   *           settings: import('../core/settings-store.js').SettingsStore }} context
   * @param {{ openItem(itemId: number): void, toggleCollapsed(nodeId: string): void, cycleRecipe(nodeId: string, step: number): void,
   *           focusEntity(kind: string, entityId: string): void, notify(message: string): void }} actions
   */
  constructor(element, context, actions) {
    this.element = element;
    this.context = context;
    this.actions = actions;
    element.addEventListener("click", (event) => this.#handleClick(event));
    element.addEventListener("keydown", (event) =>
      activateOnEnterOrSpace(event, (e) => this.#handleClick(e)),
    );
  }

  /** @param {import('../types.js').GraphNode | null} node */
  render(node) {
    this.node = node;
    if (!node) {
      this.element.innerHTML =
        '<p class="muted">Click a node to see details.</p>';
      return;
    }
    const { gameData } = this.context;
    const entity = gameData.getEntity(node.kind, node.entityId);
    const color = gameData.getEntityColor(node.kind, node.entityId);
    this.entity = entity;
    this.element.innerHTML = [
      `<div class="det-head">${entityIcon(entity, color)}
        <div><h3 style="color:${color}">${escapeHtml(entity.name)}</h3>${isForgeResult(node) ? FORGE_CHIP_HTML : ""}
        <div class="muted">${entitySubtitle(entity, node.kind, { levelPrefix: "Level " })}</div>
        <div class="muted small">ID ${escapeHtml(node.entityId)}${entity.chatLink ? " · " + escapeHtml(entity.chatLink) : ""}</div></div></div>`,
      this.#pricingHtml(node),
      this.#actionButtonsHtml(node, entity),
      node.recipe ? this.#recipeHtml(node) : "",
      node.kind === EntityKind.item ? this.#usedInHtml(node.entityId) : "",
    ].join("");
  }

  #pricingHtml(node) {
    const { priceBook, settings } = this.context;
    const rows = [
      ["Source", this.#sourcesHtml(node)],
      [
        "Needed",
        `<b>${escapeHtml(formatQuantity(node.kind, node.entityId, node.quantity))}</b>${node.occurrenceCount > 1 ? ` (${node.occurrenceCount} places)` : ""}`,
      ],
    ];
    if (node.kind === EntityKind.item && settings.values.priceBasis !== "off") {
      const quote = priceBook.getQuote(node.entityId);
      if (quote)
        rows.push([
          "TP buy / sell",
          `${formatCoinsHtml(quote.buy)} / ${formatCoinsHtml(quote.sell)}`,
        ]);
      if (node.buyCost != null)
        rows.push(["Buy all", formatCoinsHtml(node.buyCost)]);
      if (node.hasChildren && node.craftCost != null) {
        rows.push([
          "Craft cost",
          formatCoinsHtml(node.craftCost) +
            (node.isCostComplete
              ? ""
              : ' <span class="muted">(partial)</span>'),
        ]);
        if (node.buyCost != null && node.isCostComplete) {
          const savings = node.buyCost - node.craftCost;
          rows.push([
            savings >= 0 ? "Crafting saves" : "Buying saves",
            `<span class="${savings >= 0 ? "good" : "bad"}">${formatCoinsHtml(Math.abs(savings))}</span>`,
          ]);
        }
      }
    }
    return definitionList(rows);
  }

  /**
   * Every way to obtain the entity, as chips with a hover card of details: crafting (disciplines, rating, how the
   * recipe is learned), Mystic Forge and promotion recipes, custom recipes, the trading post, and from the wiki,
   * vendors and containers. The way this tree uses is ticked.
   */
  #sourcesHtml(node) {
    const { gameData, priceBook, settings, wikiSources } = this.context;
    if (node.kind === EntityKind.currency)
      return sourceChip({ label: "Wallet currency" });
    if (node.kind === EntityKind.guildUpgrade)
      return sourceChip({ label: "Guild hall upgrade" });
    if (node.kind === EntityKind.named)
      return sourceChip({ label: "Any matching item" });

    const itemId = node.entityId;
    const chips = [];
    const recipes = gameData.getRecipes(itemId);
    const usedRecipe = node.hasChildren ? node.recipe : null;
    const recipeLines = (list) =>
      list.map((recipe) =>
        this.#recipeSummaryHtml(recipe, recipe === usedRecipe),
      );

    const craftRecipes = recipes.filter((r) => r.source === RecipeSource.api);
    if (craftRecipes.length) {
      const disciplines = [
        ...new Set(craftRecipes.flatMap((r) => r.disciplines)),
      ];
      const rating = Math.min(...craftRecipes.map((r) => r.minRating));
      chips.push({
        label: `Crafting: ${disciplines.join(", ") || "any"}${rating ? ` (${rating})` : ""}`,
        isUsed: usedRecipe?.source === RecipeSource.api,
        details: recipeLines(craftRecipes),
      });
    }
    const forgeRecipes = recipes.filter(
      (r) => r.source === RecipeSource.mysticForge,
    );
    const forgeResults = forgeRecipes.filter((r) => !r.isPromotion);
    const promotions = forgeRecipes.filter((r) => r.isPromotion);
    if (forgeResults.length)
      chips.push({
        label:
          forgeResults.length > 1
            ? `Mystic Forge (${forgeResults.length})`
            : "Mystic Forge",
        className: "mfc",
        isUsed: forgeResults.includes(usedRecipe),
        details: recipeLines(forgeResults),
      });
    if (promotions.length)
      chips.push({
        label: "Forge promotion",
        className: "mfc",
        isUsed: promotions.includes(usedRecipe),
        details: recipeLines(promotions),
      });
    const customRecipes = recipes.filter(
      (r) => r.source === RecipeSource.custom,
    );
    if (customRecipes.length)
      chips.push({
        label: "Custom recipe",
        isUsed: customRecipes.includes(usedRecipe),
        details: recipeLines(customRecipes),
      });

    const quote = priceBook.getQuote(itemId);
    if (quote && (quote.buy || quote.sell))
      chips.push({
        label: "Trading post",
        isUsed: !node.hasChildren,
        details: [
          `Instant buy (lowest sell listing): ${formatCoinsHtml(quote.sell)}`,
          `Buy order (highest bid): ${formatCoinsHtml(quote.buy)}`,
        ],
      });

    if (settings.values.wikiSources) {
      const wiki = wikiSources.peek(itemId);
      if (wiki === undefined) {
        chips.push({ label: "Checking the wiki…", className: "pending" });
        wikiSources.load(itemId).then(() => {
          if (this.node?.entityId === itemId) this.render(this.node);
        });
      } else if (wiki) {
        chips.push(...this.#wikiChips(wiki));
      }
    }

    const flags = gameData.getEntity(node.kind, itemId).flags;
    const isBound =
      flags.includes("AccountBound") || flags.includes("SoulbindOnAcquire");
    if (!quote?.buy && !quote?.sell && (isBound || !chips.length))
      chips.push({
        label: isBound
          ? "Account bound (not tradeable)"
          : "Not on the trading post",
        className: "note",
        details: [
          isBound
            ? "Can't be bought from other players."
            : "No trading post listings; it may drop, be sold by a vendor or be a reward.",
        ],
      });

    return chips.map(sourceChip).join(" ");
  }

  /** Vendor and container chips from the wiki lookup. */
  #wikiChips({ vendors, historicalVendorCount, containers }) {
    const chips = [];
    if (vendors.length)
      chips.push({
        label: `Vendor (${vendors.length})`,
        details: [
          ...vendors
            .slice(0, 12)
            .map(
              (offer) =>
                `<b>${escapeHtml(offer.vendor)}</b>${offer.location ? ` <span class="muted">· ${escapeHtml(offer.location)}</span>` : ""}<br>` +
                `${offer.quantity > 1 ? `${offer.quantity} for ` : ""}${offer.costs.map((c) => `${escapeHtml(c.value)} ${escapeHtml(c.currency)}`).join(" + ") || "?"}`,
            ),
          ...(vendors.length > 12 ? [`…and ${vendors.length - 12} more`] : []),
          ...(historicalVendorCount
            ? [
                `<span class="muted">${historicalVendorCount} former vendor(s) not shown</span>`,
              ]
            : []),
          '<span class="muted small">Source: Guild Wars 2 Wiki</span>',
        ],
      });
    if (containers.length)
      chips.push({
        label: `Container (${containers.length})`,
        details: [
          ...containers.slice(0, 15).map((name) => escapeHtml(name)),
          ...(containers.length > 15
            ? [`…and ${containers.length - 15} more`]
            : []),
          '<span class="muted small">Source: Guild Wars 2 Wiki</span>',
        ],
      });
    return chips;
  }

  /** One recipe as a hover-card line: discipline and rating, how it's learned, and its ingredients. */
  #recipeSummaryHtml(recipe, isUsed) {
    const { gameData } = this.context;
    const learned = recipe.flags.includes("LearnedFromItem")
      ? "recipe sheet"
      : recipe.flags.includes("AutoLearned")
        ? "auto-learned"
        : recipe.source === RecipeSource.api
          ? "discovery"
          : "";
    const heading =
      recipe.source === RecipeSource.api
        ? `${escapeHtml(recipe.disciplines.join(", ") || "Crafting")} ${recipe.minRating}${learned ? ` · ${learned}` : ""}`
        : recipe.source === RecipeSource.custom
          ? "Custom recipe"
          : "Mystic Forge";
    const ingredients = recipe.ingredients
      .map((ingredient) => {
        const kind =
          INGREDIENT_TYPE_TO_KIND[ingredient.type] ?? EntityKind.item;
        return `${escapeHtml(formatQuantity(kind, ingredient.id, ingredient.count))} × ${escapeHtml(gameData.getEntity(kind, ingredient.id).name)}`;
      })
      .join(", ");
    const output =
      recipe.outputCount !== 1
        ? ` → ${escapeHtml(String(recipe.outputCount))}`
        : "";
    return `${isUsed ? "✓ " : ""}<b>${heading}</b>${output}<br><span class="muted">${ingredients}</span>`;
  }

  #actionButtonsHtml(node, entity) {
    const buttons = [];
    if (node.kind === EntityKind.item && !node.isRoot)
      buttons.push(
        '<button type="button" data-action="make-root">Make root</button>',
      );
    if (node.recipe && !node.isCycle)
      buttons.push(
        `<button type="button" data-action="toggle">${node.isCollapsed ? "Expand" : "Collapse"}</button>`,
      );
    if (node.alternativeRecipeCount > 1) {
      buttons.push(
        `<button type="button" data-action="previous-recipe">&#8249;</button><span class="muted" style="align-self:center">Recipe ${node.recipeIndex + 1}/${node.alternativeRecipeCount}</span><button type="button" data-action="next-recipe">&#8250;</button>`,
      );
    }
    if (entity.chatLink)
      buttons.push(
        '<button type="button" data-action="copy-chat-link">Copy chat link</button>',
      );
    if (node.kind === EntityKind.item)
      buttons.push(
        '<button type="button" data-action="open-wiki">Wiki</button>',
      );
    return `<div class="btnrow">${buttons.join("")}</div>`;
  }

  #recipeHtml(node) {
    const { gameData } = this.context;
    const recipe = node.recipe;
    const sourceNote =
      recipe.source === RecipeSource.custom
        ? " (custom)"
        : recipe.source === RecipeSource.mysticForge
          ? " (from GW2 wiki)"
          : "";
    const rows = [
      ["Discipline", escapeHtml(recipe.disciplines.join(", ") || "—")],
      ["Rating", recipe.minRating],
      ["Type", escapeHtml(recipe.type) + sourceNote],
      [
        "Output",
        `${recipe.outputCount} per craft · ${formatNumber(node.craftCount)} craft${node.craftCount === 1 ? "" : "s"}`,
      ],
    ];
    if (recipe.craftTimeMs)
      rows.push(["Time", `${(recipe.craftTimeMs / 1000).toFixed(1)}s each`]);
    if (recipe.flags.length)
      rows.push(["Flags", escapeHtml(recipe.flags.join(", "))]);

    const ingredientRows = recipe.ingredients.map((ingredient) => {
      const kind = INGREDIENT_TYPE_TO_KIND[ingredient.type] ?? EntityKind.item;
      const entity = gameData.getEntity(kind, ingredient.id);
      return (
        `<div class="ing" role="button" tabindex="0" data-kind="${kind}" data-entity-id="${escapeHtml(ingredient.id)}">${entity.icon ? `<img src="${escapeHtml(entity.icon)}" alt="" loading="lazy" decoding="async">` : ""}` +
        `<span>${escapeHtml(formatQuantity(kind, ingredient.id, ingredient.count))} × <span style="color:${gameData.getEntityColor(kind, ingredient.id)}">${escapeHtml(entity.name)}</span></span></div>`
      );
    });
    return `<h4>Recipe</h4>${definitionList(rows)}<h4>Ingredients (per craft)</h4>${ingredientRows.join("")}`;
  }

  #usedInHtml(itemId) {
    const { gameData } = this.context;
    const consumerIds = [...gameData.getConsumers(itemId)];
    if (!consumerIds.length) return "";
    const rows = consumerIds
      .map((id) => gameData.items.get(id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_USED_IN_ROWS)
      .map(
        (item) =>
          `<div class="usedin" role="button" tabindex="0" data-item-id="${item.id}"><img src="${escapeHtml(item.icon)}" alt="" loading="lazy" decoding="async"><span style="color:${RARITY_COLORS[item.rarity] || "#ccc"}">${escapeHtml(item.name)}</span></div>`,
      );
    const more =
      consumerIds.length > MAX_USED_IN_ROWS
        ? `<div class="muted small">…and ${consumerIds.length - MAX_USED_IN_ROWS} more</div>`
        : "";
    return `<h4>Used in (${consumerIds.length})</h4>${rows.join("")}${more}`;
  }

  #handleClick(event) {
    const node = this.node;
    if (!node) return;
    const button = event.target.closest("[data-action]");
    if (button) {
      switch (button.dataset.action) {
        case "make-root":
          this.actions.openItem(node.entityId);
          break;
        case "toggle":
          this.actions.toggleCollapsed(node.nodeId);
          break;
        case "previous-recipe":
          this.actions.cycleRecipe(node.nodeId, -1);
          break;
        case "next-recipe":
          this.actions.cycleRecipe(node.nodeId, 1);
          break;
        case "copy-chat-link":
          copyText(
            this.entity.chatLink,
            `Copied ${this.entity.chatLink}`,
            this.actions.notify,
          );
          break;
        case "open-wiki":
          window.open(
            GW2_WIKI_SEARCH_URL + encodeURIComponent(this.entity.name),
            "_blank",
            "noopener,noreferrer",
          );
          break;
      }
      return;
    }
    const ingredient = event.target.closest(".ing");
    if (ingredient) {
      this.actions.focusEntity(
        ingredient.dataset.kind,
        ingredient.dataset.entityId,
      );
      return;
    }
    const consumer = event.target.closest(".usedin");
    if (consumer) this.actions.openItem(Number(consumer.dataset.itemId));
  }
}

/** A source chip; with `details`, it shows a hover/focus card listing them. */
function sourceChip({ label, isUsed = false, className = "", details = [] }) {
  const card = details.length
    ? `<span class="src-card" role="tooltip">${details.map((line) => `<span>${line}</span>`).join("")}</span>`
    : "";
  return `<span class="src ${className}${isUsed ? " used" : ""}"${details.length ? ' tabindex="0"' : ""}${isUsed ? ' aria-label="' + escapeHtml(label) + ' (used in this tree)"' : ""}>${escapeHtml(label)}${card}</span>`;
}
