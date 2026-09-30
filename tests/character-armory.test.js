import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeBuild,
  buildArmory,
  parseRuneBonus,
  referencedIds,
} from "../public/src/model/character-armory.js";

// Item shapes follow real /v2/items responses (Rune of the Dragonhunter, Exquisite Ruby Jewel, …).
const DH_RUNE = {
  id: 74978,
  name: "Superior Rune of the Dragonhunter",
  type: "UpgradeComponent",
  rarity: "Exotic",
  icon: "rune.png",
  details: {
    type: "Rune",
    bonuses: [
      "+25 Ferocity",
      "+35 Power",
      "+50 Ferocity",
      "+65 Power",
      "+100 Ferocity",
      "+125 Ferocity",
    ],
    infix_upgrade: { id: 112, attributes: [] },
  },
};
const FORCE = {
  id: 24615,
  name: "Superior Sigil of Force",
  type: "UpgradeComponent",
  rarity: "Exotic",
  icon: "force.png",
  details: {
    type: "Sigil",
    infix_upgrade: {
      id: 261,
      buff: { description: "+5% Damage" },
      attributes: [],
    },
  },
};
const RUBY = {
  id: 24508,
  name: "Exquisite Ruby Jewel",
  type: "UpgradeComponent",
  rarity: "Exotic",
  icon: "ruby.png",
  details: {
    type: "Default",
    infix_upgrade: {
      id: 405,
      buff: { description: "+25 Power\n+15 Ferocity" },
      attributes: [
        { attribute: "Power", modifier: 25 },
        { attribute: "CritDamage", modifier: 15 },
      ],
    },
  },
};
const MIGHTY = {
  id: 37131,
  name: "Mighty +9 Agony Infusion",
  type: "UpgradeComponent",
  rarity: "Rare",
  icon: "inf.png",
  details: {
    type: "Default",
    infix_upgrade: {
      id: 1195,
      attributes: [
        { attribute: "Power", modifier: 5 },
        { attribute: "AgonyResistance", modifier: 9 },
      ],
    },
  },
};
const RELIC = {
  id: 1001,
  name: "Relic of Fireworks",
  type: "Relic",
  rarity: "Exotic",
  icon: "relic.png",
  description: "Deal <c=@abilitytype>more</c> damage.<br>Refreshes.",
};

// [slot, item id, power, precision/ferocity, defense]
const ARMOR = [
  ["Helm", 101, 45, 32, 73],
  ["Shoulders", 102, 34, 24, 73],
  ["Coat", 103, 134, 96, 314],
  ["Gloves", 104, 34, 24, 120],
  ["Leggings", 105, 90, 64, 194],
  ["Boots", 106, 34, 24, 120],
];
const berserkerArmor = ([slot, id, power, other, defense]) => ({
  id,
  name: `Berserker's ${slot}`,
  type: "Armor",
  rarity: "Exotic",
  level: 80,
  icon: `${slot}.png`,
  details: {
    type: slot,
    weight_class: "Light",
    defense,
    infusion_slots: [],
    infix_upgrade: {
      id: 161,
      attributes: [
        { attribute: "Power", modifier: power },
        { attribute: "Precision", modifier: other },
        { attribute: "CritDamage", modifier: other },
      ],
    },
  },
});
const GREATSWORD = {
  id: 200,
  name: "Reaper's Greatsword",
  type: "Weapon",
  rarity: "Exotic",
  level: 80,
  icon: "gs.png",
  details: {
    type: "Greatsword",
    min_power: 995,
    max_power: 1100,
    defense: 0,
    infusion_slots: [],
  },
};
const AXE = {
  id: 201,
  name: "Berserker's Axe",
  type: "Weapon",
  rarity: "Exotic",
  level: 80,
  icon: "axe.png",
  details: {
    type: "Axe",
    min_power: 857,
    max_power: 1048,
    defense: 0,
    infusion_slots: [],
    infix_upgrade: {
      id: 161,
      attributes: [
        { attribute: "Power", modifier: 125 },
        { attribute: "Precision", modifier: 90 },
        { attribute: "CritDamage", modifier: 90 },
      ],
    },
  },
};
const AMULET = {
  id: 300,
  name: "Amulet of Celebration",
  type: "Trinket",
  rarity: "Ascended",
  level: 80,
  icon: "amu.png",
  details: { type: "Amulet", infusion_slots: [{ flags: [] }] },
};

const SPECS = [
  [53, "Death Magic", false],
  [50, "Soul Reaping", false],
  [34, "Reaper", true],
  [39, "Curses", false],
].map(([id, name, elite]) => ({
  id,
  name,
  elite,
  profession: "Necromancer",
  icon: `${name}.png`,
  profession_icon: "necro.png",
}));

const byId = (list) => new Map(list.map((entry) => [entry.id, entry]));
const CATALOGS = {
  items: byId([
    DH_RUNE,
    FORCE,
    RUBY,
    MIGHTY,
    RELIC,
    GREATSWORD,
    AXE,
    AMULET,
    ...ARMOR.map(berserkerArmor),
  ]),
  itemstats: byId([{ id: 161, name: "Berserker's" }]),
  skins: new Map(),
  colors: byId([{ id: 5, name: "Abyss", cloth: { rgb: [20, 20, 20] } }]),
  specializations: byId(SPECS),
};

const buildTabs = (active, tabs) =>
  Object.entries(tabs).map(([tab, ids]) => ({
    tab: Number(tab),
    is_active: Number(tab) === active,
    build: { specializations: ids.map((id) => (id ? { id } : null)) },
  }));

/** A /v2/characters entry: template 2 active (full Berserker, 6 runes), template 1 with only 4 runes. */
function makeCharacter() {
  const piece = (slot, id, extra = {}) => ({ id, slot, ...extra });
  const template2 = [
    ...ARMOR.map(([slot, id]) =>
      piece(slot, id, { upgrades: [DH_RUNE.id], dyes: [5, null, null, null] }),
    ),
    piece("Amulet", AMULET.id, {
      stats: {
        id: 161,
        attributes: { Power: 157, Precision: 108, CritDamage: 108 },
      },
      upgrades: [RUBY.id],
      infusions: [MIGHTY.id],
    }),
    piece("WeaponA1", GREATSWORD.id, {
      stats: {
        id: 161,
        attributes: { Power: 251, Precision: 179, CritDamage: 179 },
      },
      upgrades: [FORCE.id],
    }),
    piece("WeaponB1", AXE.id, { upgrades: [FORCE.id] }),
  ];
  const template1 = ARMOR.map(([slot, id], index) =>
    piece(slot, id, { upgrades: index < 4 ? [DH_RUNE.id] : [] }),
  );
  return {
    name: "Tester",
    race: "Human",
    gender: "Female",
    profession: "Necromancer",
    level: 80,
    equipment: [
      ...template2.map((p) => ({ ...p, location: "Equipped" })),
      // Relic and tools exist only in the flat list.
      { id: RELIC.id, slot: "Relic", location: "Equipped" },
      // Stored in the armory, not worn: must never show up.
      { id: AXE.id, location: "Armory" },
    ],
    equipment_tabs: [
      { tab: 1, name: "", is_active: false, equipment: template1 },
      { tab: 2, name: "Raid", is_active: true, equipment: template2 },
    ],
    build_tabs: buildTabs(1, { 1: [53, 50, 34] }),
  };
}

const attribute = (totals, key) =>
  totals.attributes.find((a) => a.key === key).value;
const derived = (totals, label) =>
  totals.derived.find((d) => d.label === label).value;
const sum = (values) => values.reduce((a, b) => a + b, 0);

test("the active equipment template is shown by default", () => {
  assert.equal(buildArmory(makeCharacter(), CATALOGS).tab, 2);
});

test("templates add the flat-list-only slots, never another template's armor or unworn pieces", () => {
  const character = makeCharacter();
  delete character.equipment_tabs[0].equipment[5]; // template 1 has no boots
  character.equipment_tabs[0].equipment =
    character.equipment_tabs[0].equipment.filter(Boolean);
  const { slots } = buildArmory(character, CATALOGS, 1);
  assert.ok(slots.Relic, "relic comes from the flat list");
  assert.equal(
    slots.Boots,
    undefined,
    "the active template's boots don't leak in",
  );
  assert.equal(slots.WeaponB1, undefined);
  assert.ok(
    Object.values(buildArmory(character, CATALOGS, 2).slots).every(
      (piece) => piece.slot,
    ),
    "the unworn armory axe has no slot and is skipped",
  );
});

test("a full rune set, jewels and infusions add up", () => {
  const totals = buildArmory(makeCharacter(), CATALOGS, 2).totals.A;
  const armorPower = sum(ARMOR.map(([, , power]) => power));
  const armorOther = sum(ARMOR.map(([, , , other]) => other));
  // base + armor + amulet + ruby + mighty infusion + greatsword + runes
  assert.equal(
    attribute(totals, "Power"),
    1000 + armorPower + 157 + 25 + 5 + 251 + 100,
  );
  assert.equal(attribute(totals, "Precision"), 1000 + armorOther + 108 + 179);
  assert.equal(
    attribute(totals, "CritDamage"),
    armorOther + 108 + 15 + 179 + 300,
  );
  assert.equal(attribute(totals, "AgonyResistance"), 9);
});

test("a partial rune set applies only the tiers it has earned", () => {
  const totals = buildArmory(makeCharacter(), CATALOGS, 1).totals.A;
  const [runeSet] = totals.runeSets;
  assert.equal(runeSet.count, 4);
  assert.deepEqual(
    runeSet.bonuses.map((bonus) => bonus.active),
    [true, true, true, true, false, false],
  );
  const power = totals.attributes.find((a) => a.key === "Power");
  assert.equal(Object.fromEntries(power.breakdown).Runes, 35 + 65);
});

test("weapon sets are totalled separately", () => {
  const { totals } = buildArmory(makeCharacter(), CATALOGS, 2);
  assert.equal(
    attribute(totals.A, "Power") - attribute(totals.B, "Power"),
    251 - 125,
  );
});

test("derived stats", () => {
  const totals = buildArmory(makeCharacter(), CATALOGS, 2).totals.A;
  const precision = attribute(totals, "Precision");
  const round2 = (value) => Math.round(value * 100) / 100;
  assert.equal(
    derived(totals, "Critical Chance"),
    round2((precision - 895) / 21),
  );
  assert.equal(
    derived(totals, "Critical Damage"),
    round2(150 + attribute(totals, "CritDamage") / 15),
  );
  assert.equal(derived(totals, "Health"), 9212 + 1000 * 10); // Necromancer
  assert.equal(
    derived(totals, "Armor"),
    1000 + sum(ARMOR.map(([, , , , defense]) => defense)),
  );
});

test("every attribute's breakdown sums to its total", () => {
  for (const totals of Object.values(
    buildArmory(makeCharacter(), CATALOGS, 2).totals,
  ))
    for (const a of totals.attributes)
      assert.equal(sum(a.breakdown.map(([, value]) => value)), a.value, a.key);
});

test("pieces carry what the gear tooltip shows", () => {
  const { slots } = buildArmory(makeCharacter(), CATALOGS, 2);
  const greatsword = slots.WeaponA1;
  assert.equal(greatsword.twoHanded, true);
  assert.equal(greatsword.statName, "Berserker's");
  assert.deepEqual([greatsword.minPower, greatsword.maxPower], [995, 1100]);
  assert.equal(slots.WeaponB1.twoHanded, false);

  const coat = slots.Coat;
  assert.equal(coat.statName, "Berserker's", "fixed stats name via the item");
  assert.equal(coat.typeLine, "Light Coat");
  assert.equal(coat.dyes[0].name, "Abyss");
  assert.equal(coat.dyes[1], null);

  const amulet = slots.Amulet;
  assert.equal(amulet.emptyInfusionSlots, 0);
  assert.equal(amulet.infusions[0].name, MIGHTY.name);
  const [ruby] = amulet.upgrades;
  assert.equal(ruby.buff, "", "jewel attributes aren't repeated as buff text");
  assert.equal(ruby.attributes.length, 2);
});

test("effects list the relic first and strip game markup", () => {
  const totals = buildArmory(makeCharacter(), CATALOGS, 2).totals.A;
  assert.equal(totals.effects[0].kind, "Relic");
  assert.ok(totals.effects.some((effect) => effect.kind === "Sigil"));
  assert.equal(totals.effects[0].text, "Deal more damage.\nRefreshes.");
});

test("unknown items are shown as missing instead of failing", () => {
  const character = makeCharacter();
  character.equipment_tabs[1].equipment[0].id = 999999;
  const { slots } = buildArmory(character, CATALOGS, 2);
  assert.equal(slots.Helm.missing, true);
  assert.equal(slots.Helm.name, "Unknown item #999999");
});

test("parseRuneBonus", () => {
  assert.deepEqual(parseRuneBonus("+25 Ferocity"), {
    kind: "flat",
    values: { CritDamage: 25 },
  });
  assert.deepEqual(parseRuneBonus("+10% Condition Duration"), {
    kind: "percent",
    values: { ConditionDuration: 10 },
  });
  const allStats = parseRuneBonus("+12 to All Stats");
  assert.equal(allStats.kind, "flat");
  assert.equal(allStats.values.Power, 12);
  assert.equal(Object.keys(allStats.values).length, 7);
  assert.equal(parseRuneBonus("+15% Might Duration").kind, "text");
  assert.equal(
    parseRuneBonus("Gain might when you use a heal skill.").kind,
    "text",
  );
});

test("referencedIds lists what each catalog must supply", () => {
  const character = makeCharacter();
  const ids = referencedIds(character);
  assert.ok(ids.items.has(DH_RUNE.id) && ids.items.has(MIGHTY.id));
  assert.ok(ids.colors.has(5));
  assert.ok(ids.specializations.has(34));

  // Fixed-stat gear names its stats on the item, so those ids need the items first.
  const axeOnly = { equipment: [{ id: AXE.id, slot: "WeaponA1" }] };
  assert.equal(referencedIds(axeOnly).itemstats.size, 0);
  assert.deepEqual(
    [...referencedIds(axeOnly, CATALOGS.items).itemstats],
    [161],
  );
});

// ---------------------------------------------------------------- builds

test("the elite spec comes from the active build", () => {
  const character = {
    profession: "Necromancer",
    active_build_tab: 2,
    build_tabs: buildTabs(2, { 1: [53, 50, 39], 2: [53, 50, 34] }),
  };
  const build = activeBuild(character, CATALOGS.specializations);
  assert.equal(build.tab, 2);
  assert.equal(build.display, "Reaper");
  assert.equal(build.icon, "Reaper.png");
  assert.deepEqual(
    build.specializations.map((spec) => spec.name),
    ["Death Magic", "Soul Reaping", "Reaper"],
  );
});

test("a core build falls back to the profession", () => {
  const character = {
    profession: "Necromancer",
    build_tabs: buildTabs(1, { 1: [53, 50, 39], 2: [53, 50, 34] }),
  };
  const build = activeBuild(character, CATALOGS.specializations);
  assert.equal(build.elite, null, "tab 2 is inactive");
  assert.equal(build.display, "Necromancer");
  assert.equal(build.icon, "necro.png");
});

test("no build data still names and pictures the profession", () => {
  for (const character of [
    { profession: "Necromancer" },
    {
      profession: "Necromancer",
      build_tabs: buildTabs(1, { 1: [null, null, null] }),
    },
  ]) {
    const build = activeBuild(character, CATALOGS.specializations);
    assert.equal(build.display, "Necromancer");
    assert.deepEqual(build.specializations, []);
    assert.equal(build.icon, "necro.png");
  }
});

test("the armory includes the active build", () => {
  const armory = buildArmory(makeCharacter(), CATALOGS);
  assert.equal(armory.character.build.display, "Reaper");
});
