import {
  CACHE_SCHEMA_VERSION,
  SNAPSHOT_DATA_URL,
  SNAPSHOT_META_URL,
} from "../config/constants.js";

/**
 * Where the core game data (every recipe, and every item / currency / guild upgrade they use) comes from:
 *
 *  1. The published snapshot: one gzip file on the site's own host, rebuilt daily by a GitHub Action
 *     (tools/build-data-snapshot.mjs). This is the normal path, so visitors don't each make ~150 GW2 API requests.
 *  2. The GW2 API directly: only when no snapshot is published (local development, or a host without one).
 *
 * Both produce the same shape as the IndexedDB cache:
 * `{ schemaVersion, buildId, cachedAt, recipes, items, currencies, guildUpgrades }`.
 */

/**
 * The snapshot's small metadata file (build id, when it was generated), or null when there is none.
 * @returns {Promise<{ schemaVersion: number, buildId: number | null, generatedAt: number } | null>}
 */
export async function fetchSnapshotMeta() {
  try {
    const response = await fetch(SNAPSHOT_META_URL, { cache: "no-cache" });
    if (!response.ok) return null;
    const meta = await response.json();
    return meta?.schemaVersion === CACHE_SCHEMA_VERSION ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Download and unpack the snapshot, reporting progress by bytes received. Null when there is none, it's the wrong
 * schema, or the browser can't decompress (no DecompressionStream).
 * @param {(message: string, fraction: number) => void} onProgress
 */
export async function fetchSnapshot(onProgress) {
  if (typeof DecompressionStream === "undefined") return null;
  const response = await fetch(SNAPSHOT_DATA_URL, { cache: "no-cache" });
  if (!response.ok) return null;
  const total = Number(response.headers.get("Content-Length")) || 0;
  const chunks = [];
  let received = 0;
  for (const reader = response.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(
      `Downloading game data… ${(received / 1048576).toFixed(1)} MB`,
      total ? Math.min(0.95, received / total) : 0.5,
    );
  }
  onProgress("Unpacking game data…", 0.97);
  const blob = new Blob(chunks);
  // Some hosts add their own Content-Encoding to .gz files, so the browser may already have unpacked it: only
  // gunzip when the bytes still start with the gzip signature (1f 8b).
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  const body = isGzip
    ? blob.stream().pipeThrough(new DecompressionStream("gzip"))
    : blob;
  const data = await new Response(body).json();
  return data?.schemaVersion === CACHE_SCHEMA_VERSION ? data : null;
}

/**
 * Every recipe from the GW2 API, plus every item / guild upgrade those recipes reference (~150 requests).
 * Used by the snapshot builder, and by the app only when no snapshot is available.
 * @param {import('./gw2-api-client.js').Gw2ApiClient} api
 * @param {(message: string, fraction: number) => void} [onProgress]
 */
export async function downloadCoreDataFromApi(api, onProgress = () => {}) {
  const buildId = await api.getBuildId().catch(() => null);
  onProgress("Fetching recipe list…", 0);
  const recipeIds = await api.getAllRecipeIds();
  const recipes = await api.getRecipes(recipeIds, (done, total) =>
    onProgress(`Recipes ${done}/${total}`, (done / total) * 0.45),
  );

  const itemIds = new Set(),
    guildUpgradeIds = new Set();
  for (const recipe of recipes) {
    if (recipe.outputItemId) itemIds.add(recipe.outputItemId);
    for (const ingredient of recipe.ingredients) {
      if (ingredient.type === "Item") itemIds.add(ingredient.id);
      else if (ingredient.type === "GuildUpgrade")
        guildUpgradeIds.add(ingredient.id);
    }
  }
  const items = await api.getItems(itemIds, {
    onProgress: (done, total) =>
      onProgress(`Items ${done}/${total}`, 0.45 + (done / total) * 0.5),
  });

  onProgress("Currencies & guild upgrades…", 0.96);
  const currencies = await api.getAllCurrencies().catch(() => []);
  const guildUpgrades = await api.getGuildUpgrades(guildUpgradeIds);
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    buildId,
    cachedAt: Date.now(),
    recipes,
    items,
    currencies,
    guildUpgrades,
  };
}

/** Item ids that `recipes` use (as output or ingredient) but `knownItemIds` lacks. */
export function findMissingItemIds(recipes, knownItemIds) {
  const missing = new Set();
  for (const recipe of recipes) {
    if (!recipe.outputItemId) continue;
    for (const id of [
      recipe.outputItemId,
      ...recipe.ingredients.filter((i) => i.type === "Item").map((i) => i.id),
    ])
      if (!knownItemIds.has(id)) missing.add(id);
  }
  return missing;
}
