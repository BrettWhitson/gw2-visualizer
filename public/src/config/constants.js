/**
 * Static configuration: endpoints, cache policy, colour palettes and performance limits.
 * Nothing in here depends on runtime state.
 */

// ---------------------------------------------------------------- release
/** Bump on every release: it versions the service-worker cache so users get the new build. */
export const APP_VERSION = "0.9.0";
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

/** Cost heatmap gradient: cheap → mid → expensive. */
export const COST_HEAT_COLORS = ["#34405a", "#ffb347", "#ff4d3d"];
export const COST_LOW_LEGEND_COLOR = "#5a6a8a";

/** Shared UI colours (mirrors the CSS variables; needed where CSS can't reach: canvas + Cytoscape). */
export const UI_COLORS = {
  canvas: "#0d1017",
  panel: "#151a24",
  line: "#2a3242",
  text: "#e3e6ec",
  muted: "#8a93a6",
  accent: "#d6a74a",
  accentLight: "#f0c46a",
  highlight: "#ffd166",
  highlightChipFill: "#3a2f12",
  nodeFill: "#1a2030",
  labelBackdrop: "#0b0e14",
  neutralEdge: "#3b4558",
  lineageUp: "#d6a74a",
  lineageDown: "#62a4da",
  focus: "#62a4da",
  danger: "#e0645c",
  good: "#8fd07a",
};

// ---------------------------------------------------------------- layout & motion
/** Base sizes in graph units; the node size, spacing and font sliders scale these. */
export const LAYOUT_BASE = {
  nodeSize: 48,
  siblingGap: 22,
  levelGap: 70,
  fontSize: 11,
  labelWidth: 120,
};

/** Labels go from invisible (at the fade zoom) to fully visible over this zoom ratio. */
export const LABEL_FADE_RANGE = 1.6;
/** Label opacity is quantised to this many steps so zooming only restyles when a step is crossed. */
export const LABEL_FADE_STEPS = 5;

/** Cytoscape easing names for each user-facing easing option. */
export const EASING_FUNCTIONS = {
  smooth: "ease-in-out-cubic",
  snappy: "ease-out-quint",
  bouncy: "spring(380, 22)",
  linear: "linear",
};

/** Thresholds that trade polish for speed on big graphs. */
export const PERFORMANCE_LIMITS = {
  maxAnimatedNodes: 1500, // transitions run in one batched loop (graph-transition.js), so this can be generous
  maxStaggeredNodes: 800,
  textureOnViewportAboveElements: 500,
  hideEdgesOnViewportAboveElements: 2500,
  dimOnHoverBelowElements: 2500,
  maxFlowAnimatedEdges: 1500,
  fullRateFlowEdges: 300, // above this, the flow animation drops to ~20 fps
  hoverDelayMs: 35,
};

export const ZOOM_LIMITS = { min: 0.005, max: 4, maxFitZoom: 1.6 };

/**
 * Smooth wheel zoom: each wheel pixel scales the zoom target by exp(-pixels × perPixel × zoomSpeed); the view then
 * eases toward the target with this time constant. Pinch gestures (ctrl+wheel) send tiny deltas, so they're boosted.
 */
export const SMOOTH_ZOOM = {
  perPixel: 0.0018,
  pinchBoost: 5,
  maxStepPixels: 240,
  easeTimeMs: 90,
  lineHeightPx: 16,
  pageHeightPx: 400,
};

/** The depth slider's top step means "no limit". */
export const UNLIMITED_DEPTH = 13;
export const EXPORT_MAX_SIDE_PX = 12000;
