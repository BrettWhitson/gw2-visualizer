import {
  EXPORT_MAX_SIDE_PX,
  FORGE_BADGE_URI,
  UI_COLORS,
} from "../config/constants.js";
import { loadImage } from "../utils/dom.js";

/**
 * Compose a shareable PNG: a title bar, the full graph (with whatever highlight is active), and a legend band.
 *
 * @param {{ graphView: import('./webgl-graph-view.js').WebGLGraphView, title: string, titleColor: string, subtitle: string,
 *           legendEntries: { key: string, label: string, color: string, count: number, border?: string, image?: string }[],
 *           selectedLegendKeys: Set<string>, footer?: string }} options
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function composeGraphPng({
  graphView,
  title,
  titleColor,
  subtitle,
  legendEntries,
  selectedLegendKeys,
  footer = "",
}) {
  // Export at 2× when possible, but keep each side within safe canvas limits for huge trees.
  const bounds = graphView.boundingBox();
  const scale = Math.max(
    0.25,
    Math.min(
      2,
      EXPORT_MAX_SIDE_PX / Math.max(bounds.w, 1),
      EXPORT_MAX_SIDE_PX / Math.max(bounds.h, 1),
    ),
  );
  const px = (value) => value * scale;
  const font = (size, weight = 400) =>
    `${weight} ${px(size)}px "Segoe UI", system-ui, sans-serif`;

  const graphImage = await loadImage(
    graphView.toPngDataUri({ scale, backgroundColor: UI_COLORS.canvas }),
  );
  const badgeImage = await loadImage(FORGE_BADGE_URI);

  const padding = px(20),
    chipHeight = px(24),
    chipGap = px(6),
    swatchSize = px(12);
  const width = Math.max(graphImage.width, px(720));
  const legendRows = layoutLegendChips(legendEntries, {
    width,
    padding,
    chipGap,
    swatchSize,
    font: font(12),
    scale,
  });
  const headerHeight = px(64);
  const legendHeight = legendEntries.length
    ? legendRows.length * (chipHeight + chipGap) + padding
    : 0;
  const footerLines = footer
    ? wrapText(footer, { width: width - 2 * padding, font: font(10) })
    : [];
  const footerHeight = footerLines.length
    ? footerLines.length * px(14) + padding
    : 0;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height =
    headerHeight + graphImage.height + legendHeight + footerHeight;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = UI_COLORS.canvas;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Title bar
  ctx.textBaseline = "alphabetic";
  ctx.font = font(20, 700);
  ctx.fillStyle = titleColor;
  ctx.fillText(title, padding, px(32));
  ctx.font = font(12);
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(subtitle, padding, px(52));
  ctx.fillStyle = UI_COLORS.line;
  ctx.fillRect(0, headerHeight - scale, width, scale);

  ctx.drawImage(
    graphImage,
    Math.round((width - graphImage.width) / 2),
    headerHeight,
  );

  // Legend band
  let rowTop = headerHeight + graphImage.height + padding / 2;
  if (legendEntries.length) {
    ctx.fillStyle = UI_COLORS.line;
    ctx.fillRect(0, rowTop - padding / 2, width, scale);
  }
  const anySelected = selectedLegendKeys.size > 0;
  for (const row of legendRows) {
    for (const chip of row) {
      drawLegendChip(ctx, chip, {
        top: rowTop,
        chipHeight,
        swatchSize,
        scale,
        font,
        badgeImage,
        isSelected: selectedLegendKeys.has(chip.entry.key),
        anySelected,
      });
    }
    rowTop += chipHeight + chipGap;
  }
  ctx.globalAlpha = 1;

  // Footer: required legal notice.
  if (footerLines.length) {
    ctx.font = font(10);
    ctx.fillStyle = UI_COLORS.muted;
    ctx.textBaseline = "alphabetic";
    let lineTop = canvas.height - footerHeight + padding / 2 + px(10);
    for (const line of footerLines) {
      ctx.fillText(line, padding, lineTop);
      lineTop += px(14);
    }
  }

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return { blob, width: canvas.width, height: canvas.height };
}

/** Greedy word wrap for canvas text. */
function wrapText(text, { width, font }) {
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

/** Flow chips left→right, wrapping to new rows. */
function layoutLegendChips(
  entries,
  { width, padding, chipGap, swatchSize, font, scale },
) {
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const rows = [[]];
  let cursorX = padding;
  for (const entry of entries) {
    const text = `${entry.label}  ${entry.count}`;
    const chipWidth = swatchSize + 18 * scale + measure.measureText(text).width;
    if (cursorX + chipWidth > width - padding && rows.at(-1).length) {
      rows.push([]);
      cursorX = padding;
    }
    rows.at(-1).push({ entry, text, x: cursorX, width: chipWidth });
    cursorX += chipWidth + chipGap;
  }
  return rows;
}

function drawLegendChip(
  ctx,
  chip,
  {
    top,
    chipHeight,
    swatchSize,
    scale,
    font,
    badgeImage,
    isSelected,
    anySelected,
  },
) {
  const { entry, text, x, width } = chip;
  ctx.globalAlpha = anySelected && !isSelected ? 0.5 : 1;
  ctx.fillStyle = isSelected ? UI_COLORS.highlightChipFill : UI_COLORS.panel;
  ctx.strokeStyle = isSelected ? UI_COLORS.accent : UI_COLORS.line;
  ctx.lineWidth = scale;
  ctx.beginPath();
  ctx.roundRect(x, top, width, chipHeight, 5 * scale);
  ctx.fill();
  ctx.stroke();

  const swatchX = x + 6 * scale,
    swatchY = top + (chipHeight - swatchSize) / 2;
  if (entry.image) {
    ctx.drawImage(badgeImage, swatchX, swatchY, swatchSize, swatchSize);
  } else {
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash(entry.border === "dashed" ? [3 * scale, 2 * scale] : []);
    ctx.strokeRect(
      swatchX + scale,
      swatchY + scale,
      swatchSize - 2 * scale,
      swatchSize - 2 * scale,
    );
    if (entry.border === "double") {
      ctx.lineWidth = scale;
      ctx.strokeRect(
        swatchX + 4 * scale,
        swatchY + 4 * scale,
        swatchSize - 8 * scale,
        swatchSize - 8 * scale,
      );
    }
    ctx.setLineDash([]);
  }

  ctx.font = font(12, isSelected ? 600 : 400);
  ctx.fillStyle = isSelected ? UI_COLORS.accentLight : UI_COLORS.text;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + swatchSize + 12 * scale, top + chipHeight / 2 + scale);
}
