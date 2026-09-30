import { RARITY_ORDER } from "../config/constants.js";

/** Case-insensitive item-name search with sensible ranking; also accepts numeric ids and chat links. */
export class ItemSearchIndex {
  /** @type {{ id: number, lowerName: string, isCraftable: boolean, rarityRank: number }[]} */
  #entries = [];

  /** @param {import('./game-data.js').GameData} gameData */
  constructor(gameData) {
    this.gameData = gameData;
  }

  get size() {
    return this.#entries.length;
  }

  rebuild() {
    this.#entries = [...this.gameData.items.values()]
      .filter((item) => item.name)
      .map((item) => ({
        id: item.id,
        lowerName: item.name.toLowerCase(),
        isCraftable: this.gameData.hasRecipe(item.id),
        rarityRank: RARITY_ORDER.indexOf(item.rarity),
      }));
  }

  /**
   * Ranking: exact name → prefix → word-start → substring; craftable items before plain materials;
   * then higher rarity, then shorter names. Every whitespace-separated token must appear.
   * @returns {number[]} item ids
   */
  search(query, limit = 50) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const directId = /^\d+$/.test(normalized)
      ? Number(normalized)
      : decodeItemChatLink(normalized);
    if (directId != null)
      return this.gameData.items.has(directId) ? [directId] : [];

    const tokens = normalized.split(/\s+/);
    const matches = [];
    for (const entry of this.#entries) {
      if (!tokens.every((token) => entry.lowerName.includes(token))) continue;
      matches.push({
        id: entry.id,
        score: matchScore(entry, normalized),
        rarityRank: entry.rarityRank,
        length: entry.lowerName.length,
      });
    }
    matches.sort(
      (a, b) =>
        a.score - b.score || b.rarityRank - a.rarityRank || a.length - b.length,
    );
    return matches.slice(0, limit).map((match) => match.id);
  }
}

function matchScore(entry, query) {
  const name = entry.lowerName;
  let score;
  if (name === query) score = 0;
  else if (name.startsWith(query)) score = 1;
  else if (name.includes(query))
    score = /\W/.test(name[name.indexOf(query) - 1] || " ") ? 2 : 3;
  else score = 4; // tokens match individually but not as a phrase
  return entry.isCraftable ? score : score + 2.5;
}

/**
 * Item chat links are base64 of: [0x02, quantity, id (3 bytes little-endian), …].
 * @returns {number | null}
 */
export function decodeItemChatLink(text) {
  const match = text.match(/\[&([A-Za-z0-9+/=]+)\]/);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (ch) => ch.charCodeAt(0));
    if (bytes[0] !== 2) return null;
    return bytes[2] | (bytes[3] << 8) | (bytes[4] << 16);
  } catch {
    return null;
  }
}
