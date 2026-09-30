/**
 * Pure pieces of the design-branch prototypes (see design-lab.js): the edge-source colours and the root item's
 * KPI figures. No DOM.
 */

/** The Trading Post keeps 15% of a sale: a 5% listing fee and a 10% exchange fee. */
export const TP_FEE = 0.15;

/**
 * Edge colours by where the ingredient comes from (getSourceCategory), following the source tokens in
 * css/app.css (`--s-*`), with literal fallbacks: Prism's class rules take colours, not CSS variables.
 */
export const EDGE_SOURCES = {
  craft: { label: "Crafted", token: "s-craft", color: "#6ea0ff" },
  mf: { label: "Mystic Forge", token: "s-forge", color: "#b28cff" },
  raw: { label: "Bought / raw", token: "s-buy", color: "#e0a05a" },
  currency: {
    label: "Currency",
    token: "s-vendor",
    color: "#5cc9a7",
    pattern: "dashed",
  },
  generic: {
    label: "Generic",
    token: "s-bound",
    color: "#6b717c",
    pattern: "dotted",
  },
};

/** A CSS custom property's value on the page, or null (outside a browser, or unset). */
function cssToken(name) {
  const style =
    globalThis.document &&
    globalThis.getComputedStyle?.(document.documentElement);
  return style?.getPropertyValue(`--${name}`).trim() || null;
}

/** The colour for a source category: its token, else the fallback. */
export function edgeSourceColor(category, readToken = cssToken) {
  const source = EDGE_SOURCES[category];
  return readToken(source.token) || source.color;
}

/**
 * Prism class rules for the `src-<category>` edge classes NodeAppearance adds.
 * @param {(token: string) => string | null} [readToken]
 */
export function edgeSourceRules(readToken = cssToken) {
  const edges = {};
  for (const [category, { pattern }] of Object.entries(EDGE_SOURCES)) {
    const color = edgeSourceColor(category, readToken);
    edges[`src-${category}`] = pattern ? { color, pattern } : { color };
  }
  return { edges };
}

/** Legend entries for the edge key; their keys reuse the legend's "source:" matcher. */
export function edgeSourceLegendEntries() {
  return Object.entries(EDGE_SOURCES).map(([category, { label }]) => ({
    key: `source:${category}`,
    label: `${label} edges`,
    color: edgeSourceColor(category),
    line: true,
    count: 0,
  }));
}

/**
 * The root item's economics for the KPI strip, in copper.
 * @param {{ craftCost: number | null, sellPrice: number | null, quantity: number }} input
 *   craftCost: for the whole quantity; sellPrice: one unit's lowest sell listing
 * @returns {{ craftCost: number | null, buyNow: number | null, sellNet: number | null, profit: number | null,
 *             margin: number | null }}
 */
export function kpiFigures({ craftCost, sellPrice, quantity }) {
  const hasCost = craftCost != null && craftCost > 0;
  if (!sellPrice)
    return {
      craftCost: hasCost ? craftCost : null,
      buyNow: null,
      sellNet: null,
      profit: null,
      margin: null,
    };
  const buyNow = sellPrice * quantity;
  // Fees are charged per unit, rounded down to whole copper.
  const sellNet = Math.floor(sellPrice * (1 - TP_FEE)) * quantity;
  const profit = hasCost ? sellNet - craftCost : null;
  return {
    craftCost: hasCost ? craftCost : null,
    buyNow,
    sellNet,
    profit,
    margin: hasCost ? profit / craftCost : null,
  };
}
