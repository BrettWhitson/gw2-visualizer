import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDGE_SOURCES,
  TP_FEE,
  edgeSourceLegendEntries,
  edgeSourceRules,
  kpiFigures,
} from "../web/src/design/design-model.js";
import { SOURCE_COLORS } from "../web/src/config/constants.js";

test("edge source rules cover every source category but the root, with literal colours", () => {
  const categories = Object.keys(SOURCE_COLORS).filter((c) => c !== "root");
  assert.deepEqual(Object.keys(EDGE_SOURCES).sort(), categories.sort());
  const { edges } = edgeSourceRules();
  for (const category of categories) {
    const rule = edges[`src-${category}`];
    assert.match(rule.color, /^#[0-9a-f]{6}$/); // Prism rejects var() and color-mix()
  }
  assert.equal(edges["src-currency"].pattern, "dashed");
  assert.equal(edges["src-craft"].pattern, undefined);
});

test("edge legend entries reuse the source: matcher and draw as lines", () => {
  const entries = edgeSourceLegendEntries();
  assert.equal(entries.length, Object.keys(EDGE_SOURCES).length);
  for (const entry of entries) {
    assert.match(entry.key, /^source:/);
    assert.equal(entry.line, true);
  }
});

test("kpi figures: profit after the 15% fee, per unit rounded down", () => {
  const figures = kpiFigures({
    craftCost: 21_993_420,
    sellPrice: 32_500_001,
    quantity: 1,
  });
  assert.equal(TP_FEE, 0.15);
  assert.equal(figures.buyNow, 32_500_001);
  assert.equal(figures.sellNet, Math.floor(32_500_001 * 0.85));
  assert.equal(figures.profit, figures.sellNet - 21_993_420);
  assert.ok(Math.abs(figures.margin - figures.profit / 21_993_420) < 1e-12);
});

test("kpi figures scale with quantity and report losses", () => {
  const figures = kpiFigures({ craftCost: 1000, sellPrice: 100, quantity: 5 });
  assert.equal(figures.buyNow, 500);
  assert.equal(figures.sellNet, 425);
  assert.equal(figures.profit, -575);
  assert.ok(figures.margin < 0);
});

test("kpi figures without a price or a cost", () => {
  assert.deepEqual(
    kpiFigures({ craftCost: 50, sellPrice: null, quantity: 1 }),
    {
      craftCost: 50,
      buyNow: null,
      sellNet: null,
      profit: null,
      margin: null,
    },
  );
  const noCost = kpiFigures({ craftCost: 0, sellPrice: 100, quantity: 1 });
  assert.equal(noCost.craftCost, null);
  assert.equal(noCost.sellNet, 85);
  assert.equal(noCost.profit, null);
  assert.equal(noCost.margin, null);
});
