// The legend's entries follow the colour mode and settings, count their nodes, and select as a union.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLegendEntries,
  legendMatches,
  matchingNodeIds,
} from "../web/src/model/legend-model.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";
import { EntityKind, SOURCE_COLORS } from "../web/src/config/constants.js";

const RARITY = { 1: "Exotic", 2: "Exotic", 3: "Legendary" };
const gameData = { getEntity: (kind, id) => ({ rarity: RARITY[id] }) };
const node = (nodeId, extra = {}) => ({
  nodeId,
  kind: EntityKind.item,
  entityId: Number(nodeId),
  depth: 0,
  effectiveCost: 0,
  ...extra,
});
const NODES = [
  node("1", { depth: 1, effectiveCost: 500, isCollapsed: true }),
  node("2", { depth: 2, effectiveCost: 5, isBuyCheaper: true }),
  node("3", { effectiveCost: 1000, isOwnedEnough: true }),
];
const context = { gameData, rootCost: 1000 };
const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });
const keysOf = (entries) => entries.map((entry) => entry.key);

test("rarity mode: every rarity, with counts, then the flags that apply", () => {
  const entries = buildLegendEntries(
    settings({ nodeColorMode: "rarity", showBuyCheaperHint: true }),
    NODES,
    context,
  );
  const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
  assert.equal(byKey["rarity:Exotic"].count, 2);
  assert.equal(byKey["rarity:Legendary"].count, 1);
  assert.equal(byKey["rarity:Basic"].count, 0, "listed even when unused");
  assert.equal(byKey["flag:collapsed"].count, 1);
  assert.equal(byKey["flag:cheaper"].count, 1);
  assert.equal(byKey["flag:owned"].count, 1, "owned appears once something is");
});

test("entries follow the settings", () => {
  const off = buildLegendEntries(
    settings({ forgeIndicator: "off", showBuyCheaperHint: false }),
    NODES,
    context,
  );
  assert.ok(!keysOf(off).includes("flag:mf"));
  assert.ok(!keysOf(off).includes("flag:cheaper"));
  const noPrices = buildLegendEntries(
    settings({ showBuyCheaperHint: true, priceBasis: "off" }),
    NODES,
    context,
  );
  assert.ok(!keysOf(noPrices).includes("flag:cheaper"), "no prices, no hint");
  const source = buildLegendEntries(
    settings({ nodeColorMode: "source" }),
    [],
    context,
  );
  for (const category of Object.keys(SOURCE_COLORS))
    assert.ok(keysOf(source).includes(`source:${category}`));
  assert.ok(!keysOf(source).includes("flag:owned"), "nothing owned, no entry");
});

test("cost and depth modes bucket nodes", () => {
  assert.ok(legendMatches("cost:hi", NODES[0], context), "50% of the cost");
  assert.ok(legendMatches("cost:lo", NODES[1], context), "0.5%");
  assert.ok(legendMatches("depth:2", NODES[1], context));
  assert.ok(!legendMatches("depth:2", NODES[0], context));
  assert.ok(!legendMatches("bogus:x", NODES[0], context));
});

test("selection is a union of the chosen entries", () => {
  assert.deepEqual(
    [
      ...matchingNodeIds(
        ["rarity:Legendary", "flag:collapsed"],
        NODES,
        context,
      ),
    ],
    ["1", "3"],
  );
  assert.equal(matchingNodeIds([], NODES, context).size, 0);
});
