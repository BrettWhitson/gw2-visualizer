/**
 * Static configuration: endpoints, cache policy, colour palettes and performance limits.
 * Nothing in here depends on runtime state.
 */

// ---------------------------------------------------------------- release
/** Bump on every release: it versions the service-worker cache so users get the new build. */
export const APP_VERSION = "0.11.0";
export const REPOSITORY_URL = "https://github.com/BrettWhitson/gw2-visualizer"; // shown in About; the wiki contact

/** ArenaNet's Content Terms of Use require fan sites to be labelled unofficial, including in the browser title bar. */
export const APP_NAME = "GW2 Visualizer";
export const SITE_TITLE = `${APP_NAME} (unofficial fansite)`;
/** Required notice from ArenaNet's Content Terms of Use (https://www.arena.net/en/legal/content-terms-of-use). */
export const ARENANET_NOTICE =
  "© ArenaNet LLC. All rights reserved. NCSOFT, ArenaNet, Guild Wars, Guild Wars 2, GW2, Heart of Thorns, Path of Fire, End of Dragons, Secrets of the Obscure, Janthir Wilds, Visions of Eternity, and all associated logos, designs, and composite marks are trademarks or registered trademarks of NCSOFT Corporation. All other trademarks are the property of their respective owners.";

// ---------------------------------------------------------------- endpoints & cache
export const GW2_API_BASE_URL = "https://api.guildwars2.com/v2";
/**
 * Pinned response schema (sent as `?v=` on every request) so an API update can't silently change response shapes.
 * Bump deliberately after checking the changelog: https://api.guildwars2.com/v2.json?v=latest lists versions.
 */
export const GW2_API_SCHEMA_VERSION = "2025-08-29T01:00:00.000Z";
/** Semantic MediaWiki API, for per-item vendor/container lookups (see WikiSources). */
export const WIKI_API_URL = "https://wiki.guildwars2.com/api.php";
/** Wiki source lookups are cached this long per item. */
export const WIKI_SOURCES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const GW2_WIKI_SEARCH_URL =
  "https://wiki.guildwars2.com/wiki/Special:Search/";
export const CUSTOM_RECIPES_URL = "data/custom-recipes.json";
/** Daily snapshot of the core game data, published with the site (see tools/build-data-snapshot.mjs). */
export const SNAPSHOT_DATA_URL = "data/snapshot/game-data.json.gz";
export const SNAPSHOT_META_URL = "data/snapshot/meta.json";

/** Bump when the cached data shape changes; older caches are migrated or re-downloaded. */
export const CACHE_SCHEMA_VERSION = 2;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_DB_NAME = "gw2-crafting-tree"; // original name kept so existing users keep their cache
export const CACHE_KEYS = { coreData: "data", extraItems: "extraItems" };
/** Trading post quotes older than this are refetched the next time the tree needs them. */
export const PRICE_MAX_AGE_MS = 5 * 60 * 1000;

/** The API accepts up to 200 ids per request. */
export const API_BATCH_SIZE = 200;
export const API_CONCURRENCY = 8;
/**
 * Price batches in flight at once. Prices are small, cacheable responses; 16 roughly halved a 31-request fetch
 * (2.0–2.7 s → 0.9–1.3 s) and stays well inside the API's burst allowance of 300 requests per IP.
 */
export const PRICE_CONCURRENCY = 16;
/** Abort a single API request after this long (the retry logic then kicks in). */
export const API_REQUEST_TIMEOUT_MS = 20000;

export const COIN_CURRENCY_ID = 1;

// ---------------------------------------------------------------- entity kinds
/** Every tree node is one of these kinds. `named` = a generic wiki ingredient such as "any Charm". */
export const EntityKind = Object.freeze({
  item: "item",
  currency: "currency",
  guildUpgrade: "guild",
  named: "named",
});

/** Recipe ingredient `type` (API / wiki) → entity kind. */
export const INGREDIENT_TYPE_TO_KIND = {
  Item: EntityKind.item,
  Currency: EntityKind.currency,
  GuildUpgrade: EntityKind.guildUpgrade,
  Named: EntityKind.named,
};

/** Where a recipe came from. */
export const RecipeSource = Object.freeze({
  api: "api",
  mysticForge: "mf",
  custom: "custom",
});

// ---------------------------------------------------------------- palettes
export const RARITY_COLORS = {
  Junk: "#aaaaaa",
  Basic: "#e8e8e8",
  Fine: "#62a4da",
  Masterwork: "#1a9306",
  Rare: "#fcd00b",
  Exotic: "#ffa405",
  Ascended: "#fb3e8d",
  Legendary: "#9a5dff",
};
/** Lowest → highest. */
export const RARITY_ORDER = Object.keys(RARITY_COLORS);
export const FALLBACK_ITEM_COLOR = "#777777";
export const ENTITY_KIND_COLORS = {
  [EntityKind.currency]: "#48c7b0",
  [EntityKind.guildUpgrade]: "#b07ce0",
  [EntityKind.named]: "#8a93a6",
};

export const FORGE_COLOR = "#b46cff";
/** ✦ corner badge drawn on Mystic Forge results (SVG data URI so it also works in PNG export). */
export const FORGE_BADGE_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="27" fill="#5b21c4" stroke="#e9dcff" stroke-width="5"/>' +
      '<path d="M32 11l5.5 15.5L53 32l-15.5 5.5L32 53l-5.5-15.5L11 32l15.5-5.5z" fill="#fff"/></svg>',
  );

export const DISCIPLINE_COLORS = {
  Armorsmith: "#9aa7b8",
  Artificer: "#5ec8e5",
  Chef: "#f29d4b",
  Huntsman: "#7ac46b",
  Jeweler: "#e86bb4",
  Leatherworker: "#c98f55",
  Tailor: "#b98bf0",
  Weaponsmith: "#e25b4b",
  Scribe: "#e5c34a",
  "Mystic Forge": FORGE_COLOR,
  none: "#5b6475",
};
export const DEPTH_COLORS = [
  "#f0c46a",
  "#62a4da",
  "#7ac46b",
  "#e86bb4",
  "#5ec8e5",
  "#f29d4b",
  "#b98bf0",
  "#e25b4b",
];

/** "Craft source" categories used by colour mode and legend. */
export const SOURCE_COLORS = {
  root: "#f0c46a",
  craft: "#62a4da",
  mf: FORGE_COLOR,
  raw: "#7c8699",
  currency: "#48c7b0",
  generic: "#5b6475",
};
export const SOURCE_LABELS = {
  root: "Root",
  craft: "Crafted",
  mf: "Mystic Forge",
  raw: "Raw / bought",
  currency: "Currency",
  generic: "Generic",
};

/**
 * Edge colours for Customize → Edges → Color "Where it comes from": an edge takes the colour of where its ingredient
 * comes from (getSourceCategory). Each follows a design token in css/app.css (`--s-*`); `color` mirrors it for where
 * CSS can't reach (tests check they match).
 */
export const EDGE_SOURCE_STYLES = {
  craft: { label: "Crafted", token: "s-craft", color: "#6ea0ff" },
  mf: { label: "Mystic Forge", token: "s-forge", color: "#b28cff" },
  raw: { label: "Bought / raw", token: "s-buy", color: "#e0a05a" },
  currency: {
    label: "Currency",
    token: "s-vendor",
    color: "#5cc9a7",
    pattern: "dashed",
  },
  generic: {
    label: "Generic",
    token: "s-bound",
    color: "#6b717c",
    pattern: "dotted",
  },
};

/** Cost heatmap gradient: cheap → mid → expensive. */
export const COST_HEAT_COLORS = ["#34405a", "#ffb347", "#ff4d3d"];
export const COST_LOW_LEGEND_COLOR = "#5a6a8a";

/**
 * Shared UI colours, for where CSS can't reach (the graph canvas, PNG export). Those marked with a CSS variable mirror
 * the design tokens in css/app.css; tests/theme-tokens.test.js keeps them in step.
 */
export const UI_COLORS = {
  canvas: "#0e0f12", // --bg
  panel: "#15171b", // --panel
  line: "#2a2d34", // --line
  text: "#e6e8eb", // --text
  muted: "#8d939e", // --muted
  accent: "#e2b54f", // --brand
  accentLight: "#f0c46a", // --brand-light
  highlight: "#ffd166",
  highlightChipFill: "#3a2f12",
  nodeFill: "#1c1f24", // --raised
  labelBackdrop: "#0b0c0e",
  neutralEdge: "#3b4558",
  lineageUp: "#d6a74a",
  lineageDown: "#62a4da",
  focus: "#62a4da",
  danger: "#ef5f5f", // --down
  gold: "#e2b54f", // --gold
  silver: "#b9bec7", // --silver
  copper: "#c98244", // --copper
  owned: "#4fc1b0", // covered by the account's own items
  good: "#8fd07a",
};

// ---------------------------------------------------------------- layout & motion
export const ZOOM_LIMITS = { min: 0.005, max: 4, maxFitZoom: 1.6 };

/** The depth slider's top step means "no limit". */
export const UNLIMITED_DEPTH = 13;
export const EXPORT_MAX_SIDE_PX = 12000;
