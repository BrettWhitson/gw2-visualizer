import { RARITY_COLORS } from "../config/constants.js";
import { SLOT_GROUPS, SLOT_LABELS } from "../model/character-armory.js";
import { downloadBlob, escapeHtml } from "../utils/dom.js";
import { formatNumber } from "../utils/format.js";

/**
 * "Share image": one equipment template's gear drawn on a canvas, laid out for sharing: gear only, with no attribute
 * totals, account name or wallet. Compact (one row per slot) or Full (every slot as a detail card). Icons come
 * straight from render.guildwars2.com, which allows cross-origin use, so the canvas stays exportable.
 */

const COLORS = {
  background: "#0d1017",
  panel: "#151a24",
  line: "#2a3242",
  text: "#e3e6ec",
  muted: "#8a93a6",
  attribute: "#7fd05c",
  accent: "#d6a74a",
  dot: "#5f584b",
  dimTier: "#6f6a60",
  description: "#cfc8b8",
};
const FONT = '"Segoe UI", system-ui, sans-serif';
const WIDTH = 1200,
  PAD = 28,
  GAP = 20;
const COLUMN = (WIDTH - PAD * 2 - GAP * 2) / 3;
const ROW = 70,
  ICON = 48,
  SUBHEAD = 26;
const rarityColor = (rarity) => RARITY_COLORS[rarity] ?? COLORS.text;
const shortName = (name) => String(name ?? "").replace(/^Superior /, "");

/** @returns {Promise<HTMLCanvasElement>} */
export async function renderShareImage(armory, mode = "compact") {
  const { slots, runeCounts, character } = armory;
  const rowGap = mode === "full" ? 10 : 8;
  const label = (slot) => SLOT_LABELS[slot] ?? slot;

  // Weapons column: per set, the main hand plus the off hand unless two-handed.
  const weaponRows = [];
  ["A", "B"].forEach((set, index) => {
    const [main, off] = SLOT_GROUPS.weapons[set];
    if (!slots[main] && !slots[off]) return;
    weaponRows.push({ head: `Weapon set ${index + 1}` });
    weaponRows.push({ slot: main });
    if (!slots[main]?.twoHanded) weaponRows.push({ slot: off });
  });
  const columns = [
    { title: "Armor", rows: SLOT_GROUPS.armor.map((slot) => ({ slot })) },
    {
      title: "Trinkets",
      rows: [...SLOT_GROUPS.trinkets, "Relic"].map((slot) => ({ slot })),
    },
    { title: "Weapons", rows: weaponRows },
  ];

  // Full cards vary in height: measure every row first (measuring needs a context but draws nothing).
  const measure = document.createElement("canvas").getContext("2d");
  for (const column of columns)
    for (const row of column.rows)
      row.height = row.head
        ? SUBHEAD
        : mode === "full"
          ? drawDetailCard(measure, slots[row.slot], label(row.slot), 0, 0, {
              icons: {},
              runeCounts,
              draw: false,
            })
          : ROW;
  const columnHeight = (column) =>
    column.rows.reduce(
      (sum, row) => sum + row.height + (row.head ? 0 : rowGap),
      0,
    );
  const HEAD = 96,
    TITLE = 26,
    FOOT = 44;
  const height = Math.ceil(
    HEAD + TITLE + Math.max(...columns.map(columnHeight)) + FOOT,
  );

  const icons = await loadIcons(armory);
  const scale = 2; // crisp on high-density screens
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, WIDTH, 4);

  // Header: elite spec (or profession) icon, name, level / race / spec and the template.
  const build = character.build ?? {};
  let textX = PAD;
  if (icons[build.icon]) {
    ctx.drawImage(icons[build.icon], PAD - 4, PAD + 2, 56, 56);
    textX = PAD + 62;
  }
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(
    fitText(ctx, character.name, WIDTH - PAD - textX),
    textX,
    PAD + 30,
  );
  const template = armory.tabs.find((tab) => tab.tab === armory.tab);
  const subtitle = [
    `Level ${character.level} ${character.race} ${build.display ?? character.profession}`,
    template && (template.name || `Equipment template ${template.tab}`),
  ].filter(Boolean);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `15px ${FONT}`;
  ctx.fillText(
    fitText(ctx, subtitle.join("  ·  "), WIDTH - PAD - textX),
    textX,
    PAD + 56,
  );

  columns.forEach((column, columnIndex) => {
    const x = PAD + columnIndex * (COLUMN + GAP);
    let y = HEAD;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(column.title.toUpperCase(), x + 2, y + 14);
    y += TITLE;
    for (const row of column.rows) {
      if (row.head) {
        ctx.fillStyle = COLORS.accent;
        ctx.font = `700 11px ${FONT}`;
        ctx.fillText(row.head.toUpperCase(), x + 2, y + 16);
        y += SUBHEAD;
        continue;
      }
      if (mode === "full")
        drawDetailCard(ctx, slots[row.slot], label(row.slot), x, y, {
          icons,
          runeCounts,
          draw: true,
        });
      else drawGearRow(ctx, slots[row.slot], label(row.slot), x, y, icons);
      y += row.height + rowGap;
    }
  });

  ctx.fillStyle = COLORS.line;
  ctx.fillRect(PAD, height - FOOT + 4, WIDTH - PAD * 2, 1);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(
    `Guild Wars 2 · gear exported ${new Date().toLocaleDateString()} · gw2visualizer.com (unofficial fansite)`,
    PAD,
    height - 16,
  );
  return canvas;
}

/** Every icon the image uses, loaded in parallel; a failed one draws as a blank frame. */
async function loadIcons(armory) {
  const urls = new Set([armory.character.build?.icon]);
  for (const piece of Object.values(armory.slots)) {
    urls.add(piece.icon);
    for (const upgrade of [...piece.upgrades, ...piece.infusions])
      urls.add(upgrade.icon);
  }
  urls.delete(null);
  urls.delete(undefined);
  const icons = {};
  await Promise.all(
    [...urls].map(async (url) => {
      icons[url] = await loadCorsImage(url);
    }),
  );
  return icons;
}

function loadCorsImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous"; // keeps the canvas exportable
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

// ---------------------------------------------------------------- drawing helpers

function fitText(ctx, text, maxWidth) {
  let value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(value + "…").width > maxWidth)
    value = value.slice(0, -1);
  return value + "…";
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function drawIcon(ctx, image, x, y, size, border, radius) {
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  ctx.fillStyle = "#222";
  ctx.fillRect(x, y, size, size);
  if (image) ctx.drawImage(image, x, y, size, size);
  ctx.restore();
  if (border) {
    roundRect(ctx, x, y, size, size, radius);
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawEmptySlot(ctx, label, x, y, height) {
  roundRect(ctx, x, y, COLUMN, height, 9);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText(label.toUpperCase(), x + 14, y + height / 2 - 6);
  ctx.font = `italic 13px ${FONT}`;
  ctx.fillText("Empty", x + 14, y + height / 2 + 12);
}

function drawGearRow(ctx, piece, label, x, y, icons) {
  if (!piece) return drawEmptySlot(ctx, label, x, y, ROW);
  roundRect(ctx, x, y, COLUMN, ROW, 9);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const color = rarityColor(piece.rarity);
  const iconX = x + 11,
    iconY = y + (ROW - ICON) / 2;
  drawIcon(ctx, icons[piece.icon], iconX, iconY, ICON, color, 7);

  const textX = iconX + ICON + 12,
    textWidth = x + COLUMN - textX - 10;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `700 9.5px ${FONT}`;
  ctx.fillText(label.toUpperCase(), textX, y + 16);
  ctx.fillStyle = color;
  ctx.font = `600 14.5px ${FONT}`;
  ctx.fillText(fitText(ctx, piece.name, textWidth), textX, y + 33);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(
    fitText(
      ctx,
      [piece.statName, piece.rarity, piece.twoHanded && "Two-handed"]
        .filter(Boolean)
        .join(" · "),
      textWidth,
    ),
    textX,
    y + 49,
  );

  // Upgrades and infusions: a small icon and short name each, until the row is full.
  const upgrades = [...piece.upgrades, ...piece.infusions];
  const upgradeY = y + 55,
    upgradeIcon = 13;
  let upgradeX = textX;
  ctx.font = `11.5px ${FONT}`;
  for (let index = 0; index < upgrades.length; index++) {
    const upgrade = upgrades[index];
    const name = shortName(upgrade.name);
    const room = x + COLUMN - 10 - upgradeX;
    if (upgradeIcon + 4 + ctx.measureText(name).width > room && index > 0) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`+${upgrades.length - index}`, upgradeX, upgradeY + 10.5);
      break;
    }
    const image = icons[upgrade.icon];
    if (image)
      ctx.drawImage(image, upgradeX, upgradeY, upgradeIcon, upgradeIcon);
    ctx.fillStyle =
      upgrade.kind === "Rune" || upgrade.kind === "Sigil"
        ? COLORS.text
        : COLORS.attribute;
    const shown = fitText(ctx, name, room - upgradeIcon - 4);
    ctx.fillText(shown, upgradeX + upgradeIcon + 4, upgradeY + 10.5);
    upgradeX += upgradeIcon + 4 + ctx.measureText(shown).width + 12;
  }
  if (!upgrades.length && piece.emptyInfusionSlots) {
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(
      `${piece.emptyInfusionSlots} empty infusion slot${piece.emptyInfusionSlots > 1 ? "s" : ""}`,
      textX,
      upgradeY + 10.5,
    );
  }
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Coloured tokens left to right with " · " between them, wrapping when the next one won't fit (no separator at a
 * line start). `y` is the first baseline. Returns the height used; with draw false it only measures.
 */
function flowTokens(ctx, tokens, x, y, maxWidth, lineHeight, draw) {
  const separator = " · ";
  let cursorX = x,
    cursorY = y;
  tokens.forEach((token, index) => {
    ctx.font = token.font;
    const width = Math.min(ctx.measureText(token.text).width, maxWidth);
    const separatorWidth = index ? ctx.measureText(separator).width : 0;
    if (index && cursorX + separatorWidth + width > x + maxWidth) {
      cursorX = x;
      cursorY += lineHeight;
    } else if (index) {
      if (draw) {
        ctx.fillStyle = COLORS.dot;
        ctx.fillText(separator, cursorX, cursorY);
      }
      cursorX += separatorWidth;
    }
    if (draw) {
      ctx.fillStyle = token.color;
      ctx.fillText(fitText(ctx, token.text, maxWidth), cursorX, cursorY);
    }
    cursorX += width;
  });
  return tokens.length ? cursorY - y + lineHeight : 0;
}

/** One slot as a detail card. Returns its height; called once to measure (draw false), then to draw. */
function drawDetailCard(ctx, piece, label, x, y, { icons, runeCounts, draw }) {
  const pad = 12,
    inner = COLUMN - pad * 2;
  const regular = `12.5px ${FONT}`,
    bold = `600 12.5px ${FONT}`,
    small = `11.5px ${FONT}`;
  if (!piece) {
    if (draw) drawEmptySlot(ctx, label, x, y, 54);
    return 54;
  }
  if (draw) {
    const height = drawDetailCard(ctx, piece, label, x, y, {
      icons,
      runeCounts,
      draw: false,
    });
    roundRect(ctx, x, y, COLUMN, height, 9);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const color = rarityColor(piece.rarity);
  let cursor = y + pad;
  const headX = x + pad + 46,
    headWidth = inner - 46;
  if (draw) {
    drawIcon(ctx, icons[piece.icon], x + pad, cursor, 36, color, 6);
    ctx.font = `600 14.5px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(fitText(ctx, piece.name, headWidth), headX, cursor + 15);
    ctx.font = small;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(
      fitText(
        ctx,
        label + (piece.count > 1 ? ` · ×${formatNumber(piece.count)}` : ""),
        headWidth,
      ),
      headX,
      cursor + 31,
    );
  }
  cursor += 45;

  const stats = [];
  if (piece.minPower)
    stats.push({
      text: `${formatNumber(piece.minPower)}–${formatNumber(piece.maxPower)} strength`,
      color: "#ffffff",
      font: bold,
    });
  if (piece.defense)
    stats.push({
      text: `${formatNumber(piece.defense)} defense`,
      color: "#ffffff",
      font: bold,
    });
  for (const a of piece.attributes)
    stats.push({
      text: `+${formatNumber(a.value)} ${a.label}`,
      color: COLORS.attribute,
      font: regular,
    });
  if (stats.length)
    cursor += flowTokens(ctx, stats, x + pad, cursor + 12, inner, 17, draw);

  const upgrades = [...piece.upgrades, ...piece.infusions];
  const emptySlots = piece.emptyInfusionSlots || 0;
  if (upgrades.length || emptySlots) {
    cursor += 5;
    if (draw) {
      ctx.fillStyle = COLORS.line;
      ctx.fillRect(x + pad, cursor, inner, 1);
    }
    cursor += 7;
  }
  for (const upgrade of upgrades) {
    const upgradeX = x + pad + 26,
      upgradeWidth = inner - 26;
    if (draw) drawIcon(ctx, icons[upgrade.icon], x + pad, cursor, 18, null, 3);
    const isRune = upgrade.kind === "Rune" && upgrade.bonuses.length;
    const worn = runeCounts[upgrade.id] ?? 0;
    const tokens = [
      {
        text: shortName(upgrade.name),
        color: rarityColor(upgrade.rarity),
        font: bold,
      },
    ];
    if (isRune)
      tokens.push({
        text: `${Math.min(worn, upgrade.bonuses.length)}/${upgrade.bonuses.length}`,
        color: COLORS.muted,
        font: regular,
      });
    else {
      for (const a of upgrade.attributes)
        tokens.push({
          text: `+${formatNumber(a.value)} ${a.label}`,
          color: COLORS.attribute,
          font: regular,
        });
      for (const line of upgrade.buff ? upgrade.buff.split("\n") : [])
        tokens.push({ text: line, color: COLORS.attribute, font: regular });
    }
    let used = flowTokens(
      ctx,
      tokens,
      upgradeX,
      cursor + 13,
      upgradeWidth,
      17,
      draw,
    );
    if (isRune) {
      // Tiers in as many columns as the widest allows (up to 3).
      ctx.font = small;
      const tiers = upgrade.bonuses.map(
        (bonus, index) => `(${index + 1}) ${bonus}`,
      );
      const widest =
        Math.max(...tiers.map((tier) => ctx.measureText(tier).width)) + 12;
      const columns = Math.max(
        1,
        Math.min(3, Math.floor(upgradeWidth / widest)),
      );
      const columnWidth = upgradeWidth / columns;
      if (draw)
        tiers.forEach((tier, index) => {
          ctx.fillStyle = index < worn ? COLORS.attribute : COLORS.dimTier;
          ctx.fillText(
            fitText(ctx, tier, columnWidth - 6),
            upgradeX + (index % columns) * columnWidth,
            cursor + used + 12 + Math.floor(index / columns) * 15,
          );
        });
      used += Math.ceil(tiers.length / columns) * 15 + 2;
    }
    cursor += Math.max(22, used + 4);
  }
  if (emptySlots) {
    if (draw) {
      ctx.font = regular;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(
        `${emptySlots} unused infusion slot${emptySlots > 1 ? "s" : ""}`,
        x + pad,
        cursor + 12,
      );
    }
    cursor += 18;
  }
  // A relic's description is its whole effect, so it's always shown.
  if (piece.type === "Relic" && piece.description) {
    ctx.font = `12px ${FONT}`;
    const lines = wrapText(ctx, piece.description.replace(/\n/g, " "), inner);
    if (draw) {
      ctx.fillStyle = COLORS.description;
      lines.forEach((line, index) =>
        ctx.fillText(line, x + pad, cursor + 12 + index * 16),
      );
    }
    cursor += lines.length * 16 + 2;
  }
  const footer = [
    {
      text: piece.rarity + (piece.typeLine ? ` ${piece.typeLine}` : ""),
      color,
      font: small,
    },
  ];
  if (piece.statName)
    footer.push({ text: piece.statName, color: COLORS.muted, font: small });
  if (piece.twoHanded)
    footer.push({ text: "Two-handed", color: COLORS.muted, font: small });
  if (piece.skin)
    footer.push({
      text: `Skin: ${piece.skin.name}`,
      color: COLORS.muted,
      font: small,
    });
  cursor += 4;
  cursor += flowTokens(ctx, footer, x + pad, cursor + 11, inner, 15, draw);
  return Math.ceil(cursor + pad - 2 - y);
}

// ---------------------------------------------------------------- dialog

/**
 * The Share image dialog: preview, Compact / Full toggle, Download PNG and Copy image.
 * @param {object} armory  from buildArmory
 * @param {"compact" | "full"} initialMode
 */
export function openShareDialog(armory, initialMode = "compact") {
  document.getElementById("shareDialog")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog id="shareDialog" class="share-dialog" aria-labelledby="shareTitle">
      <div class="share-head">
        <h2 id="shareTitle">Share image</h2>
        <div class="seg">
          <button type="button" data-share-mode="compact">Compact</button>
          <button type="button" data-share-mode="full">Full details</button>
        </div>
      </div>
      <div class="share-body"><p class="loading">Drawing gear…</p></div>
      <div class="share-foot">
        <span class="muted small share-status" role="status"></span>
        <button type="button" data-share="close">Close</button>
        <button type="button" data-share="copy" disabled>Copy image</button>
        <button type="button" class="primary" data-share="download" disabled>Download PNG</button>
      </div>
    </dialog>`,
  );
  const dialog = document.getElementById("shareDialog");
  const body = dialog.querySelector(".share-body");
  const status = dialog.querySelector(".share-status");
  const copyButton = dialog.querySelector('[data-share="copy"]');
  const downloadButton = dialog.querySelector('[data-share="download"]');
  const canCopy = !!(navigator.clipboard && globalThis.ClipboardItem);
  if (!canCopy)
    copyButton.title = "This browser can't copy images; use Download";
  const baseName =
    armory.character.name
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "character";

  let mode = initialMode;
  let blob = null,
    previewUrl = null,
    generation = 0;

  async function draw() {
    const mine = ++generation; // a newer toggle supersedes this render
    for (const button of dialog.querySelectorAll("[data-share-mode]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.shareMode === mode),
      );
    copyButton.disabled = downloadButton.disabled = true;
    status.textContent = "";
    body.innerHTML = '<p class="loading">Drawing gear…</p>';
    try {
      const canvas = await renderShareImage(armory, mode);
      const result = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!result) throw new Error("the browser couldn't encode the image");
      if (mine !== generation || !dialog.isConnected) return;
      blob = result;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      body.innerHTML = `<img class="share-preview" src="${previewUrl}" alt="${escapeHtml(`Gear of ${armory.character.name}`)}">`;
      status.textContent = `${canvas.width / 2} × ${canvas.height / 2}`;
      downloadButton.disabled = false;
      copyButton.disabled = !canCopy;
    } catch (error) {
      if (mine !== generation) return;
      body.innerHTML = `<p class="empty">Couldn't create the image: ${escapeHtml(error.message)}</p>`;
    }
  }

  dialog.addEventListener("click", async (event) => {
    const modeButton = event.target.closest("[data-share-mode]");
    if (modeButton && modeButton.dataset.shareMode !== mode) {
      mode = modeButton.dataset.shareMode;
      draw();
      return;
    }
    const action = event.target.closest("[data-share]")?.dataset.share;
    if (action === "close" || event.target === dialog) dialog.close();
    else if (action === "download" && blob)
      downloadBlob(
        blob,
        `${baseName}${mode === "full" ? "-gear-full" : "-gear"}.png`,
      );
    else if (action === "copy" && blob) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        status.textContent = "Copied: paste it anywhere.";
      } catch {
        status.textContent = "The browser blocked copying; use Download.";
      }
    }
  });
  dialog.addEventListener("close", () => {
    generation++;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    dialog.remove();
  });
  dialog.showModal();
  draw();
}
