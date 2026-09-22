import { RARITY_COLORS } from "../config/constants.js";
import { escapeHtml } from "../utils/dom.js";
import { debounce } from "../utils/async.js";

/**
 * Search input + autocomplete dropdown with keyboard navigation. Calls `onPick(itemId)` on selection.
 * With an empty query it offers the recently opened items instead.
 */
export class SearchBox {
  #resultIds = [];
  #activeIndex = -1;

  /**
   * @param {{ input: HTMLInputElement, resultsElement: HTMLElement,
   *           searchIndex: import('../data/item-search-index.js').ItemSearchIndex,
   *           gameData: import('../data/game-data.js').GameData, onPick: (itemId: number) => void,
   *           getRecentItemIds?: () => number[] }} options
   */
  constructor({
    input,
    resultsElement,
    searchIndex,
    gameData,
    onPick,
    getRecentItemIds = () => [],
  }) {
    Object.assign(this, {
      input,
      resultsElement,
      searchIndex,
      gameData,
      onPick,
      getRecentItemIds,
    });
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", resultsElement.id);
    input.setAttribute("aria-expanded", "false");
    resultsElement.setAttribute("role", "listbox");
    const updateResults = debounce(() => this.#refresh(), 90);

    input.addEventListener("input", updateResults);
    input.addEventListener("focus", () => {
      input.select();
      this.#refresh();
    });
    input.addEventListener("blur", () =>
      setTimeout(() => this.#hideResults(), 120),
    ); // let result clicks land first
    input.addEventListener("keydown", (event) => this.#handleKeyDown(event));
    resultsElement.addEventListener("mousedown", (event) => {
      const row = event.target.closest(".res[data-item-id]");
      if (!row) return;
      event.preventDefault(); // keep focus so blur doesn't hide the list mid-click
      this.#pick(Number(row.dataset.itemId));
    });
  }

  /** Show the given text without triggering a search (e.g. the current root's name). */
  setText(text) {
    this.input.value = text;
  }

  focus() {
    this.input.focus();
  }

  /** Results for the current query, or the recent items when it's empty. */
  #refresh() {
    if (this.input.value.trim()) {
      this.#showResults(this.searchIndex.search(this.input.value));
      return;
    }
    const recentIds = this.getRecentItemIds().filter((id) =>
      this.gameData.items.has(id),
    );
    if (recentIds.length) this.#showResults(recentIds, { heading: "Recent" });
    else this.#hideResults();
  }

  #handleKeyDown(event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.#moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.#moveActive(-1);
        break;
      case "Enter": {
        const ids = this.#resultIds.length
          ? this.#resultIds
          : this.searchIndex.search(this.input.value);
        if (ids.length) this.#pick(ids[Math.max(0, this.#activeIndex)]);
        break;
      }
      case "Escape":
        this.#hideResults();
        this.input.blur();
        break;
    }
  }

  #showResults(itemIds, { heading = "" } = {}) {
    const hasQuery = !!this.input.value.trim();
    this.#resultIds = itemIds;
    this.#activeIndex = itemIds.length ? 0 : -1;
    if (!itemIds.length) {
      this.resultsElement.innerHTML = hasQuery
        ? '<div class="res muted" role="option" aria-disabled="true">No matches</div>'
        : "";
      this.#setExpanded(hasQuery);
      return;
    }
    this.resultsElement.innerHTML =
      (heading
        ? `<div class="res-head" role="presentation">${escapeHtml(heading)}</div>`
        : "") +
      itemIds.map((id, index) => this.#resultRowHtml(id, index)).join("");
    this.#setExpanded(true);
    this.#announceActive();
  }

  #resultRowHtml(itemId, index) {
    const isActive = index === 0;
    const item = this.gameData.items.get(itemId);
    const isCraftable = this.gameData.hasRecipe(itemId);
    const isForge = this.gameData.isForgeOnlyItem(itemId);
    const badge = isForge
      ? '<span class="badge mf">&#10022; mystic forge</span>'
      : isCraftable
        ? '<span class="badge">craftable</span>'
        : '<span class="badge no">material</span>';
    return `<div class="res${isActive ? " active" : ""}" role="option" id="search-option-${index}" aria-selected="${isActive}" data-item-id="${itemId}"><img src="${escapeHtml(item.icon)}" alt="" loading="lazy" decoding="async">
      <span class="nm" style="color:${RARITY_COLORS[item.rarity] || "#ccc"}">${escapeHtml(item.name)}</span>
      <span class="meta">${escapeHtml(item.type || "")}${item.level ? " · " + item.level : ""}</span>${badge}</div>`;
  }

  #moveActive(step) {
    const rows = [
      ...this.resultsElement.querySelectorAll(".res[data-item-id]"),
    ];
    if (!rows.length) return;
    this.#activeIndex = (this.#activeIndex + step + rows.length) % rows.length;
    rows.forEach((row, index) => {
      row.classList.toggle("active", index === this.#activeIndex);
      row.setAttribute("aria-selected", String(index === this.#activeIndex));
    });
    rows[this.#activeIndex].scrollIntoView({ block: "nearest" });
    this.#announceActive();
  }

  #pick(itemId) {
    this.#hideResults();
    this.input.blur();
    this.onPick(itemId);
  }

  #hideResults() {
    this.#setExpanded(false);
  }

  #setExpanded(isExpanded) {
    this.resultsElement.hidden = !isExpanded;
    this.input.setAttribute("aria-expanded", String(isExpanded));
    if (!isExpanded) this.input.removeAttribute("aria-activedescendant");
  }

  /** Screen readers follow the highlighted option via aria-activedescendant while focus stays in the input. */
  #announceActive() {
    if (this.#activeIndex >= 0)
      this.input.setAttribute(
        "aria-activedescendant",
        `search-option-${this.#activeIndex}`,
      );
  }
}
