import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  formatCoinsText,
  formatCoinsHtml,
  formatQuantity,
} from "../public/src/utils/format.js";
import { chunkArray, runWithConcurrency } from "../public/src/utils/async.js";
import { escapeHtml } from "../public/src/utils/dom.js";
import { TreeState } from "../public/src/model/tree-state.js";
import {
  DEFAULT_SETTINGS,
  VIEW_OPTION_GROUPS,
  PRESET_KINDS,
  findMatchingPreset,
} from "../public/src/config/settings-schema.js";

// ---------------------------------------------------------------- utils

test("coin formatting", () => {
  assert.equal(formatCoinsText(1234567), "123g 45s 67c");
  assert.equal(formatCoinsText(501), "5s 1c");
  assert.equal(formatCoinsText(7), "7c");
  assert.equal(formatCoinsText(-10050), "−1g 0s 50c");
  assert.match(formatCoinsHtml(10000), /<span class="g">1g<\/span>/);
  assert.match(formatCoinsHtml(null), /—/);
  assert.equal(
    formatQuantity("currency", 1, 250),
    "2s 50c",
    "coin quantities are money",
  );
});

test("escapeHtml neutralises markup", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="a('b')">&`),
    "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
  );
  assert.equal(escapeHtml(null), "");
});

test("async helpers", async () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  let running = 0,
    peak = 0;
  const progress = [];
  await runWithConcurrency(
    Array.from({ length: 6 }, () => async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    }),
    2,
    (done, total) => progress.push(`${done}/${total}`),
  );
  assert.equal(peak, 2);
  assert.equal(progress.at(-1), "6/6");
});

// ---------------------------------------------------------------- tree state / URL

test("clearing the tree returns to no item, and Back can reopen it", () => {
  const state = new TreeState();
  state.openRoot(7, { quantity: 4 });
  state.recipeChoiceByItemId.set(9, 1);
  state.selectedNodeId = "n1";
  state.clear();
  assert.equal(state.hasRoot, false);
  assert.equal(state.rootQuantity, 1);
  assert.equal(state.recipeChoiceByItemId.size, 0);
  assert.equal(state.selectedNodeId, null);
  assert.deepEqual(state.history, [{ itemId: 7, quantity: 4 }]);
  state.openRoot(7);
  assert.equal(
    state.history.length,
    0,
    "reopening the cleared item doesn't leave it in history",
  );
  state.clear();
  state.clear();
  assert.equal(
    state.history.length,
    1,
    "clearing an empty view adds nothing to history",
  );
});

test("TreeState history, hash and recipe cycling", () => {
  const state = new TreeState();
  state.openRoot(1);
  state.rootQuantity = 3;
  state.openRoot(2);
  assert.deepEqual(state.history, [{ itemId: 1, quantity: 3 }]);
  assert.equal(state.toHash(), "#item=2&qty=3");
  assert.deepEqual(TreeState.parseHash("#item=19621&qty=2"), {
    itemId: 19621,
    quantity: 2,
  });
  assert.equal(TreeState.parseHash("#nothing"), null);

  state.cycleRecipe(
    { entityId: 5, recipeIndex: 0, alternativeRecipeCount: 3 },
    -1,
  );
  assert.equal(state.recipeChoiceByItemId.get(5), 2, "wraps around");

  const node = { collapseKey: "r/0", isCollapsed: false };
  state.toggleCollapsed(node);
  assert.ok(state.collapsedKeys.has("r/0"));
});

// ---------------------------------------------------------------- settings

function installFakeLocalStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
  return data;
}

beforeEach(() => {
  delete globalThis.localStorage;
});

test("SettingsStore migrates pre-refactor keys and drops unknown ones", async () => {
  installFakeLocalStorage({
    "gw2ct.settings": JSON.stringify({
      dir: "LR",
      mfIndicator: "badge",
      bogus: 1,
      maxDepth: 3,
    }),
  });
  const { SettingsStore } =
    await import("../public/src/core/settings-store.js");
  const store = new SettingsStore();
  assert.equal(
    store.values.direction,
    "RL",
    "old tree-growth LR = flow RL (result on the left)",
  );
  assert.equal(store.values.forgeIndicator, "badge");
  assert.equal(store.values.maxDepth, 3);
  assert.ok(!("bogus" in store.values));
});

test("layout and style presets are independent and keep what is being viewed", async () => {
  installFakeLocalStorage();
  const { SettingsStore } =
    await import("../public/src/core/settings-store.js");
  const store = new SettingsStore();
  store.set("viewMode", "merged");
  store.set("nodeShape", "hexagon");
  store.applyPreset("layout", "Radial");
  assert.equal(store.values.direction, "radial");
  assert.equal(
    store.values.nodeShape,
    "hexagon",
    "a layout preset leaves the style alone",
  );
  assert.equal(
    store.values.viewMode,
    "merged",
    "content is not part of a preset",
  );
  store.applyPreset("style", "Galaxy");
  assert.equal(store.values.nodeShape, "ellipse");
  assert.equal(
    store.values.direction,
    "radial",
    "a style preset leaves the layout alone",
  );
  assert.equal(findMatchingPreset(store.values, "layout"), "Radial");
  assert.equal(findMatchingPreset(store.values, "style"), "Galaxy");
  store.applyPreset("layout", "Standard");
  store.applyPreset("style", "Standard");
  assert.equal(findMatchingPreset(store.values, "style"), "Standard");
  store.set("edgeWidth", 5);
  assert.equal(
    findMatchingPreset(store.values, "style"),
    null,
    "any change makes it custom",
  );
  assert.equal(findMatchingPreset(store.values, "layout"), "Standard");
  store.reset(["edgeWidth"]);
  assert.equal(store.values.edgeWidth, DEFAULT_SETTINGS.edgeWidth);
});

test('saved depth "All" (99) maps to the unlimited slider step', async () => {
  installFakeLocalStorage({
    "gw2ct.settings.v2": JSON.stringify({ maxDepth: 99 }),
  });
  const { SettingsStore } =
    await import("../public/src/core/settings-store.js");
  const { UNLIMITED_DEPTH } = await import("../public/src/config/constants.js");
  assert.equal(new SettingsStore().values.maxDepth, UNLIMITED_DEPTH);
});

test("old layout engines become the two layouts: concentric → radial, force-directed → radial and floating", async () => {
  const { SettingsStore } =
    await import("../public/src/core/settings-store.js");
  installFakeLocalStorage({
    "gw2ct.settings.v2": JSON.stringify({
      layoutEngine: "concentric",
      direction: "LR",
      dagreRanker: "longest-path",
      treeAlignment: "UL",
      dragPhysics: false,
    }),
  });
  let store = new SettingsStore();
  assert.equal(store.values.direction, "radial");
  assert.equal(store.values.physicsMode, "elastic");
  for (const gone of [
    "layoutEngine",
    "dagreRanker",
    "treeAlignment",
    "dragPhysics",
  ])
    assert.ok(!(gone in store.values), `${gone} is gone`);
  installFakeLocalStorage({
    "gw2ct.settings.v2": JSON.stringify({ layoutEngine: "force" }),
  });
  store = new SettingsStore();
  assert.equal(store.values.direction, "radial");
  assert.equal(store.values.physicsMode, "floating");
  // The oldest key for the engine, from before it was called layoutEngine.
  installFakeLocalStorage({
    "gw2ct.settings.v2": JSON.stringify({ engine: "concentric" }),
  });
  store = new SettingsStore();
  assert.equal(store.values.direction, "radial");
  assert.ok(!("engine" in store.values));
});

test("saved density and spacing settings become equivalent forces", async () => {
  installFakeLocalStorage({
    "gw2ct.settings.v2": JSON.stringify({
      density: "compact",
      spacingScale: 2,
      siblingGapScale: 1,
    }),
  });
  const { SettingsStore } =
    await import("../public/src/core/settings-store.js");
  const store = new SettingsStore();
  for (const gone of [
    "density",
    "spacingScale",
    "siblingGapScale",
    "levelGapScale",
  ])
    assert.ok(!(gone in store.values), `${gone} removed`);
  assert.equal(store.values.nodeSizeScale, 0.7);
  // compact: node spacing 0.45 × 2 = 0.9 → repel 0.9 × 8; level spacing 0.55 × 2 = 1.1 → distance 1.1 × 120.
  assert.equal(store.values.repelForce, 7);
  assert.equal(store.values.linkDistance, 130);
});

test("settings schema is self-consistent", () => {
  for (const group of VIEW_OPTION_GROUPS) {
    for (const option of group.options) {
      assert.ok(option.key in DEFAULT_SETTINGS, `${option.key} has a default`);
      if (option.type === "select")
        assert.ok(
          option.choices.some(
            ([value]) => value === String(DEFAULT_SETTINGS[option.key]),
          ),
          `${option.key} default is a valid choice`,
        );
    }
  }
  for (const [kind, { presets, keys }] of Object.entries(PRESET_KINDS)) {
    for (const [name, preset] of Object.entries(presets)) {
      assert.ok(preset.description, `${kind} preset ${name} has a description`);
      for (const key of Object.keys(preset.values))
        assert.ok(
          keys.includes(key),
          `${kind} preset ${name} only sets ${kind} keys (${key})`,
        );
    }
    // Presets of a kind must differ from each other.
    const signatures = Object.values(presets).map((preset) =>
      JSON.stringify({ ...DEFAULT_SETTINGS, ...preset.values }),
    );
    assert.equal(
      new Set(signatures).size,
      signatures.length,
      `${kind} presets are distinct`,
    );
  }
});
