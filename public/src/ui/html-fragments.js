import { escapeHtml } from "../utils/dom.js";
import { EntityKind } from "../config/constants.js";

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

/** <dl class="kv"> from [label, html] pairs. */
export function definitionList(rows) {
  return `<dl class="kv">${rows.map(([label, html]) => `<dt>${label}</dt><dd>${html}</dd>`).join("")}</dl>`;
}
