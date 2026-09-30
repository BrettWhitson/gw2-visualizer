// Build the game-data snapshot the site serves to visitors: every API recipe plus every item, currency and guild
// upgrade they (and the bundled Mystic Forge recipes) reference, gzipped into web/static/data/snapshot/.
// Visitors then download one compressed file from the site's host instead of each making ~150 GW2 API requests.
//
// Run by the deploy workflow once a day (and on every deploy); run it locally to test the snapshot path.
// The output is generated and git-ignored.
// Usage:  node tools/build-data-snapshot.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  Gw2ApiClient,
  normalizeRecipe,
} from "../web/src/data/gw2-api-client.js";
import {
  downloadCoreDataFromApi,
  findMissingItemIds,
} from "../web/src/data/core-data-sources.js";
import forgeData from "../web/data/mystic-forge-recipes.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir = path.join(projectRoot, "web", "static", "data", "snapshot");

const log = (message) => process.stdout.write(`${message}\n`);
let lastProgress = "";
const onProgress = (message) => {
  // Log each phase once rather than every batch.
  const phase = message.replace(/[\d/.,]+.*$/, "").trim();
  if (phase !== lastProgress) log(`… ${message}`);
  lastProgress = phase;
};

const api = new Gw2ApiClient();
const core = await downloadCoreDataFromApi(api, onProgress);

// Items only the Mystic Forge recipes use, so visitors never have to fetch them either.
const forgeRecipes = forgeData.recipes.map((raw) => normalizeRecipe(raw, "mf"));
const missing = findMissingItemIds(
  forgeRecipes,
  new Set(core.items.map((item) => item.id)),
);
if (missing.size) {
  log(`… ${missing.size} items used only by Mystic Forge recipes`);
  core.items.push(...(await api.getItems(missing, { ignoreErrors: true })));
}

const json = JSON.stringify(core);
const packed = gzipSync(json, { level: 9 });
const meta = {
  schemaVersion: core.schemaVersion,
  buildId: core.buildId,
  generatedAt: core.cachedAt,
  recipeCount: core.recipes.length,
  itemCount: core.items.length,
  bytes: packed.length,
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "game-data.json.gz"), packed);
writeFileSync(
  path.join(outputDir, "meta.json"),
  `${JSON.stringify(meta, null, 2)}\n`,
);
log(
  `✓ build ${meta.buildId}: ${meta.recipeCount} recipes, ${meta.itemCount} items → ` +
    `${(packed.length / 1048576).toFixed(2)} MB gzipped (${(json.length / 1048576).toFixed(1)} MB raw)`,
);
