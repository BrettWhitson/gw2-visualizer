import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArmory } from "../web/src/model/character-armory.js";
import {
  armoryHtml,
  characterListHtml,
  pieceCardHtml,
  pieceTooltipHtml,
} from "../web/src/ui/character-view.js";

// Everything a player (or the API) names is text: none of it may become markup or break out of an attribute.
const HOSTILE = `<img src=x onerror=alert(1)>"'`;
const INJECTED = [/<img src=x/i, /"\s*onerror=/i, /" onmouseover=/i];

function assertEscaped(html, where) {
  for (const pattern of INJECTED)
    assert.doesNotMatch(html, pattern, `${where} leaks ${pattern}`);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, where);
}

const RUNE = {
  id: 74978,
  name: `Superior Rune ${HOSTILE}`,
  type: "UpgradeComponent",
  rarity: "Exotic",
  icon: "rune.png",
  details: { type: "Rune", bonuses: [`+25 ${HOSTILE}`, "+35 Power"] },
};
const INFUSION = {
  id: 37131,
  name: `Infusion ${HOSTILE}`,
  type: "UpgradeComponent",
  rarity: "Rare",
  icon: "inf.png",
  details: {
    type: "Default",
    infix_upgrade: {
      id: 1,
      attributes: [{ attribute: "AgonyResistance", modifier: 9 }],
    },
  },
};
const HELM = {
  id: 101,
  name: `Helm ${HOSTILE}`,
  type: "Armor",
  rarity: "Exotic",
  level: 80,
  icon: "helm.png",
  description: `Flavour ${HOSTILE}`,
  details: {
    type: "Helm",
    weight_class: "Light",
    defense: 73,
    infusion_slots: [{}],
    infix_upgrade: {
      id: 161,
      attributes: [{ attribute: "Power", modifier: 45 }],
    },
  },
};
const RELIC = {
  id: 1001,
  name: `Relic ${HOSTILE}`,
  type: "Relic",
  rarity: "Exotic",
  icon: "relic.png",
  description: `Does ${HOSTILE}`,
};
const BAG = {
  id: 300,
  name: `Bag ${HOSTILE}`,
  type: "Bag",
  rarity: "Fine",
  icon: "bag.png",
};

const CATALOGS = {
  items: new Map([RUNE, INFUSION, HELM, RELIC, BAG].map((i) => [i.id, i])),
  itemstats: new Map([[161, { id: 161, name: `Stats ${HOSTILE}` }]]),
  skins: new Map([[7, { id: 7, name: `Skin ${HOSTILE}`, icon: "skin.png" }]]),
  colors: new Map([
    [5, { id: 5, name: `Dye ${HOSTILE}`, base_rgb: [1, 2, 3] }],
  ]),
  specializations: new Map(),
};

function hostileCharacter() {
  const helm = {
    id: HELM.id,
    slot: "Helm",
    upgrades: [RUNE.id],
    infusions: [INFUSION.id],
    skin: 7,
    dyes: [5],
    binding: "Character",
    bound_to: HOSTILE,
  };
  return {
    name: `Char ${HOSTILE}`,
    race: `Race ${HOSTILE}`,
    profession: `Prof ${HOSTILE}`,
    level: 80,
    crafting: [{ discipline: `Craft ${HOSTILE}`, rating: 500, active: true }],
    equipment: [
      { ...helm, location: "Equipped" },
      { id: RELIC.id, slot: "Relic", location: "Equipped" },
    ],
    equipment_tabs: [
      { tab: 1, name: `Tab ${HOSTILE}`, is_active: true, equipment: [helm] },
    ],
    bags: [
      {
        id: BAG.id,
        size: 2,
        inventory: [
          { id: RUNE.id, count: 3 },
          { id: 999, count: 1 },
        ],
      },
    ],
  };
}

test("the character list escapes names, races, professions and crafting", () => {
  const html = characterListHtml(
    [
      {
        name: `Char ${HOSTILE}`,
        level: 80,
        race: `Race ${HOSTILE}`,
        profession: `Prof ${HOSTILE}`,
        build: { display: `Spec ${HOSTILE}`, icon: `x" onerror="alert(1)` },
        crafting: [{ discipline: `Craft ${HOSTILE}`, rating: 1 }],
      },
    ],
    `Account ${HOSTILE}`,
  );
  assertEscaped(html, "character list");
  assert.match(html, /href="#Char%20%3Cimg/, "the link target is URL-encoded");
});

for (const view of ["icons", "full"])
  test(`the ${view} armory and its tooltips escape every name`, () => {
    const armory = buildArmory(hostileCharacter(), CATALOGS);
    const { html, tooltips } = armoryHtml(armory, "A", { view });
    assertEscaped(html, `${view} armory`);
    for (const [key, tip] of tooltips)
      for (const pattern of INJECTED)
        assert.doesNotMatch(tip, pattern, `tooltip ${key}`);
  });

test("piece tooltips and cards escape item, upgrade, skin, dye and stat names", () => {
  const armory = buildArmory(hostileCharacter(), CATALOGS);
  const helm = armory.slots.Helm;
  assertEscaped(pieceTooltipHtml(helm, armory.runeCounts), "tooltip");
  assertEscaped(pieceCardHtml(helm, armory.runeCounts), "card");
});

test("upgrades and infusions link to their crafting trees; unknown ones don't", () => {
  const armory = buildArmory(hostileCharacter(), CATALOGS);
  const helm = armory.slots.Helm;
  for (const html of [
    pieceTooltipHtml(helm, armory.runeCounts),
    pieceCardHtml(helm, armory.runeCounts),
  ]) {
    assert.match(html, /href="crafting\.html#item=101"/, "the piece");
    assert.match(html, /href="crafting\.html#item=74978"/, "the rune");
    assert.match(html, /href="crafting\.html#item=37131"/, "the infusion");
  }
  const unknown = {
    ...helm,
    upgrades: [{ ...helm.upgrades[0], id: 5, missing: true }],
    infusions: [],
  };
  assert.doesNotMatch(
    pieceTooltipHtml(unknown, {}),
    /#item=5"/,
    "an upgrade the API didn't return has nothing to open",
  );
});

test("unknown bag items get no crafting link", () => {
  const armory = buildArmory(hostileCharacter(), CATALOGS);
  const tips = [...armoryHtml(armory, "A").tooltips.values()];
  assert.ok(tips.some((tip) => tip.includes("crafting.html#item=74978")));
  const unknown = tips.find((tip) => tip.includes("Unknown item #999"));
  assert.ok(unknown);
  assert.doesNotMatch(unknown, /tt-link/);
});

test("without the builds permission the armory says so instead of drawing empty gear", () => {
  const character = { ...hostileCharacter(), equipment: undefined };
  delete character.equipment_tabs;
  const armory = buildArmory(character, CATALOGS);
  const { html } = armoryHtml(armory, "A", { hasGear: false });
  assert.match(html, /lacks the <b>builds<\/b> permission/);
  assert.doesNotMatch(html, /paper-doll|stat-panel|data-gear-view/);
  assert.match(html, /Bags/, "bags come from another permission");
  assertEscaped(html, "armory without gear");
});
