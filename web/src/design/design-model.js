/**
 * Pure pieces of the design-branch prototypes (see design-lab.js): the edge-source colours and the root item's
 * KPI figures. No DOM.
 */

/** The Trading Post keeps 15% of a sale: a 5% listing fee and a 10% exchange fee. */
export const TP_FEE = 0.15;

/**
 * Edge colours by where the ingredient comes from (getSourceCategory), from the Hybrid mockup. Literal colours:
 * Prism's class rules take hex, not CSS variables.
 */
export const EDGE_SOURCES = {
  craft: { label: "Crafted", color: "#6ea0ff" },
  mf: { label: "Mystic Forge", color: "#b28cff" },
  raw: { label: "Bought / raw", color: "#e0a05a" },
  currency: { label: "Currency", color: "#5cc9a7", pattern: "dashed" },
  generic: { label: "Generic", color: "#8d939e", pattern: "dotted" },
};

/** Prism class rules for the `src-<category>` edge classes NodeAppearance adds. */
export function edgeSourceRules() {
  const edges = {};
  for (const [category, { color, pattern }] of Object.entries(EDGE_SOURCES))
    edges[`src-${category}`] = pattern ? { color, pattern } : { color };
  return { edges };
}

/** Legend entries for the edge key; their keys reuse the legend's "source:" matcher. */
export function edgeSourceLegendEntries() {
  return Object.entries(EDGE_SOURCES).map(([category, { label, color }]) => ({
    key: `source:${category}`,
    label: `${label} edges`,
    color,
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
