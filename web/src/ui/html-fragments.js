import { escapeHtml } from "../utils/dom.js";
import { EntityKind } from "../config/constants.js";
import { formatNumber } from "../utils/format.js";

/** Small HTML fragments shared by the tooltip, details panel and search results. */

export const FORGE_CHIP_HTML =
  '<span class="chip mf">&#10022; Mystic Forge</span>';

/** "Legendary · Weapon · Lv 80" style subtitle. */
export function entitySubtitle(entity, kind, { levelPrefix = "Lv " } = {}) {
  return escapeHtml(
    [
      entity.rarity,
      entity.type,
      entity.level ? levelPrefix + entity.level : "",
      kind !== EntityKind.item ? kind : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
}

/** Icon with a rarity-coloured border, or nothing when the entity has no icon. */
export function entityIcon(entity, borderColor) {
  return entity.icon
    ? `<img src="${escapeHtml(entity.icon)}" alt="" decoding="async" style="border-color:${borderColor}">`
    : "";
}

/**
 * Rows about the connected account for an item node: how much of it the tree takes from what you own, and crafting
 * levels no character has. Empty without an account.
 * @param {import('../types.js').GraphNode} node
 * @param {import('../data/account-session.js').AccountSession} [account]
 * @param {boolean} useOwned  the "Use what I own" setting
 */
export function accountRows(node, account, useOwned) {
  if (!account?.isReady || node.kind !== EntityKind.item) return [];
  const rows = [];
  const held = account.ownedItems.get(node.entityId) ?? 0;
  if (node.ownedQuantity)
    rows.push([
      "Owned",
      `<span class="owned">using ${formatNumber(node.ownedQuantity)}${node.isOwnedEnough ? " (all)" : ` of ${formatNumber(node.quantity)}`}</span>` +
        (held > node.ownedQuantity
          ? ` <span class="muted">· ${formatNumber(held)} held</span>`
          : ""),
    ]);
  else if (held)
    rows.push([
      "Owned",
      `${formatNumber(held)} held` +
        (node.isRoot
          ? ""
          : ` <span class="muted">(${useOwned ? "used elsewhere in this tree" : "not used: Use what I own is off"})</span>`),
    ]);
  for (const { discipline, rating, have } of node.missingCraftingLevels ?? [])
    rows.push([
      "Needs",
      `<span class="bad">${escapeHtml(discipline)} ${rating}</span> <span class="muted">(best: ${have})</span>`,
    ]);
  return rows;
}

/** <dl class="kv"> from [label, html] pairs. */
export function definitionList(rows) {
  return `<dl class="kv">${rows.map(([label, html]) => `<dt>${label}</dt><dd>${html}</dd>`).join("")}</dl>`;
}
