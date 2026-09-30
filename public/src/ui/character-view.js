import { RARITY_COLORS, FALLBACK_ITEM_COLOR } from "../config/constants.js";
import { SLOT_GROUPS, SLOT_LABELS } from "../model/character-armory.js";
import { escapeHtml } from "../utils/dom.js";
import { formatNumber } from "../utils/format.js";

/** HTML for the character list and one character's armory (paper-doll gear, attribute totals, gear tooltips). */

const rarityStyle = (rarity) =>
  `style="--rarity:${RARITY_COLORS[rarity] ?? FALLBACK_ITEM_COLOR}"`;
const multiline = (text) => escapeHtml(text).replace(/\n/g, "<br>");
const percent = (value) => `${Number(Number(value).toFixed(2))}%`;
const shortUpgradeName = (name) => String(name ?? "").replace(/^Superior /, "");
const icon = (src, className = "") =>
  src
    ? `<img class="${className}" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">`
    : `<span class="${className} no-icon"></span>`;
const SEPARATOR = '<div class="tt-sep"></div>';

// ---------------------------------------------------------------- list

/** @param {{name: string, level: number, race: string, profession: string, build: object, crafting: object[]}[]} characters */
export function characterListHtml(characters, accountName) {
  if (!characters.length)
    return '<p class="empty">No characters on this account, or the key lacks the <b>characters</b> permission.</p>';
  const cards = characters
    .map((character) => {
      const { build } = character;
      const crafting = (character.crafting ?? [])
        .map(
          (discipline) =>
            `<span class="craft-pill${discipline.active ? " on" : ""}">${escapeHtml(discipline.discipline)} ${discipline.rating}</span>`,
        )
        .join("");
      return `<li><a class="char-card" href="#${encodeURIComponent(character.name)}">
        ${icon(build.icon, "spec-icon")}
        <span class="char-text">
          <span class="char-name">${escapeHtml(character.name)}</span>
          <span class="muted">Level ${character.level} ${escapeHtml(character.race)} ${escapeHtml(build.display ?? character.profession)}</span>
          ${crafting ? `<span class="craft-pills">${crafting}</span>` : ""}
        </span>
      </a></li>`;
    })
    .join("");
  return `<h2 class="page-title">${escapeHtml(accountName ?? "Characters")}<span class="muted"> · ${characters.length} character${characters.length === 1 ? "" : "s"}</span></h2>
    <ul class="char-list">${cards}</ul>`;
}

// ---------------------------------------------------------------- tooltips

const attributeLines = (attributes) =>
  attributes
    .map(
      (a) =>
        `<div class="tt-attr">+${formatNumber(a.value)} ${escapeHtml(a.label)}</div>`,
    )
    .join("");

function upgradeHtml(upgrade, runeCounts) {
  let body;
  if (upgrade.kind === "Rune" && upgrade.bonuses.length) {
    const worn = runeCounts[upgrade.id] ?? 0;
    body =
      `<div class="muted">${Math.min(worn, upgrade.bonuses.length)} of ${upgrade.bonuses.length} equipped</div>` +
      upgrade.bonuses
        .map(
          (bonus, index) =>
            `<div class="tt-bonus${index < worn ? " on" : ""}">(${index + 1}): ${escapeHtml(bonus)}</div>`,
        )
        .join("");
  } else {
    body =
      attributeLines(upgrade.attributes) +
      (upgrade.buff
        ? `<div class="tt-attr">${multiline(upgrade.buff)}</div>`
        : "");
  }
  return `<div class="tt-upgrade">${icon(upgrade.icon)}<div>
    <div class="tt-upgrade-name rarity" ${rarityStyle(upgrade.rarity)}>${upgradeName(upgrade, upgrade.name)}</div>${body}</div></div>`;
}

function dyeSwatch(dye) {
  if (!dye) return '<span class="swatch none"></span><span>Default</span>';
  const rgb = (dye.rgb ?? [0, 0, 0]).map(Number).join(",");
  return `<span class="swatch" style="background:rgb(${rgb})"></span><span>${escapeHtml(dye.name)}</span>`;
}

/** The in-game-style tooltip for one equipped piece. */
export function pieceTooltipHtml(piece, runeCounts) {
  let html = `<div class="tt-head">${icon(piece.icon, "tt-icon")}<div>
    <div class="tt-name rarity" ${rarityStyle(piece.rarity)}>${escapeHtml(piece.name)}</div>
    <div class="muted">${escapeHtml(piece.slotLabel)}${piece.count > 1 ? ` · ×${formatNumber(piece.count)}` : ""}</div></div></div>`;
  if (piece.minPower)
    html += `<div>Weapon Strength: <b>${formatNumber(piece.minPower)} – ${formatNumber(piece.maxPower)}</b></div>`;
  if (piece.defense)
    html += `<div>Defense: <b>${formatNumber(piece.defense)}</b></div>`;
  html += attributeLines(piece.attributes);

  const upgrades = [...piece.upgrades, ...piece.infusions]
    .map((upgrade) => upgradeHtml(upgrade, runeCounts))
    .join("");
  const emptySlots = '<div class="tt-empty">Unused Infusion Slot</div>'.repeat(
    piece.emptyInfusionSlots || 0,
  );
  if (upgrades || emptySlots) html += SEPARATOR + upgrades + emptySlots;
  if (piece.description)
    html += `${SEPARATOR}<div class="tt-desc">${multiline(piece.description)}</div>`;
  if (piece.dyes?.some(Boolean))
    html += `${SEPARATOR}<div class="tt-dyes">${piece.dyes.map(dyeSwatch).join("")}</div>`;

  const footer = [
    piece.skin && `Transmuted · ${escapeHtml(piece.skin.name)}`,
    `<span class="rarity" ${rarityStyle(piece.rarity)}>${escapeHtml(piece.rarity)}</span> ${escapeHtml(piece.typeLine ?? "")}`,
    piece.twoHanded && "Two-handed",
    piece.statName && `${escapeHtml(piece.statName)} stats`,
    piece.level && `Required Level: ${piece.level}`,
    piece.charges != null && `${formatNumber(piece.charges)} charges`,
    piece.binding && escapeHtml(piece.binding),
  ].filter(Boolean);
  return `${html}${SEPARATOR}<div class="tt-foot">${footer.map((line) => `<div>${line}</div>`).join("")}</div>${craftingLink(piece)}`;
}

const craftingHref = (id) => `crafting.html#item=${Number(id)}`;

/** Opens the item on the crafting page (legendaries, ascended gear, anything with a recipe). */
const craftingLink = (item) =>
  item.missing || !item.id
    ? ""
    : `<a class="tt-link" href="${craftingHref(item.id)}">Crafting tree →</a>`;

/** An upgrade's or infusion's name, linked to its crafting tree (runes, sigils, jewels and infusions are craftable). */
const upgradeName = (upgrade, text) =>
  upgrade.missing || !upgrade.id
    ? escapeHtml(text)
    : `<a class="tt-upgrade-link" href="${craftingHref(upgrade.id)}" title="Crafting tree">${escapeHtml(text)}</a>`;

const DOT = '<span class="tt-dot">·</span>';

/**
 * Dense variant for the Full view: the tooltip's facts in place, with stats on one line, rune tiers in a grid and
 * the footer on one line.
 */
export function pieceCardHtml(piece, runeCounts) {
  let html = `<div class="tt-head">${icon(piece.icon, "tt-icon")}<div>
    <div class="tt-name rarity" ${rarityStyle(piece.rarity)}>${escapeHtml(piece.name)}</div>
    <div class="muted">${escapeHtml(piece.slotLabel)}${piece.count > 1 ? ` · ×${formatNumber(piece.count)}` : ""}</div></div></div>`;
  const stats = [
    piece.minPower &&
      `<b>${formatNumber(piece.minPower)}–${formatNumber(piece.maxPower)}</b> strength`,
    piece.defense && `<b>${formatNumber(piece.defense)}</b> defense`,
    ...piece.attributes.map(
      (a) =>
        `<span class="tt-attr">+${formatNumber(a.value)} ${escapeHtml(a.label)}</span>`,
    ),
  ].filter(Boolean);
  if (stats.length) html += `<div class="card-flow">${stats.join(DOT)}</div>`;

  const upgrades = [...piece.upgrades, ...piece.infusions].map((upgrade) => {
    let detail = "";
    if (upgrade.kind === "Rune" && upgrade.bonuses.length) {
      const worn = runeCounts[upgrade.id] ?? 0;
      detail =
        ` <span class="muted">${Math.min(worn, upgrade.bonuses.length)}/${upgrade.bonuses.length}</span>` +
        `<div class="card-tiers">${upgrade.bonuses
          .map(
            (bonus, index) =>
              `<span class="tt-bonus${index < worn ? " on" : ""}">(${index + 1}) ${escapeHtml(bonus)}</span>`,
          )
          .join("")}</div>`;
    } else {
      const parts = upgrade.attributes.map(
        (a) => `+${formatNumber(a.value)} ${escapeHtml(a.label)}`,
      );
      if (upgrade.buff)
        parts.push(escapeHtml(upgrade.buff).replace(/\n/g, " "));
      if (parts.length)
        detail = ` <span class="tt-attr">${parts.join(", ")}</span>`;
    }
    return `<div class="card-upgrade">${icon(upgrade.icon)}<div><span class="tt-upgrade-name rarity" ${rarityStyle(upgrade.rarity)}>${upgradeName(upgrade, shortUpgradeName(upgrade.name))}</span>${detail}</div></div>`;
  });
  const empty = piece.emptyInfusionSlots
    ? `<div class="tt-empty">${piece.emptyInfusionSlots} unused infusion slot${piece.emptyInfusionSlots > 1 ? "s" : ""}</div>`
    : "";
  if (upgrades.length || empty) html += SEPARATOR + upgrades.join("") + empty;
  // A relic's text is its whole effect, so it's never clipped; other flavour text is.
  if (piece.description)
    html += `<div class="tt-desc${piece.type === "Relic" ? "" : " card-clamp"}">${multiline(piece.description)}</div>`;

  const footer = [
    `<span class="rarity" ${rarityStyle(piece.rarity)}>${escapeHtml(piece.rarity)}</span> ${escapeHtml(piece.typeLine ?? "")}`,
    piece.twoHanded && "Two-handed",
    piece.statName && escapeHtml(piece.statName),
    piece.level && `Lv ${piece.level}`,
    piece.binding && escapeHtml(piece.binding.replace(/ to .*/, "")),
  ].filter(Boolean);
  const dyes = (piece.dyes ?? []).filter(Boolean);
  const second = [
    piece.skin && `Skin: ${escapeHtml(piece.skin.name)}`,
    dyes.length &&
      `<span class="card-swatches">${piece.dyes
        .map((dye) =>
          dye
            ? `<span class="swatch" title="${escapeHtml(dye.name)}" style="background:rgb(${(dye.rgb ?? [0, 0, 0]).map(Number).join(",")})"></span>`
            : '<span class="swatch none" title="Default"></span>',
        )
        .join("")}</span>`,
  ].filter(Boolean);
  html += `<div class="card-foot">${footer.join(DOT)}</div>`;
  if (second.length) html += `<div class="card-foot">${second.join(DOT)}</div>`;
  return html + craftingLink(piece);
}

function breakdownTooltipHtml(attribute) {
  return `<div class="tt-name">${escapeHtml(attribute.label)} <span class="tt-total">${formatNumber(attribute.value)}</span></div>${SEPARATOR}${attribute.breakdown
    .map(
      ([source, value]) =>
        `<div class="tt-row"><span>${escapeHtml(source)}</span><b>+${formatNumber(value)}</b></div>`,
    )
    .join("")}`;
}

// ---------------------------------------------------------------- armory

/** Shown instead of the gear when the key can't read equipment. */
export const MISSING_BUILDS_NOTICE =
  '<p class="notice">This key lacks the <b>builds</b> permission, so equipment templates and build specializations are unavailable.</p>';

/**
 * The armory page. Hoverable elements carry `data-tip="<key>"`; `tooltips` maps each key to its HTML so the
 * controller can show it on hover, focus or tap. `hasGear: false` (a key without the `builds` permission) leaves out
 * the gear, totals and their controls rather than drawing empty slots and base stats as if they were real.
 */
export function armoryHtml(
  armory,
  weaponSet,
  { view = "icons", hasGear = true } = {},
) {
  const tooltips = new Map();
  const tip = (html) => {
    const key = String(tooltips.size);
    tooltips.set(key, html);
    return `data-tip="${key}"`;
  };
  const { slots, runeCounts, character } = armory;

  const emptyTile = (slot, placeholder = "Empty") =>
    view === "full"
      ? `<div class="gear-card empty"><div class="gear-slot">${escapeHtml(SLOT_LABELS[slot] ?? slot)}</div><div class="muted"><i>${escapeHtml(placeholder)}</i></div></div>`
      : `<div class="gear empty"><span class="gear-icon"></span><span class="gear-text"><span class="gear-slot">${escapeHtml(SLOT_LABELS[slot] ?? slot)}</span><span class="gear-name">${escapeHtml(placeholder)}</span></span></div>`;
  const tile = (slot) => {
    const piece = slots[slot];
    const label = escapeHtml(SLOT_LABELS[slot] ?? slot);
    if (!piece) return emptyTile(slot);
    if (view === "full")
      return `<div class="gear-card" ${rarityStyle(piece.rarity)}>${pieceCardHtml(piece, runeCounts)}</div>`;
    const upgrades = [...piece.upgrades, ...piece.infusions];
    const upgradeLine = upgrades.length
      ? `<span class="gear-upgrades">${upgrades
          .slice(0, 2)
          .map(
            (u) =>
              `${icon(u.icon)}<span>${escapeHtml(shortUpgradeName(u.name))}</span>`,
          )
          .join(
            "",
          )}${upgrades.length > 2 ? `<span class="muted">+${upgrades.length - 2}</span>` : ""}</span>`
      : "";
    const meta = [piece.statName, piece.rarity].filter(Boolean).join(" · ");
    return `<button type="button" class="gear" ${rarityStyle(piece.rarity)} aria-haspopup="dialog" aria-expanded="false" aria-label="${label}: ${escapeHtml(piece.name)}" ${tip(pieceTooltipHtml(piece, runeCounts))}>
      <span class="gear-icon">${icon(piece.icon)}</span>
      <span class="gear-text">
        <span class="gear-slot">${label}</span>
        <span class="gear-name rarity">${escapeHtml(piece.name)}</span>
        ${meta ? `<span class="gear-meta">${escapeHtml(meta)}</span>` : ""}
        ${upgradeLine}
        ${piece.emptyInfusionSlots ? `<span class="gear-meta warn">${piece.emptyInfusionSlots} empty infusion slot${piece.emptyInfusionSlots > 1 ? "s" : ""}</span>` : ""}
      </span>
    </button>`;
  };

  const weaponSets = ["A", "B"]
    .map((set, index) => {
      const [main, off] = SLOT_GROUPS.weapons[set];
      return `<div class="weapon-set${set === weaponSet ? " active" : ""}">
        <button type="button" class="weapon-set-title" data-weapon-set="${set}">Weapon set ${index + 1}</button>
        ${tile(main)}
        ${slots[main]?.twoHanded ? emptyTile(off, "Held by two-handed weapon") : tile(off)}
      </div>`;
    })
    .join("");

  const extras = [
    ...SLOT_GROUPS.aquatic,
    ...[...SLOT_GROUPS.tools, ...SLOT_GROUPS.special].filter(
      (slot) => slot !== "Relic" && slots[slot],
    ),
  ]
    .map((slot) => tile(slot))
    .join("");

  const build = character.build;
  const templateButtons = armory.tabs
    .map(
      (tab) =>
        `<button type="button" data-tab="${tab.tab}" aria-pressed="${tab.tab === armory.tab}"${tab.isActive ? ' title="Active in game"' : ""}>${escapeHtml(tab.name || `Template ${tab.tab}`)}${tab.isActive ? " ★" : ""}</button>`,
    )
    .join("");
  const setButtons = ["A", "B"]
    .map(
      (set, index) =>
        `<button type="button" data-weapon-set="${set}" aria-pressed="${set === weaponSet}">Set ${index + 1}</button>`,
    )
    .join("");
  const crafting = (character.crafting ?? [])
    .map(
      (d) =>
        `<span class="craft-pill${d.active ? " on" : ""}">${escapeHtml(d.discipline)} ${d.rating}</span>`,
    )
    .join("");

  const controls = `<div class="armory-controls">
        <div class="control"><span class="control-label">Gear view</span><div class="seg">
          <button type="button" data-gear-view="icons" aria-pressed="${view !== "full"}" title="Compact tiles; details on hover or tap">Icons</button>
          <button type="button" data-gear-view="full" aria-pressed="${view === "full"}" title="Every slot's details in place">Full</button>
        </div></div>
        ${templateButtons ? `<div class="control"><span class="control-label">Equipment template</span><div class="seg">${templateButtons}</div></div>` : ""}
        <div class="control"><span class="control-label">Stats with weapon</span><div class="seg">${setButtons}</div></div>
        <button type="button" class="share-btn" data-share-open title="Export this template's gear as a PNG: gear only, no stats or account details">Share image</button>
      </div>`;
  const gearHtml =
    () => `${armory.missingItemIds.length ? `<p class="notice">${armory.missingItemIds.length} item${armory.missingItemIds.length > 1 ? "s" : ""} couldn't be looked up in the API, so the totals below may be incomplete. Reload to try again.</p>` : ""}
    <div class="paper-doll view-${view}">
      <div class="gear-column"><h3>Armor</h3>${SLOT_GROUPS.armor.map((slot) => tile(slot)).join("")}</div>
      <div class="stat-column">${statPanelHtml(armory.totals[weaponSet], tip)}</div>
      <div class="gear-column"><h3>Trinkets</h3>${[...SLOT_GROUPS.trinkets, "Relic"].map((slot) => tile(slot)).join("")}</div>
    </div>
    <section class="armory-section"><h3>Weapons</h3><div class="weapon-row">${weaponSets}</div></section>
    <section class="armory-section"><h3>Underwater &amp; tools</h3><div class="extra-row view-${view}">${extras}</div></section>`;

  const html = `
    <a class="back-link" href="#">← All characters</a>
    <div class="armory-head">
      <div>
        <h2 class="page-title">${escapeHtml(character.name)}</h2>
        <div class="armory-sub"${build.specializations.length ? ` title="Active build: ${escapeHtml(build.specializations.map((s) => s.name).join(" / "))}"` : ""}>
          ${icon(build.icon, "spec-icon small")}
          <span>Level ${character.level} ${escapeHtml(character.race)} ${escapeHtml(build.display ?? character.profession)}</span>
          ${build.display && build.display !== character.profession ? `<span class="muted">${escapeHtml(character.profession)}</span>` : ""}
        </div>
        ${crafting ? `<div class="craft-pills">${crafting}</div>` : ""}
      </div>
      ${hasGear ? controls : ""}
    </div>
    ${hasGear ? gearHtml() : MISSING_BUILDS_NOTICE}
    ${bagsHtml(armory.bags, tip)}`;
  return { html, tooltips };
}

/** The character's bags as an inventory grid; each slot's name and count on hover or tap. */
function bagsHtml(bags, tip) {
  if (!bags)
    return `<section class="armory-section"><h3>Bags</h3><p class="muted small">Your API key lacks the <b>inventories</b> permission, so bags can't be read.</p></section>`;
  const slotHtml = (slot) =>
    slot
      ? `<button type="button" class="bag-slot" ${rarityStyle(slot.rarity)} aria-haspopup="dialog" aria-expanded="false" aria-label="${escapeHtml(slot.name)}${slot.count > 1 ? ` ×${slot.count}` : ""}" ${tip(
          `<div class="tt-head">${icon(slot.icon, "tt-icon")}<div><div class="tt-name rarity" ${rarityStyle(slot.rarity)}>${escapeHtml(slot.name)}</div><div class="muted">${slot.count > 1 ? `×${formatNumber(slot.count)} · ` : ""}${escapeHtml(slot.rarity)}${slot.binding ? ` · ${slot.binding === "Character" ? "Soulbound" : "Account Bound"}` : ""}</div></div></div>${craftingLink(slot)}`,
        )}>${icon(slot.icon)}${slot.count > 1 ? `<span class="bag-count">${formatNumber(slot.count)}</span>` : ""}</button>`
      : '<span class="bag-slot empty"></span>';
  const used = bags.flatMap((bag) => bag?.slots ?? []).filter(Boolean).length;
  const total = bags.reduce((sum, bag) => sum + (bag?.size ?? 0), 0);
  const html = bags
    .filter(Boolean)
    .map(
      (bag) =>
        `<div class="bag"><div class="bag-name">${icon(bag.icon)}<span>${escapeHtml(bag.name)}</span><span class="muted">${bag.slots.filter(Boolean).length}/${bag.size}</span></div><div class="bag-grid">${bag.slots.map(slotHtml).join("")}</div></div>`,
    )
    .join("");
  return `<section class="armory-section"><h3>Bags <span class="muted">· ${used} of ${total} slots used</span></h3><div class="bags">${html || '<p class="muted small">No bags.</p>'}</div></section>`;
}

function statPanelHtml(totals, tip) {
  const attributes = totals.attributes
    .map(
      (a) =>
        `<div class="stat-row" tabindex="0" ${tip(breakdownTooltipHtml(a))}><span>${escapeHtml(a.label)}</span><b>${formatNumber(a.value)}</b></div>`,
    )
    .join("");
  const derived = totals.derived
    // Durations are noise on a gear set that has none.
    .filter((d) => d.value || !/Duration/.test(d.label))
    .map(
      (d) =>
        `<div class="stat-row" tabindex="0" ${tip(`<div class="tt-name">${escapeHtml(d.label)}</div><div class="muted">${escapeHtml(d.note)}</div>`)}><span>${escapeHtml(d.label)}</span><b>${d.format === "percent" ? percent(d.value) : formatNumber(d.value)}</b></div>`,
    )
    .join("");
  const runeSets = totals.runeSets
    .map((set) => {
      const active = set.bonuses.filter((b) => b.active).length;
      const tooltip = `<div class="tt-name rarity" ${rarityStyle(set.rarity)}>${escapeHtml(set.name)}</div><div class="muted">On ${set.count} of 6 armor pieces</div>${SEPARATOR}${set.bonuses
        .map(
          (b, i) =>
            `<div class="tt-bonus${b.active ? " on" : ""}">(${i + 1}): ${escapeHtml(b.text)}</div>`,
        )
        .join("")}`;
      return `<div class="effect" tabindex="0" ${tip(tooltip)}>${icon(set.icon)}<div>
        <div class="rarity" ${rarityStyle(set.rarity)}>${escapeHtml(shortUpgradeName(set.name))}</div>
        <div class="muted">${set.count}/6 pieces · ${active} of ${set.bonuses.length} bonuses active</div></div></div>`;
    })
    .join("");
  const effects = totals.effects
    .map((effect) => {
      const tooltip = `<div class="tt-name">${escapeHtml(effect.title)}</div>${effect.source ? `<div class="muted">on ${escapeHtml(effect.source)}</div>` : ""}${SEPARATOR}<div class="tt-desc">${multiline(effect.text)}</div>`;
      return `<div class="effect" tabindex="0" ${tip(tooltip)}>${icon(effect.icon)}<div>
        <div>${escapeHtml(shortUpgradeName(effect.title))}</div>
        <div class="muted effect-text">${escapeHtml(effect.text)}</div></div></div>`;
    })
    .join("");
  return `<div class="stat-panel">
    <h3>Attributes</h3>${attributes}<div class="stat-sep"></div>${derived}
    ${runeSets || effects ? `<h3 class="gap">Set bonuses &amp; effects</h3>${runeSets}${effects}` : ""}
    <p class="muted small">Gear only: base attributes, equipment, runes, jewels and infusions. Traits, boons, food and utilities aren't included, so in-game numbers will be higher.</p>
  </div>`;
}
