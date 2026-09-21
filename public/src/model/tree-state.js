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
    this.rootItemId = itemId;
    if (quantity) this.rootQuantity = quantity;
    this.resetExpansion();
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
