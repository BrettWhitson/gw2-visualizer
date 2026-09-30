import { test } from "node:test";
import assert from "node:assert/strict";
import { WikiSources } from "../web/src/data/wiki-sources.js";

const memoryCache = () => {
  const store = new Map();
  return {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
  };
};

test("wiki sources: parsed, cached, and a failure is not retried", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    const query = new URL(url).searchParams.get("query");
    assert.ok(!new URL(url).searchParams.has("Api-User-Agent"));
    const results = query.startsWith("[[Sells item")
      ? {
          "Miyani#vendor1": {
            fulltext: "Miyani#vendor1",
            printouts: {
              "Has vendor": [{ fulltext: "Miyani" }],
              "Located in": [{ fulltext: "Mystic Forge Conservatory" }],
              "Has item quantity": [1],
              "Has item cost": [
                {
                  "Has item value": { item: ["1"] },
                  "Has item currency": { item: ["Spirit Shard"] },
                },
              ],
            },
          },
          "Old#vendor2": {
            fulltext: "Old/historical#vendor2",
            printouts: { "Has vendor": [{ fulltext: "Old/historical" }] },
          },
        }
      : { "Bag of Coins#contains1": { fulltext: "Bag of Coins#contains1" } };
    return new Response(JSON.stringify({ query: { results } }));
  });

  const sources = new WikiSources({ cache: memoryCache() });
  const result = await sources.load(19976);
  assert.equal(result.vendors.length, 1);
  assert.equal(result.vendors[0].costs[0].currency, "Spirit Shard");
  assert.equal(result.historicalVendorCount, 1);
  assert.deepEqual(result.containers, ["Bag of Coins"]);
  assert.equal(calls, 2);
  await sources.load(19976);
  assert.equal(calls, 2, "served from memory");

  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  t.mock.method(console, "warn", () => {});
  assert.equal(await sources.load(1), null);
  const afterFailure = calls;
  assert.equal(sources.peek(1), null, "failure remembered");
  assert.equal(await sources.load(1), null);
  assert.equal(calls, afterFailure, "no retry after a failure");
});
