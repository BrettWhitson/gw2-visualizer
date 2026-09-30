/**
 * Character armory: one character's equipped gear resolved against the item catalogs, plus attribute totals.
 *
 * Totals are gear only: level-80 base attributes + equipment + upgrades (runes, jewels, infusions). Traits, boons,
 * food and utilities aren't in the character API in a form that can be evaluated, so the UI says so.
 *
 * Inputs are raw GW2 API objects: a `/v2/characters` entry, and catalogs of `/v2/items`, `/v2/itemstats`,
 * `/v2/skins`, `/v2/colors` and `/v2/specializations` keyed by id.
 */

export const ATTRIBUTE_LABELS = {
  Power: "Power",
  Precision: "Precision",
  Toughness: "Toughness",
  Vitality: "Vitality",
  CritDamage: "Ferocity",
  ConditionDamage: "Condition Damage",
  ConditionDuration: "Expertise",
  Healing: "Healing Power",
  BoonDuration: "Concentration",
  AgonyResistance: "Agony Resistance",
};
const ATTRIBUTE_ORDER = Object.keys(ATTRIBUTE_LABELS);
const LABEL_TO_ATTRIBUTE = Object.fromEntries(
  Object.entries(ATTRIBUTE_LABELS).map(([key, label]) => [
    label.toLowerCase(),
    key,
  ]),
);
const ALWAYS_SHOWN = new Set([
  "Power",
  "Precision",
  "Toughness",
  "Vitality",
  "CritDamage",
]);
/** What "+N to All Stats" rune bonuses raise. */
const ALL_STATS = [
  "Power",
  "Precision",
  "Toughness",
  "Vitality",
  "CritDamage",
  "ConditionDamage",
  "Healing",
];

const BASE_ATTRIBUTES = {
  Power: 1000,
  Precision: 1000,
  Toughness: 1000,
  Vitality: 1000,
};
/** Level-80 base health by profession tier. */
const BASE_HEALTH = {
  Warrior: 9212,
  Necromancer: 9212,
  Engineer: 5922,
  Ranger: 5922,
  Mesmer: 5922,
  Revenant: 5922,
  Elementalist: 1645,
  Guardian: 1645,
  Thief: 1645,
};
const DEFAULT_BASE_HEALTH = 1645;

export const SLOT_GROUPS = Object.freeze({
  armor: ["Helm", "Shoulders", "Coat", "Gloves", "Leggings", "Boots"],
  trinkets: [
    "Backpack",
    "Accessory1",
    "Accessory2",
    "Amulet",
    "Ring1",
    "Ring2",
  ],
  weapons: { A: ["WeaponA1", "WeaponA2"], B: ["WeaponB1", "WeaponB2"] },
  aquatic: ["HelmAquatic", "WeaponAquaticA", "WeaponAquaticB"],
  tools: ["Sickle", "Axe", "Pick", "FishingRod"],
  special: ["Relic", "PowerCore", "SensoryArray", "ServiceChip"],
});
export const WEAPON_SETS = ["A", "B"];

export const SLOT_LABELS = {
  Helm: "Head",
  Shoulders: "Shoulders",
  Coat: "Chest",
  Gloves: "Hands",
  Leggings: "Legs",
  Boots: "Feet",
  Backpack: "Back",
  Accessory1: "Accessory",
  Accessory2: "Accessory",
  Amulet: "Amulet",
  Ring1: "Ring",
  Ring2: "Ring",
  WeaponA1: "Main hand",
  WeaponA2: "Off hand",
  WeaponB1: "Main hand",
  WeaponB2: "Off hand",
  HelmAquatic: "Aquatic head",
  WeaponAquaticA: "Aquatic weapon 1",
  WeaponAquaticB: "Aquatic weapon 2",
  Sickle: "Foraging",
  Axe: "Logging",
  Pick: "Mining",
  FishingRod: "Fishing",
  Relic: "Relic",
  PowerCore: "Power core",
  SensoryArray: "Sensory array",
  ServiceChip: "Service chip",
};

const TWO_HANDED = new Set([
  "Greatsword",
  "Hammer",
  "LongBow",
  "ShortBow",
  "Rifle",
  "Staff",
  "Harpoon",
  "Speargun",
  "Trident",
]);
const WEAPON_LABELS = {
  LongBow: "Longbow",
  ShortBow: "Short Bow",
  Harpoon: "Spear",
  Speargun: "Harpoon Gun",
};

/** Which bucket a slot's stats fall into in the per-attribute breakdown. */
const SLOT_CATEGORY = {
  ...Object.fromEntries(SLOT_GROUPS.armor.map((slot) => [slot, "Armor"])),
  ...Object.fromEntries(SLOT_GROUPS.trinkets.map((slot) => [slot, "Trinkets"])),
  ...Object.fromEntries(
    [...SLOT_GROUPS.weapons.A, ...SLOT_GROUPS.weapons.B].map((slot) => [
      slot,
      "Weapons",
    ]),
  ),
};

const WORN_LOCATIONS = new Set(["Equipped", "EquippedFromLegendaryArmory"]);

// ---------------------------------------------------------------- text

/** Strip GW2 markup (`<c=@abilitytype>`, `<br>`) down to plain text. */
export function cleanGameText(text) {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?c(?:=[^>]*)?>/gi, "")
    .trim();
}

/** `{key: value}` → labelled list, largest first like the in-game tooltip. */
export function attributeList(attributes) {
  const rank = (key) => {
    const index = ATTRIBUTE_ORDER.indexOf(key);
    return index < 0 ? 99 : index;
  };
  return Object.entries(attributes)
    .filter(([, value]) => value)
    .sort(([a, x], [b, y]) => y - x || rank(a) - rank(b))
    .map(([key, value]) => ({
      key,
      label: ATTRIBUTE_LABELS[key] ?? key,
      value,
    }));
}

/**
 * Classify one rune bonus line: `{kind: "flat", values}`, `{kind: "percent", values}` (condition / boon duration)
 * or `{kind: "text"}` for an effect rather than a number.
 */
export function parseRuneBonus(text) {
  const line = cleanGameText(text);
  const percent = line.match(
    /^\+(\d+)%\s+(Condition Duration|Boon Duration)\.?$/i,
  );
  if (percent) {
    const key = /^condition/i.test(percent[2])
      ? "ConditionDuration"
      : "BoonDuration";
    return { kind: "percent", values: { [key]: Number(percent[1]) } };
  }
  const flat = line.match(/^\+(\d+)\s+(?:to\s+)?(.+?)\.?$/i);
  if (flat) {
    const amount = Number(flat[1]);
    const label = flat[2].trim().toLowerCase();
    if (label === "all stats" || label === "all attributes")
      return {
        kind: "flat",
        values: Object.fromEntries(ALL_STATS.map((key) => [key, amount])),
      };
    if (label in LABEL_TO_ATTRIBUTE)
      return { kind: "flat", values: { [LABEL_TO_ATTRIBUTE[label]]: amount } };
  }
  return { kind: "text" };
}

// ---------------------------------------------------------------- catalog ids

/**
 * Ids a character's gear needs from each catalog. Item stat ids also come from the items' own fixed stats, so pass
 * `items` once they're loaded to get the complete `itemstats` list.
 */
export function referencedIds(character, items = new Map()) {
  const ids = {
    items: new Set(),
    itemstats: new Set(),
    skins: new Set(),
    colors: new Set(),
    specializations: new Set(),
  };
  for (const piece of allPieces(character)) {
    ids.items.add(piece.id);
    for (const id of piece.upgrades ?? []) ids.items.add(id);
    for (const id of piece.infusions ?? []) ids.items.add(id);
    if (piece.stats?.id) ids.itemstats.add(piece.stats.id);
    const fixedStats = items.get(piece.id)?.details?.infix_upgrade?.id;
    if (fixedStats) ids.itemstats.add(fixedStats);
    if (piece.skin) ids.skins.add(piece.skin);
    for (const dye of piece.dyes ?? []) if (dye) ids.colors.add(dye);
  }
  for (const tab of character.build_tabs ?? [])
    for (const spec of tab.build?.specializations ?? [])
      if (spec?.id) ids.specializations.add(spec.id);
  return ids;
}

function allPieces(character) {
  return [
    ...(character.equipment ?? []),
    ...(character.equipment_tabs ?? []).flatMap((tab) => tab.equipment ?? []),
  ];
}

// ---------------------------------------------------------------- shaping

const isWorn = (piece) =>
  piece.slot && WORN_LOCATIONS.has(piece.location ?? "Equipped");

/** Slots an equipment template holds; everything else is shared by all templates. */
const TEMPLATE_SLOTS = new Set([
  ...SLOT_GROUPS.armor,
  ...SLOT_GROUPS.trinkets,
  ...SLOT_GROUPS.weapons.A,
  ...SLOT_GROUPS.weapons.B,
  ...SLOT_GROUPS.aquatic,
]);

/**
 * The pieces worn in one equipment template, by slot. The relic, gathering tools and jade bot parts live only in
 * the flat `equipment` list, so they're added from it; template slots come from the template alone, since the flat
 * list's armor belongs to whichever template is active. `tab` null means the flat list alone.
 */
function wornPieces(character, tab) {
  const flat = (character.equipment ?? []).filter(isWorn);
  const bySlot = new Map();
  const template = (character.equipment_tabs ?? []).find(
    (candidate) => candidate.tab === tab,
  );
  if (template)
    for (const piece of template.equipment ?? [])
      if (piece.slot) bySlot.set(piece.slot, piece);
  for (const piece of flat)
    if (!template || !TEMPLATE_SLOTS.has(piece.slot))
      bySlot.set(piece.slot, piece);
  return bySlot;
}

function describeUpgrade(id, items) {
  const item = items.get(id);
  if (!item)
    return {
      id,
      name: `Unknown upgrade #${id}`,
      icon: null,
      rarity: "Basic",
      kind: null,
      attributes: [],
      buff: "",
      bonuses: [],
      missing: true,
    };
  const details = item.details ?? {};
  const infix = details.infix_upgrade ?? {};
  const attributes = attributeList(
    Object.fromEntries(
      (infix.attributes ?? []).map((a) => [a.attribute, a.modifier]),
    ),
  );
  return {
    id,
    name: item.name,
    icon: item.icon ?? null,
    rarity: item.rarity,
    kind: details.type ?? null,
    attributes,
    // Jewels and infusions repeat their attributes as buff text; show the buff only when it's the whole description.
    buff: attributes.length ? "" : cleanGameText(infix.buff?.description),
    bonuses: (details.bonuses ?? []).map(cleanGameText),
  };
}

function typeLine(item) {
  const details = item.details ?? {};
  const subtype = details.type;
  switch (item.type) {
    case "Armor":
      return [
        details.weight_class,
        subtype === "HelmAquatic" ? "Aquatic Helm" : subtype,
      ]
        .filter(Boolean)
        .join(" ");
    case "Weapon":
      return WEAPON_LABELS[subtype] ?? subtype;
    case "Back":
      return "Back Item";
    case "Gathering":
      return `${subtype ?? ""} Tool`.trim();
    default:
      return subtype ?? item.type;
  }
}

function binding(piece, item) {
  if (piece.binding === "Character")
    return piece.bound_to ? `Soulbound to ${piece.bound_to}` : "Soulbound";
  if (piece.binding === "Account" || item.flags?.includes("AccountBound"))
    return "Account Bound";
  return null;
}

function describePiece(piece, catalogs) {
  const { items, itemstats, skins, colors } = catalogs;
  const item = items.get(piece.id);
  const base = {
    slot: piece.slot,
    slotLabel: SLOT_LABELS[piece.slot] ?? piece.slot,
    id: piece.id,
  };
  if (!item)
    return {
      ...base,
      name: `Unknown item #${piece.id}`,
      rarity: "Basic",
      icon: null,
      attributes: [],
      upgrades: [],
      infusions: [],
      emptyInfusionSlots: 0,
      dyes: [],
      defense: 0,
      missing: true,
    };

  const details = item.details ?? {};
  // Selectable-stat gear records the choice on the piece; fixed-stat gear carries it on the item.
  let attributes, statId;
  if (piece.stats?.attributes && Object.keys(piece.stats.attributes).length) {
    attributes = { ...piece.stats.attributes };
    statId = piece.stats.id ?? null;
  } else {
    const infix = details.infix_upgrade ?? {};
    attributes = Object.fromEntries(
      (infix.attributes ?? []).map((a) => [a.attribute, a.modifier]),
    );
    statId = Object.keys(attributes).length ? (infix.id ?? null) : null;
  }

  const infusions = (piece.infusions ?? []).map((id) =>
    describeUpgrade(id, items),
  );
  const skin = piece.skin ? skins.get(piece.skin) : null;
  const subtype = details.type;
  return {
    ...base,
    name: item.name,
    icon: skin?.icon ?? item.icon ?? null,
    itemIcon: item.icon ?? null,
    rarity: item.rarity,
    level: item.level,
    type: item.type,
    subtype,
    typeLine: typeLine(item),
    twoHanded: item.type === "Weapon" && TWO_HANDED.has(subtype),
    defense: details.defense ?? 0,
    minPower: details.min_power ?? null,
    maxPower: details.max_power ?? null,
    statId,
    statName: itemstats.get(statId)?.name || null,
    attributes: attributeList(attributes),
    upgrades: (piece.upgrades ?? []).map((id) => describeUpgrade(id, items)),
    infusions,
    emptyInfusionSlots: Math.max(
      0,
      (details.infusion_slots ?? []).length - infusions.length,
    ),
    skin:
      skin && skin.name !== item.name
        ? { name: skin.name, icon: skin.icon ?? null }
        : null,
    dyes: (piece.dyes ?? []).map((id) => {
      const color = id ? colors.get(id) : null;
      return color
        ? { id, name: color.name, rgb: color.cloth?.rgb ?? color.base_rgb }
        : null;
    }),
    binding: binding(piece, item),
    description: cleanGameText(item.description),
    chatLink: item.chat_link ?? null,
    count: piece.count ?? 1,
    charges: piece.charges ?? null,
  };
}

// ---------------------------------------------------------------- totals

/** How many armor pieces carry each rune: sets count armor only. */
export function runeCounts(slots) {
  const counts = {};
  for (const slot of SLOT_GROUPS.armor)
    for (const upgrade of slots[slot]?.upgrades ?? [])
      if (upgrade.kind === "Rune")
        counts[upgrade.id] = (counts[upgrade.id] ?? 0) + 1;
  return counts;
}

/** Attribute totals and derived stats with one weapon set drawn. */
export function totalsFor(slots, weaponSet, profession) {
  const total = Object.fromEntries(ATTRIBUTE_ORDER.map((key) => [key, 0]));
  const parts = Object.fromEntries(ATTRIBUTE_ORDER.map((key) => [key, {}]));
  const add = (key, value, category) => {
    total[key] = (total[key] ?? 0) + value;
    parts[key] ??= {};
    parts[key][category] = (parts[key][category] ?? 0) + value;
  };
  for (const [key, value] of Object.entries(BASE_ATTRIBUTES))
    add(key, value, "Base (level 80)");

  const percent = { ConditionDuration: 0, BoonDuration: 0 };
  let defense = 0;
  const effects = [];

  const counted = [
    ...SLOT_GROUPS.armor,
    ...SLOT_GROUPS.trinkets,
    ...SLOT_GROUPS.weapons[weaponSet],
  ];
  for (const slot of counted) {
    const piece = slots[slot];
    if (!piece) continue;
    defense += piece.defense || 0;
    for (const a of piece.attributes)
      add(a.key, a.value, SLOT_CATEGORY[slot] ?? "Gear");
    for (const upgrade of piece.upgrades) {
      if (upgrade.kind === "Rune") continue; // totalled as a set below
      for (const a of upgrade.attributes) add(a.key, a.value, "Jewels & gems");
      if (upgrade.kind === "Sigil" && upgrade.buff)
        effects.push({
          kind: "Sigil",
          title: upgrade.name,
          icon: upgrade.icon,
          text: upgrade.buff,
          source: piece.name,
        });
    }
    for (const infusion of piece.infusions)
      for (const a of infusion.attributes) add(a.key, a.value, "Infusions");
  }

  const counts = runeCounts(slots);
  const runes = new Map();
  for (const slot of SLOT_GROUPS.armor)
    for (const upgrade of slots[slot]?.upgrades ?? [])
      if (upgrade.kind === "Rune") runes.set(upgrade.id, upgrade);
  const runeSets = [...runes.values()].map((rune) => {
    const earned = Math.min(counts[rune.id] ?? 0, rune.bonuses.length || 6);
    const bonuses = rune.bonuses.map((text, index) => {
      const active = index < earned;
      if (active) {
        const bonus = parseRuneBonus(text);
        if (bonus.kind === "flat")
          for (const [key, value] of Object.entries(bonus.values))
            add(key, value, "Runes");
        else if (bonus.kind === "percent")
          for (const [key, value] of Object.entries(bonus.values))
            percent[key] += value;
      }
      return { text, active };
    });
    return {
      id: rune.id,
      name: rune.name,
      icon: rune.icon,
      rarity: rune.rarity,
      count: counts[rune.id] ?? 0,
      bonuses,
    };
  });

  const relic = slots.Relic;
  if (relic)
    effects.unshift({
      kind: "Relic",
      title: relic.name,
      icon: relic.icon,
      text: relic.description || "",
      source: null,
    });

  const round2 = (value) => Math.round(value * 100) / 100;
  const baseHealth = BASE_HEALTH[profession] ?? DEFAULT_BASE_HEALTH;
  const derived = [
    {
      label: "Critical Chance",
      value: round2(Math.max(0, Math.min(100, (total.Precision - 895) / 21))),
      format: "percent",
      note: "5% base, +1% per 21 Precision above 1000",
    },
    {
      label: "Critical Damage",
      value: round2(150 + total.CritDamage / 15),
      format: "percent",
      note: "150% base, +1% per 15 Ferocity",
    },
    {
      label: "Health",
      value: baseHealth + total.Vitality * 10,
      format: "integer",
      note: [baseHealth, profession, "base + 10 per Vitality"]
        .filter(Boolean)
        .join(" "),
    },
    {
      label: "Armor",
      value: total.Toughness + defense,
      format: "integer",
      note: `Toughness + ${defense} gear defense`,
    },
    {
      label: "Condition Duration",
      value: round2(total.ConditionDuration / 15 + percent.ConditionDuration),
      format: "percent",
      note: "1% per 15 Expertise, plus rune bonuses",
    },
    {
      label: "Boon Duration",
      value: round2(total.BoonDuration / 15 + percent.BoonDuration),
      format: "percent",
      note: "1% per 15 Concentration, plus rune bonuses",
    },
  ];

  const attributes = ATTRIBUTE_ORDER.filter(
    (key) => ALWAYS_SHOWN.has(key) || total[key],
  ).map((key) => ({
    key,
    label: ATTRIBUTE_LABELS[key],
    value: total[key],
    breakdown: Object.entries(parts[key]).sort(([, a], [, b]) => b - a),
  }));

  return { attributes, derived, runeSets, effects, weaponSet };
}

// ---------------------------------------------------------------- builds

/**
 * Specializations of the character's active build template. Build and equipment templates are independent in GW2,
 * so this is looked up separately from the gear tab. `display` is the elite spec's name ("Reaper") or, for a core
 * build, the profession.
 */
export function activeBuild(character, specializations) {
  const tabs = character.build_tabs ?? [];
  const tab =
    tabs.find((candidate) => candidate.is_active) ??
    tabs.find((candidate) => candidate.tab === character.active_build_tab) ??
    tabs[0] ??
    null;
  const specs = (tab?.build?.specializations ?? [])
    .map((spec) => spec && specializations.get(spec.id))
    .filter(Boolean)
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      icon: spec.icon ?? null,
      elite: !!spec.elite,
    }));
  const elite = specs.find((spec) => spec.elite) ?? null;
  // Only elite specializations carry the profession icon.
  const professionIcon =
    [...specializations.values()].find(
      (spec) =>
        spec?.profession === character.profession && spec.profession_icon,
    )?.profession_icon ?? null;
  return {
    tab: tab?.tab ?? null,
    name: tab?.build?.name || null,
    specializations: specs,
    elite,
    display: elite ? elite.name : character.profession,
    icon: elite ? elite.icon : professionIcon,
  };
}

// ---------------------------------------------------------------- entry

/**
 * The armory for one character and equipment template (`tab` null → the active template, or the flat equipment
 * list when the key can't see templates).
 */
export function buildArmory(character, catalogs, tab = null) {
  const tabs = (character.equipment_tabs ?? [])
    .map((candidate) => ({
      tab: candidate.tab,
      name: candidate.name || null,
      isActive: !!candidate.is_active,
    }))
    .sort((a, b) => a.tab - b.tab);
  const chosenTab =
    tab ??
    tabs.find((candidate) => candidate.isActive)?.tab ??
    tabs[0]?.tab ??
    null;

  const slots = {};
  for (const [slot, piece] of wornPieces(character, chosenTab))
    slots[slot] = describePiece(piece, catalogs);

  const profession = character.profession;
  const statIds = new Set(
    Object.values(slots)
      .map((piece) => piece.statId)
      .filter(Boolean),
  );
  return {
    character: {
      name: character.name,
      race: character.race,
      gender: character.gender,
      profession,
      level: character.level,
      age: character.age,
      created: character.created,
      deaths: character.deaths,
      crafting: character.crafting ?? [],
      build: activeBuild(character, catalogs.specializations ?? new Map()),
    },
    tabs,
    tab: chosenTab,
    slots,
    runeCounts: runeCounts(slots),
    totals: Object.fromEntries(
      WEAPON_SETS.map((set) => [set, totalsFor(slots, set, profession)]),
    ),
    defaultSet: slots.WeaponA1 || slots.WeaponA2 ? "A" : "B",
    missingStatIds: [...statIds].filter((id) => !catalogs.itemstats.has(id)),
    // Items the API didn't return: their stats are missing from the totals.
    missingItemIds: Object.values(slots)
      .flatMap((piece) => [
        piece,
        ...(piece.upgrades ?? []),
        ...(piece.infusions ?? []),
      ])
      .filter((entry) => entry.missing)
      .map((entry) => entry.id),
  };
}
