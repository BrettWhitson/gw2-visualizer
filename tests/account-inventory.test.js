import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestCraftingLevels,
  collectStacks,
  craftingRequirement,
  itemLocations,
  ownedItemCounts,
  Storage,
} from "../public/src/model/account-inventory.js";
import { AccountSession } from "../public/src/data/account-session.js";

const KEY =
  "564F181A-F0FC-114A-A55D-3C1DCD45F3767AF3848F-AB29-4EBF-9594-F91E6A75E015";

// Shapes follow the real endpoints: empty slots are null, material storage lists every slot (count 0 included).
const RESPONSES = {
  bank: [
    { id: 19721, count: 250 },
    null,
    { id: 24277, count: 3, binding: "Account" },
  ],
  shared: [null, { id: 19721, count: 5 }],
  materials: [
    { id: 19721, category: 5, count: 1000 },
    { id: 24295, category: 5, count: 0 },
  ],
  characters: [
    {
      name: "Alt",
      crafting: [
        { discipline: "Weaponsmith", rating: 400, active: true },
        { discipline: "Jeweler", rating: 500, active: false },
      ],
      bags: [
        { id: 8932, size: 20, inventory: [{ id: 24277, count: 7 }, null] },
        null, // an empty bag slot
      ],
    },
    {
      name: "Main",
      crafting: [{ discipline: "Weaponsmith", rating: 500, active: true }],
      bags: [],
    },
  ],
  delivery: { coins: 100, items: [{ id: 19721, count: 2 }] },
  wallet: [
    { id: 1, value: 123456 },
    { id: 23, value: 50 },
  ],
};

test("every storage becomes stacks, and owned counts add them up", () => {
  const stacks = collectStacks(RESPONSES);
  const owned = ownedItemCounts(stacks);
  assert.equal(
    owned.get(19721),
    250 + 5 + 1000 + 2,
    "bank + shared + materials + pickup",
  );
  assert.equal(owned.get(24277), 3 + 7, "bank + a character's bag");
  assert.equal(owned.has(24295), false, "empty material slots aren't stacks");
  assert.deepEqual(itemLocations(stacks, 24277), [
    { storage: Storage.bag, owner: "Alt", count: 7 },
    { storage: Storage.bank, count: 3 },
  ]);
  assert.deepEqual(
    collectStacks({}),
    [],
    "a key without permissions reads nothing",
  );
});

test("crafting levels: best per discipline, and any one listed discipline will do", () => {
  const levels = bestCraftingLevels(RESPONSES.characters);
  assert.deepEqual(levels.get("Weaponsmith"), {
    rating: 500,
    character: "Main",
  });
  const recipe = (disciplines, minRating) => ({ disciplines, minRating });
  assert.equal(
    craftingRequirement(recipe(["Weaponsmith"], 500), levels).canCraft,
    true,
  );
  assert.equal(
    craftingRequirement(recipe(["Huntsman", "Jeweler"], 450), levels).canCraft,
    true,
  );
  assert.deepEqual(
    craftingRequirement(recipe(["Huntsman", "Tailor"], 400), levels),
    {
      canCraft: false,
      missing: [
        { discipline: "Huntsman", rating: 400, have: 0 },
        { discipline: "Tailor", rating: 400, have: 0 },
      ],
    },
  );
  assert.equal(
    craftingRequirement(recipe(["Mystic Forge"], 0), levels).canCraft,
    true,
    "the forge needs no character",
  );
});

/** Key store and client stand-ins. */
function setup({ permissions, failWith } = {}) {
  let saved = null;
  const keys = {
    get: () => saved,
    isRemembered: () => !!saved,
    set: (key, { remember }) => (saved = remember ? key : null),
    clear: () => (saved = null),
  };
  const calls = [];
  const reply = (name, value) => async () => {
    calls.push(name);
    if (failWith?.[name]) throw failWith[name];
    return value;
  };
  const client = {
    tokenInfo: reply("tokenInfo", {
      permissions: permissions ?? [
        "account",
        "characters",
        "inventories",
        "wallet",
        "tradingpost",
      ],
    }),
    account: reply("account", { name: "Test.1234" }),
    characters: reply("characters", RESPONSES.characters),
    bank: reply("bank", RESPONSES.bank),
    sharedInventory: reply("sharedInventory", RESPONSES.shared),
    materials: reply("materials", RESPONSES.materials),
    wallet: reply("wallet", RESPONSES.wallet),
    delivery: reply("delivery", RESPONSES.delivery),
  };
  const session = new AccountSession({ keys, createClient: () => client });
  return { session, calls, keys, remembered: () => saved };
}

test("a session loads what the key can read", async () => {
  const { session, remembered } = setup();
  const changes = [];
  session.addEventListener("change", () => changes.push(session.status));
  assert.equal(await session.connect(KEY, { remember: true }), true);
  assert.deepEqual(changes, ["connecting", "ready"]);
  assert.equal(session.accountName, "Test.1234");
  assert.equal(session.ownedItems.get(19721), 1257);
  assert.equal(session.wallet.get(23), 50);
  assert.equal(session.craftingLevels.get("Jeweler").rating, 500);
  assert.equal(remembered(), KEY);
});

test("missing permissions are skipped, not requested", async () => {
  const { session, calls } = setup({ permissions: ["account", "wallet"] });
  await session.connect(KEY);
  assert.deepEqual(calls.sort(), ["account", "tokenInfo", "wallet"]);
  assert.equal(session.isReady, true);
  assert.equal(session.characters, null);
  assert.equal(session.ownedItems.size, 0);
});

test("one failing part leaves the rest usable", async () => {
  const { session } = setup({ failWith: { bank: new Error("timeout") } });
  await session.connect(KEY);
  assert.equal(session.isReady, true);
  assert.equal(
    session.ownedItems.get(19721),
    5 + 1000 + 2,
    "everything but the bank",
  );
});

test("a saved key the API rejects is forgotten; a network error keeps it", async () => {
  const rejected = Object.assign(new Error("HTTP 401"), { status: 401 });
  const first = setup({ failWith: { tokenInfo: rejected } });
  first.keys.set(KEY, { remember: true });
  await first.session.restore();
  assert.equal(first.session.status, "error");
  assert.match(first.session.error, /rejected/);
  assert.equal(first.remembered(), null);

  const second = setup({ failWith: { tokenInfo: new Error("offline") } });
  second.keys.set(KEY, { remember: true });
  await second.session.restore();
  assert.equal(second.session.status, "error");
  assert.equal(second.remembered(), KEY, "kept for the next visit");
});

test("forget drops the account and the key", async () => {
  const { session, remembered } = setup();
  await session.connect(KEY, { remember: true });
  session.forget();
  assert.equal(session.status, "none");
  assert.equal(session.ownedItems.size, 0);
  assert.equal(remembered(), null);
});
