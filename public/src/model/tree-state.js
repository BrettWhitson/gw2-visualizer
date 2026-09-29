/**
 * What the user is looking at: the root item, navigation history, which nodes they expanded/collapsed,
 * which alternate recipe they picked per item, and the selected node.
 */
export class TreeState {
  /** @type {number | null} */ rootItemId = null;
  rootQuantity = 1;
  /** @type {{ itemId: number, quantity: number }[]} */ history = [];
  /** Collapse keys the user folded; win over everything. */ collapsedKeys =
    new Set();
  /** Collapse keys the user unfolded past the depth limit / auto-collapse. */ expandedKeys =
    new Set();
  /** @type {Map<number, number>} item id → chosen recipe index */ recipeChoiceByItemId =
    new Map();
  /** @type {string | null} */ selectedNodeId = null;

  get hasRoot() {
    return this.rootItemId != null;
  }

  /** Switch to a new root. Returns false if it's already the root. */
  openRoot(itemId, { recordHistory = true, quantity } = {}) {
    if (recordHistory && this.hasRoot && this.rootItemId !== itemId)
      this.history.push({
        itemId: this.rootItemId,
        quantity: this.rootQuantity,
      });
    // Reopening the item that was just cleared: it's back, so it's no longer something to go Back to.
    if (!this.hasRoot && this.history.at(-1)?.itemId === itemId)
      this.history.pop();
    this.rootItemId = itemId;
    if (quantity) this.rootQuantity = quantity;
    this.resetExpansion();
    this.selectedNodeId = null;
  }

  /** Back to no item (the start screen). The current root goes into history, so Back brings it back. */
  clear() {
    if (this.hasRoot)
      this.history.push({
        itemId: this.rootItemId,
        quantity: this.rootQuantity,
      });
    this.rootItemId = null;
    this.rootQuantity = 1;
    this.resetExpansion();
    this.recipeChoiceByItemId.clear();
    this.selectedNodeId = null;
  }

  /** @returns {{ itemId: number, quantity: number } | undefined} */
  popHistory() {
    return this.history.pop();
  }

  resetExpansion() {
    this.collapsedKeys.clear();
    this.expandedKeys.clear();
  }

  /** @param {import('../types.js').GraphNode} node */
  toggleCollapsed(node) {
    if (node.isCollapsed) {
      this.collapsedKeys.delete(node.collapseKey);
      this.expandedKeys.add(node.collapseKey);
    } else {
      this.collapsedKeys.add(node.collapseKey);
      this.expandedKeys.delete(node.collapseKey);
    }
  }

  /** @param {import('../types.js').GraphNode} node  @param {number} step  +1 / -1 */
  cycleRecipe(node, step) {
    const count = node.alternativeRecipeCount;
    this.recipeChoiceByItemId.set(
      node.entityId,
      (node.recipeIndex + step + count) % count,
    );
  }

  /** URL hash that reopens this view. */
  toHash() {
    return `#item=${this.rootItemId}${this.rootQuantity > 1 ? `&qty=${this.rootQuantity}` : ""}`;
  }

  /** @returns {{ itemId: number, quantity: number } | null} */
  static parseHash(hash) {
    const itemMatch = hash.match(/item=(\d+)/);
    if (!itemMatch) return null;
    return {
      itemId: Number(itemMatch[1]),
      quantity: Number(hash.match(/qty=(\d+)/)?.[1] || 1),
    };
  }
}
