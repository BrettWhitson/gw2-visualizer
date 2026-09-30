// The KPI strip's figures: craft cost against the Trading Post price after its 15% cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TP_FEE, rootEconomics } from "../web/src/model/root-economics.js";

test("profit after the 15% fee, charged per unit and rounded down", () => {
  assert.equal(TP_FEE, 0.15);
  const figures = rootEconomics({
    craftCost: 21_993_420,
    sellPrice: 32_500_001,
    quantity: 1,
  });
  assert.equal(figures.buyNow, 32_500_001);
  assert.equal(figures.sellNet, Math.floor(32_500_001 * 0.85));
  assert.equal(figures.profit, figures.sellNet - 21_993_420);
  assert.ok(Math.abs(figures.margin - figures.profit / 21_993_420) < 1e-12);
});

test("figures scale with the quantity, and a loss is negative", () => {
  const figures = rootEconomics({
    craftCost: 1000,
    sellPrice: 100,
    quantity: 5,
  });
  assert.equal(figures.buyNow, 500);
  assert.equal(figures.sellNet, 425);
  assert.equal(figures.profit, -575);
  assert.ok(figures.margin < 0);
});

test("without a price there's no sale side; without a cost, no profit", () => {
  assert.deepEqual(
    rootEconomics({ craftCost: 50, sellPrice: null, quantity: 1 }),
    { craftCost: 50, buyNow: null, sellNet: null, profit: null, margin: null },
  );
  const noCost = rootEconomics({ craftCost: 0, sellPrice: 100, quantity: 1 });
  assert.equal(noCost.craftCost, null);
  assert.equal(noCost.sellNet, 85);
  assert.equal(noCost.profit, null);
  assert.equal(noCost.margin, null);
});
