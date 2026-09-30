/**
 * The root item's economics for the KPI strip over the graph: what crafting it costs, what it sells for and what's
 * left after the Trading Post's cut. Pure, in copper.
 */

/** The Trading Post keeps 15% of a sale: a 5% listing fee and a 10% exchange fee. */
export const TP_FEE = 0.15;

/**
 * @param {{ craftCost: number | null, sellPrice: number | null, quantity: number }} input
 *   craftCost: for the whole quantity; sellPrice: one unit's lowest sell listing
 * @returns {{ craftCost: number | null, buyNow: number | null, sellNet: number | null, profit: number | null,
 *             margin: number | null }}
 *   buyNow: buying the quantity at the listing; sellNet: selling it there, after fees; margin: profit / craftCost
 */
export function rootEconomics({ craftCost, sellPrice, quantity }) {
  const cost = craftCost != null && craftCost > 0 ? craftCost : null;
  if (!sellPrice)
    return {
      craftCost: cost,
      buyNow: null,
      sellNet: null,
      profit: null,
      margin: null,
    };
  const buyNow = sellPrice * quantity;
  // Fees are charged per unit, rounded down to whole copper.
  const sellNet = Math.floor(sellPrice * (1 - TP_FEE)) * quantity;
  const profit = cost == null ? null : sellNet - cost;
  return {
    craftCost: cost,
    buyNow,
    sellNet,
    profit,
    margin: cost == null ? null : profit / cost,
  };
}
