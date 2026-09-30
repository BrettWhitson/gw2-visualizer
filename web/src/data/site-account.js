import { CACHE_DB_NAME, PRICE_MAX_AGE_MS } from "../config/constants.js";
import { maxAgeFor } from "../core/data-preferences.js";
import { ACCOUNT_MAX_AGE_MS, AccountSession } from "./account-session.js";
import { IndexedDbStore } from "./indexed-db-store.js";
import { PriceBook } from "./price-book.js";

/**
 * The account session and price book as every page uses them: saved in the browser (next to the game data, so
 * Settings → Clear cached data clears them too) and refreshed per the data-updates preference.
 */
const store = () => new IndexedDbStore(CACHE_DB_NAME);

export const createAccountSession = () =>
  new AccountSession({
    cache: store(),
    maxAge: () => maxAgeFor(ACCOUNT_MAX_AGE_MS),
  });

export const createPriceBook = (api) =>
  new PriceBook(api, {
    store: store(),
    maxAge: () => maxAgeFor(PRICE_MAX_AGE_MS),
  });

export const pricesMaxAge = () => maxAgeFor(PRICE_MAX_AGE_MS);
