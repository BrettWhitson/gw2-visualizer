import {
  CACHE_SCHEMA_VERSION,
  CACHE_MAX_AGE_MS,
  CACHE_KEYS,
  CUSTOM_RECIPES_URL,
  EntityKind,
  RecipeSource,
  RARITY_COLORS,
  ENTITY_KIND_COLORS,
  FALLBACK_ITEM_COLOR,
} from "../config/constants.js";
import { normalizeRecipe } from "./gw2-api-client.js";
import {
  downloadCoreDataFromApi,
  fetchSnapshot,
  fetchSnapshotMeta,
  findMissingItemIds,
} from "./core-data-sources.js";

/** The generated forge data is ~700 KB, so it's loaded in parallel with the API data instead of up front. */
const loadMysticForgeData = () =>
  import("../../data/mystic-forge-recipes.js")
    .then((module) => module.default)
    .catch((error) => {
      console.warn(
        "Mystic Forge data unavailable; continuing with API recipes only",
        error,
      );
      return { recipes: [] };
    });

/**
 * All static game data the app needs: items, currencies, guild upgrades and every recipe indexed by output.
 *
 * Sources, in priority order (the first recipe for an item is its default):
 *  1. the official API (cached in IndexedDB, refreshed when the game build changes or after 7 days)
 *  2. Mystic Forge recipes scraped from the wiki (data/mystic-forge-recipes.js)
 *  3. the user's data/custom-recipes.json
 */
export class GameData {
  /** @type {Map<number, import('../types.js').Item>} */ items = new Map();
  currencies = new Map();
  guildUpgrades = new Map();
  /** @type {Map<number, import('../types.js').Recipe[]>} */ recipesByOutputId =
    new Map();
  /** Summary of what was loaded, for the status bar. */
  summary = null;
  #consumersByIngredientId = null;

  /**
   * @param {{ apiClient: import('./gw2-api-client.js').Gw2ApiClient, cache: import('./indexed-db-store.js').IndexedDbStore }} deps
   */
  constructor({
    apiClient,
    cache,
    snapshot = { fetchMeta: fetchSnapshotMeta, fetchData: fetchSnapshot },
  }) {
    this.api = apiClient;
    this.cache = cache;
    this.snapshot = snapshot;
  }

  /**
   * Everything that doesn't depend on the core data (forge data, custom recipes, the extra-items cache) loads in
   * parallel with it. A recent cache is used immediately; the game build is checked in the background and
   * `onUpdateAvailable` fires if it changed (the caller decides when to re-download).
   * @param {{ forceRefresh?: boolean, onProgress?: (message: string, fraction: number) => void,
   *           onUpdateAvailable?: (buildId: number) => void }} [options]
   */
  async load({
    forceRefresh = false,
    onProgress = () => {},
    onUpdateAvailable,
  } = {}) {
    const cachedExtraItems = this.cache
      .get(CACHE_KEYS.extraItems)
      .catch(() => null);
    const [coreData, mysticForgeData, customRecipesRaw] = await Promise.all([
      this.#loadCoreData(forceRefresh, onProgress, onUpdateAvailable),
      loadMysticForgeData(),
      this.#fetchCustomRecipes(),
    ]);
    this.items.clear();
    this.currencies.clear();
    this.guildUpgrades.clear();
    this.recipesByOutputId.clear();
    this.#consumersByIngredientId = null;
    coreData.items.forEach((item) => this.items.set(item.id, item));
    coreData.currencies.forEach((currency) =>
      this.currencies.set(currency.id, currency),
    );
    coreData.guildUpgrades.forEach((upgrade) =>
      this.guildUpgrades.set(upgrade.id, upgrade),
    );

    const forgeRecipes = (mysticForgeData?.recipes || []).map((raw) =>
      normalizeRecipe(raw, RecipeSource.mysticForge),
    );
    const customRecipes = customRecipesRaw.map((raw) =>
      normalizeRecipe(raw, RecipeSource.custom),
    );
    for (const recipe of [
      ...coreData.recipes,
      ...forgeRecipes,
      ...customRecipes,
    ])
      this.#indexRecipe(recipe);

    await this.#loadItemsReferencedByExtraRecipes(
      [...forgeRecipes, ...customRecipes],
      onProgress,
      cachedExtraItems,
    );
    this.#classifyForgePromotions(forgeRecipes);

    this.summary = {
      apiRecipeCount: coreData.recipes.length,
      forgeRecipeCount: forgeRecipes.length,
      customRecipeCount: customRecipes.length,
      itemCount: this.items.size,
      buildId: coreData.buildId,
      cachedAt: coreData.cachedAt,
    };
    return this.summary;
  }

  // ---------------------------------------------------------------- queries

  /** @returns {import('../types.js').Recipe[]} */
  getRecipes(itemId) {
    return this.recipesByOutputId.get(itemId) ?? [];
  }

  hasRecipe(itemId) {
    return this.recipesByOutputId.has(itemId);
  }

  /** True when the item can only be made in the Mystic Forge (and not merely promoted there). */
  isForgeOnlyItem(itemId) {
    const recipes = this.recipesByOutputId.get(itemId);
    return (
      !!recipes &&
      recipes.every((r) => r.source === RecipeSource.mysticForge) &&
      recipes.some((r) => !r.isPromotion)
    );
  }

  /** True when a non-promotion Mystic Forge recipe exists for the item. */
  hasForgeRecipe(itemId) {
    return this.getRecipes(itemId).some(
      (r) => r.source === RecipeSource.mysticForge && !r.isPromotion,
    );
  }

  /** Items whose recipes use this item as an ingredient ("Used in"). Built lazily on first use. */
  getConsumers(itemId) {
    if (!this.#consumersByIngredientId) {
      this.#consumersByIngredientId = new Map();
      for (const recipes of this.recipesByOutputId.values()) {
        for (const recipe of recipes) {
          for (const ingredient of recipe.ingredients) {
            if (ingredient.type !== "Item") continue;
            if (!this.#consumersByIngredientId.has(ingredient.id))
              this.#consumersByIngredientId.set(ingredient.id, new Set());
            this.#consumersByIngredientId
              .get(ingredient.id)
              .add(recipe.outputItemId);
          }
        }
      }
    }
    return this.#consumersByIngredientId.get(itemId) ?? new Set();
  }

  /**
   * Display info for any node kind.
   * @returns {import('../types.js').Entity}
   */
  getEntity(kind, entityId) {
    if (kind === EntityKind.named) {
      return {
        name: `Any ${entityId}`.replace(/\s*\(ingredient\)/, ""),
        icon: null,
        type: "Generic ingredient",
        flags: [],
      };
    }
    const source =
      kind === EntityKind.currency
        ? this.currencies
        : kind === EntityKind.guildUpgrade
          ? this.guildUpgrades
          : this.items;
    const record = source.get(entityId);
    return {
      name:
        record?.name ||
        `${kind === EntityKind.item ? "Item" : kind} #${entityId}`,
      icon: record?.icon || null,
      rarity: record?.rarity,
      type: record?.type,
      level: record?.level,
      chatLink: record?.chatLink,
      flags: record?.flags || [],
    };
  }

  /** Rarity colour for items, kind colour for everything else. */
  getEntityColor(kind, entityId) {
    if (kind !== EntityKind.item) return ENTITY_KIND_COLORS[kind];
    return (
      RARITY_COLORS[this.items.get(entityId)?.rarity] || FALLBACK_ITEM_COLOR
    );
  }

  // ---------------------------------------------------------------- loading

  /**
   * Core data, cheapest source first:
   *  1. the IndexedDB cache, if under a week old (then, in the background, one tiny request for the snapshot's
   *     metadata to see whether newer data has been published → `onUpdateAvailable`);
   *  2. the published snapshot (one compressed file from this site);
   *  3. the GW2 API, only when no snapshot exists (e.g. local development).
   * `forceRefresh` skips the cache (Settings → Reload game data) but still prefers the snapshot.
   */
  async #loadCoreData(forceRefresh, onProgress, onUpdateAvailable) {
    let cached = null;
    if (!forceRefresh) {
      try {
        cached = migrateLegacyCache(await this.cache.get(CACHE_KEYS.coreData));
      } catch {
        /* no cache */
      }
    }
    if (cached && Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS) {
      this.#checkForNewerData(cached, onUpdateAvailable);
      return cached;
    }

    try {
      const fresh =
        (await this.#loadSnapshot(onProgress)) ??
        (await downloadCoreDataFromApi(this.api, onProgress));
      try {
        await this.cache.set(CACHE_KEYS.coreData, fresh);
      } catch (error) {
        console.warn("Cache write failed", error);
      }
      return fresh;
    } catch (error) {
      if (!cached) throw error;
      console.warn("Refresh failed, using stale cache", error);
      return cached;
    }
  }

  async #loadSnapshot(onProgress) {
    if (!this.snapshot) return null;
    try {
      return await this.snapshot.fetchData(onProgress);
    } catch (error) {
      console.warn("Game data snapshot unavailable; using the GW2 API", error);
      return null;
    }
  }

  /**
   * Is there newer data than the cache? Asks the snapshot's metadata (same host, tiny) rather than the GW2 API, so
   * returning visitors make no GW2 API requests at all on startup. Without a snapshot, falls back to /v2/build.
   */
  async #checkForNewerData(cached, onUpdateAvailable) {
    if (!onUpdateAvailable) return;
    const meta = this.snapshot ? await this.snapshot.fetchMeta() : null;
    if (meta) {
      if (meta.generatedAt > cached.cachedAt && meta.buildId !== cached.buildId)
        onUpdateAvailable(meta.buildId);
      return;
    }
    const buildId = await this.api.getBuildId().catch(() => null);
    if (buildId && cached.buildId && buildId !== cached.buildId)
      onUpdateAvailable(buildId);
  }

  async #fetchCustomRecipes() {
    try {
      const response = await fetch(CUSTOM_RECIPES_URL);
      if (!response.ok) return [];
      const recipes = await response.json();
      return Array.isArray(recipes) ? recipes : [];
    } catch {
      return [];
    }
  }

  /** Wiki / custom recipes can reference items no API recipe uses; fetch those once and cache them separately. */
  async #loadItemsReferencedByExtraRecipes(
    extraRecipes,
    onProgress,
    cachedExtraItemsRequest,
  ) {
    const cachedExtraItems = ((await cachedExtraItemsRequest) || []).map(
      migrateLegacyItem,
    );
    for (const item of cachedExtraItems)
      if (!this.items.has(item.id)) this.items.set(item.id, item);

    const missingIds = findMissingItemIds(
      extraRecipes,
      new Set(this.items.keys()),
    );
    if (!missingIds.size) return;

    const fetched = await this.api.getItems(missingIds, {
      ignoreErrors: true,
      onProgress: (done, total) =>
        onProgress(`Mystic Forge items ${done}/${total}`, done / total),
    });
    for (const item of fetched) this.items.set(item.id, item);
    try {
      await this.cache.set(CACHE_KEYS.extraItems, [
        ...cachedExtraItems,
        ...fetched,
      ]);
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Mark Mystic Forge "material promotions". They're skipped unless the "Include promotions" setting is on,
   * and don't count as forge results:
   *  - self-catalysed (1 Vicious Claw + 50 Large Claws → ~7 Vicious Claws) or random-yield recipes, or
   *  - tradeable crafting materials (lodestones, cores…) that are normally bought, unlike account-bound gifts.
   */
  #classifyForgePromotions(forgeRecipes) {
    for (const recipe of forgeRecipes) {
      const output = this.items.get(recipe.outputItemId);
      const isTradeableMaterial =
        output?.type === "CraftingMaterial" &&
        !output.flags.includes("AccountBound");
      const isSelfCatalysed = recipe.ingredients.some(
        (i) => i.type === "Item" && i.id === recipe.outputItemId,
      );
      recipe.isPromotion =
        isTradeableMaterial ||
        isSelfCatalysed ||
        !Number.isInteger(recipe.outputCount);
    }
  }

  #indexRecipe(recipe) {
    if (!recipe.outputItemId) return;
    if (!this.recipesByOutputId.has(recipe.outputItemId))
      this.recipesByOutputId.set(recipe.outputItemId, []);
    this.recipesByOutputId.get(recipe.outputItemId).push(recipe);
  }
}

// ---------------------------------------------------------------- cache migration (pre-refactor field names)

/** Convert a v1 cache ({ v, build, time, recipes: [{out, ing: [{t,id,n}]…}], guild }) to the current shape. */
function migrateLegacyCache(data) {
  if (!data) return null;
  if (data.schemaVersion === CACHE_SCHEMA_VERSION) return data;
  if (data.v !== 1) return null; // unknown shape → re-download
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    buildId: data.build,
    cachedAt: data.time,
    recipes: data.recipes.map((r) => ({
      id: r.id,
      source: r.source,
      type: r.type,
      outputItemId: r.out,
      outputCount: r.outCount,
      disciplines: r.disc,
      minRating: r.rating,
      craftTimeMs: r.time,
      flags: r.flags,
      ingredients: r.ing.map((i) => ({ type: i.t, id: i.id, count: i.n })),
    })),
    items: data.items.map(migrateLegacyItem),
    currencies: data.currencies,
    guildUpgrades: data.guild,
  };
}

function migrateLegacyItem(item) {
  if (!("chat" in item)) return item;
  const { chat, ...rest } = item;
  return { ...rest, chatLink: chat };
}
