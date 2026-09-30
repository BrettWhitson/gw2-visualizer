import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AccountClient,
  CharacterCatalogs,
  looksLikeApiKey,
} from "../public/src/data/account-client.js";
import { redactAccessToken } from "../public/src/data/gw2-api-client.js";

const KEY =
  "564F181A-F0FC-114A-A55D-3C1DCD45F3767AF3848F-AB29-4EBF-9594-F91E6A75E015";

/** API stand-in: records every path, answers ids= requests from `catalog`. */
function createFakeApi(catalog = {}) {
  const calls = [];
  return {
    calls,
    fetchJson: async (path) => {
      calls.push(path);
      if (path.startsWith("/specializations"))
        return [{ id: 34, name: "Reaper", profession: "Necromancer" }];
      return { path };
    },
    fetchByIds: async (path, ids) => {
      calls.push(`${path}?ids=${ids.join(",")}`);
      return ids.map((id) => catalog[path]?.[id]).filter(Boolean);
    },
  };
}

test("API keys are recognised by shape", () => {
  assert.equal(looksLikeApiKey(KEY), true);
  assert.equal(looksLikeApiKey(` ${KEY.toLowerCase()}\n`), true);
  assert.equal(looksLikeApiKey("not-a-key"), false);
  assert.equal(looksLikeApiKey(KEY.slice(0, 36)), false);
});

test("the key goes only on authenticated requests, and never into error text", async () => {
  const api = createFakeApi();
  const client = new AccountClient(` ${KEY} `, api);
  await client.tokenInfo();
  await client.characters();
  assert.deepEqual(api.calls, [
    `/tokeninfo?access_token=${KEY}`,
    `/characters?ids=all&access_token=${KEY}`,
  ]);
  assert.equal(
    redactAccessToken(
      `https://x/v2/characters?ids=all&access_token=${KEY}&v=1`,
    ),
    "https://x/v2/characters?ids=all&access_token=…&v=1",
  );
});

test("catalogs fetch each id once, and item stats after the items that name them", async () => {
  const api = createFakeApi({
    "/items": {
      10: { id: 10, details: { infix_upgrade: { id: 161 } } },
      11: { id: 11 },
    },
    "/itemstats": { 161: { id: 161, name: "Berserker's" } },
    "/colors": { 5: { id: 5, name: "Abyss" } },
  });
  const catalogs = new CharacterCatalogs(api);
  const character = {
    equipment: [{ id: 10, slot: "Coat", dyes: [5, null], upgrades: [11] }],
  };
  await catalogs.loadFor(character);
  assert.equal(catalogs.itemstats.get(161).name, "Berserker's");
  assert.equal(catalogs.colors.get(5).name, "Abyss");
  assert.equal(catalogs.specializations.get(34).name, "Reaper");
  assert.ok(
    api.calls.every((path) => !path.includes("access_token")),
    "catalogs are public: no key",
  );

  const before = api.calls.length;
  await catalogs.loadFor(character);
  assert.equal(api.calls.length, before, "a second character reuses the cache");
});
