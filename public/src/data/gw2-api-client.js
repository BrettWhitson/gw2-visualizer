import {
  GW2_API_BASE_URL,
  GW2_API_SCHEMA_VERSION,
  API_BATCH_SIZE,
  API_CONCURRENCY,
  PRICE_CONCURRENCY,
  API_REQUEST_TIMEOUT_MS,
} from "../config/constants.js";
import { chunkArray, runWithConcurrency, sleep } from "../utils/async.js";

/** A server's Retry-After longer than this is cut short: a stuck page is worse than one more refused request. */
export const MAX_RETRY_AFTER_MS = 30 * 1000;

/** Thin client for the official Guild Wars 2 API (CORS-enabled, no key needed for these endpoints). */
export class Gw2ApiClient {
  constructor(baseUrl = GW2_API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * GET JSON with a per-request timeout and retry on rate limits / server / network errors (quadratic back-off,
   * or the server's Retry-After, capped at MAX_RETRY_AFTER_MS). `206 Partial Content` (some ids unknown) counts as
   * success, and a `404` for an `ids=` query means "none of these ids exist" → [].
   */
  async fetchJson(path, { retries = 4 } = {}) {
    const url = withSchemaVersion(
      path.startsWith("http") ? path : `${this.baseUrl}${path}`,
    );
    for (let attempt = 0; ; attempt++) {
      let retryAfterMs = null;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
        });
        if (response.ok || response.status === 206)
          return await response.json();
        if (response.status === 404 && url.includes("ids=")) return [];
        const retryAfterSeconds = Number(response.headers.get("Retry-After"));
        if (retryAfterSeconds > 0)
          retryAfterMs = Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
        const error = new Error(
          `HTTP ${response.status} for ${redactAccessToken(url)}`,
        );
        error.status = response.status;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      } catch (error) {
        const retryable = error.retryable ?? true; // network errors and timeouts are retryable
        if (!retryable || attempt >= retries) throw error;
        await sleep(retryAfterMs ?? 600 * (attempt + 1) ** 2);
      }
    }
  }

  /**
   * Fetch `path?ids=…` in batches of 200, several batches in parallel. With `ignoreErrors`, a batch that fails is
   * skipped; pass a `failedIds` set to learn which ids went unanswered that way (as opposed to ids the API doesn't
   * know, which are simply absent from a batch that succeeded).
   * @param {{ onProgress?: (completed: number, total: number) => void, retries?: number, ignoreErrors?: boolean,
   *           concurrency?: number, failedIds?: Set<number> }} [options]
   */
  async fetchByIds(
    path,
    ids,
    {
      onProgress,
      retries,
      ignoreErrors = false,
      concurrency = API_CONCURRENCY,
      failedIds,
    } = {},
  ) {
    const results = [];
    const separator = path.includes("?") ? "&" : "?";
    const tasks = chunkArray([...ids], API_BATCH_SIZE).map(
      (batch) => async () => {
        try {
          results.push(
            ...(await this.fetchJson(
              `${path}${separator}ids=${batch.join(",")}`,
              { retries },
            )),
          );
        } catch (error) {
          if (!ignoreErrors) throw error;
          for (const id of batch) failedIds?.add(id);
        }
      },
    );
    await runWithConcurrency(tasks, concurrency, onProgress);
    return results;
  }

  async getBuildId() {
    return (await this.fetchJson("/build", { retries: 1 })).id;
  }

  getAllRecipeIds() {
    return this.fetchJson("/recipes");
  }

  async getRecipes(ids, onProgress) {
    return (await this.fetchByIds("/recipes", ids, { onProgress })).map((raw) =>
      normalizeRecipe(raw, "api"),
    );
  }

  async getItems(ids, { onProgress, ignoreErrors = false } = {}) {
    return (
      await this.fetchByIds("/items", ids, { onProgress, ignoreErrors })
    ).map(normalizeItem);
  }

  async getAllCurrencies() {
    return (await this.fetchJson("/currencies?ids=all")).map(
      ({ id, name, icon }) => ({ id, name, icon }),
    );
  }

  async getGuildUpgrades(ids) {
    return (
      await this.fetchByIds("/guild/upgrades", ids, { ignoreErrors: true })
    ).map(({ id, name, icon }) => ({ id, name, icon }));
  }

  /**
   * Buy orders (highest first) per item, from the order book; items with no market are absent. Ids in batches that
   * failed are absent too, and added to `failedIds` when given.
   * @param {{ failedIds?: Set<number> }} [options]
   */
  async getBuyOrders(ids, { failedIds } = {}) {
    const raw = await this.fetchByIds("/commerce/listings", ids, {
      retries: 2,
      ignoreErrors: true,
      failedIds,
    });
    return new Map(
      raw.map((listing) => [
        listing.id,
        (listing.buys ?? []).map(({ unit_price, quantity }) => ({
          unitPrice: unit_price,
          quantity,
        })),
      ]),
    );
  }

  /**
   * Trading post prices; untradeable ids are simply absent from the result. Ids in batches that failed are absent
   * too, and added to `failedIds` when given.
   * @param {{ failedIds?: Set<number> }} [options]
   */
  async getPrices(ids, { failedIds } = {}) {
    const raw = await this.fetchByIds("/commerce/prices", ids, {
      retries: 2,
      ignoreErrors: true,
      concurrency: PRICE_CONCURRENCY,
      failedIds,
    });
    return raw.map((price) => ({
      id: price.id,
      buy: price.buys?.unit_price || 0,
      sell: price.sells?.unit_price || 0,
    }));
  }
}

/** Append the pinned `v=` schema version unless the URL already chose one. */
export function withSchemaVersion(url) {
  if (/[?&]v=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(GW2_API_SCHEMA_VERSION)}`;
}

/** Hide an API key in a URL so it never reaches error messages, toasts or logs. */
export const redactAccessToken = (url) =>
  url.replace(/([?&]access_token=)[^&]*/, "$1…");

/**
 * Convert an API (or API-shaped wiki/custom) recipe into the app's recipe shape.
 * @returns {import('../types.js').Recipe}
 */
export function normalizeRecipe(raw, source) {
  const ingredients = (raw.ingredients || []).map((ingredient) => ({
    type: ingredient.type || "Item",
    id:
      ingredient.type === "Named"
        ? ingredient.name
        : (ingredient.id ?? ingredient.item_id),
    count: ingredient.count,
  }));
  for (const guildIngredient of raw.guild_ingredients || []) {
    ingredients.push({
      type: "GuildUpgrade",
      id: guildIngredient.upgrade_id,
      count: guildIngredient.count,
    });
  }
  return {
    id: raw.id,
    source,
    type: raw.type,
    outputItemId: raw.output_item_id,
    outputCount: raw.output_item_count || 1,
    disciplines: raw.disciplines || [],
    minRating: raw.min_rating ?? 0,
    craftTimeMs: raw.time_to_craft_ms || 0,
    flags: raw.flags || [],
    ingredients,
  };
}

/** @returns {import('../types.js').Item} */
export function normalizeItem(raw) {
  return {
    id: raw.id,
    name: raw.name,
    icon: raw.icon,
    rarity: raw.rarity,
    type: raw.type,
    level: raw.level,
    chatLink: raw.chat_link,
    flags: raw.flags || [],
  };
}
