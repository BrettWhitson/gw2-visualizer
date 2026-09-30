/** Number, money and colour formatting. */

import { COIN_CURRENCY_ID, EntityKind } from "../config/constants.js";

export const formatNumber = (value) => Number(value).toLocaleString();

/** Split copper into gold / silver / copper parts. */
function splitCoins(copper) {
  const total = Math.abs(Math.round(copper));
  return {
    gold: Math.floor(total / 10000),
    silver: Math.floor((total % 10000) / 100),
    copper: total % 100,
    negative: copper < 0,
  };
}

/** "12g 34s 56c" with coloured spans; "—" for unknown. */
export function formatCoinsHtml(copper) {
  if (copper == null) return '<span class="muted">—</span>';
  const { gold, silver, copper: cu, negative } = splitCoins(copper);
  const parts = [];
  if (gold) parts.push(`<span class="g">${formatNumber(gold)}g</span>`);
  if (gold || silver) parts.push(`<span class="s">${silver}s</span>`);
  parts.push(`<span class="c">${cu}c</span>`);
  return `<span class="coin">${negative ? "−" : ""}${parts.join(" ")}</span>`;
}

/** Plain-text coins, used inside graph labels. */
export function formatCoinsText(copper) {
  const { gold, silver, copper: cu, negative } = splitCoins(copper);
  return (
    (negative ? "−" : "") +
    (gold ? `${gold}g ` : "") +
    (gold || silver ? `${silver}s ` : "") +
    `${cu}c`
  );
}

export const isCoin = (kind, entityId) =>
  kind === EntityKind.currency && entityId === COIN_CURRENCY_ID;

/** Quantities of coin are shown as money; everything else as a number. */
export const formatQuantity = (kind, entityId, quantity) =>
  isCoin(kind, entityId) ? formatCoinsText(quantity) : formatNumber(quantity);

/** Linear interpolation between two #rrggbb colours. */
export function mixColors(fromHex, toHex, t) {
  const from = fromHex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const to = toHex.match(/\w\w/g).map((h) => parseInt(h, 16));
  return (
    "#" +
    from
      .map((v, i) =>
        Math.round(v + (to[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAge(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
