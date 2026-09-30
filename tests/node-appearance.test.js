// What a node carries to the graph view: with Items as Cards, the text a card shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeAppearance } from "../web/src/render/node-appearance.js";
import { DEFAULT_SETTINGS } from "../web/src/config/settings-schema.js";
import {
  EntityKind,
  SOURCE_COLORS,
  UI_COLORS,
} from "../web/src/config/constants.js";

const gameData = {
  getEntity: () => ({ name: "Mithril Ingot", icon: "icon.png" }),
  getEntityColor: () => "#62a4da",
};
const appearance = (overrides = {}) =>
  new NodeAppearance({
    gameData,
    settings: { values: { ...DEFAULT_SETTINGS, ...overrides } },
  });
const node = (extra = {}) => ({
  nodeId: "item:19684",
  kind: EntityKind.item,
  entityId: 19684,
  quantity: 250,
  depth: 1,
  recipe: { id: 1 },
  effectiveCost: 12_345,
  ...extra,
});

test("icons (the default) carry just a label", () => {
  const data = appearance().nodeData(node(), 0);
  assert.equal(data.cardTitle, undefined);
  assert.match(data.label, /250 × Mithril Ingot/);
});

test("cards: name as title, quantity and source, coin value, what's owned", () => {
  const data = appearance({ nodeLook: "card" }).nodeData(
    node({ ownedQuantity: 40 }),
    0,
  );
  assert.equal(data.cardTitle, "Mithril Ingot");
  assert.deepEqual(data.subtitle, [
    "×250 ",
    { mark: SOURCE_COLORS.craft },
    " Crafted",
  ]);
  assert.deepEqual(data.value.slice(0, 2), ["1", { dot: UI_COLORS.gold }]);
  assert.equal(data.tag, "have 40");

  const owned = appearance({ nodeLook: "card" }).nodeData(
    node({ isOwnedEnough: true, effectiveCost: 0 }),
    0,
  );
  assert.equal(owned.tag, "✓ owned");
  assert.equal(owned.value, undefined, "no cost, no value");
  const collapsed = appearance({ nodeLook: "card" }).nodeData(
    node({ isCollapsed: true }),
    0,
  );
  assert.equal(collapsed.subtitle.at(-1), " ▸");
});
