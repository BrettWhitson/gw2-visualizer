# Changelog

All notable changes. Versions follow `0.MINOR.PATCH` until the first stable release; bump `APP_VERSION` in
`public/src/config/constants.js` and `version` in `package.json` together (the service-worker cache is keyed on it).

## 0.6.0 — 2026-09-26

- **Settings** dialog for app behaviour (prices, recipes, interaction, animation, game data, shortcuts), separate from
  **Customize** (how the graph looks).
- Transitions run in one batched animation loop; surviving elements are reused between renders.
- Faster startup: game data sources load in parallel and a fresh cache is used immediately.
- Trading post prices refresh after 5 minutes; concurrent price requests share one fetch.
- Recent items on the start screen and in the empty search box; double-click a ribbon control to reset it.

## 0.5.0 — 2026-09-25

- Toolbar ribbon with node / level spacing sliders (replacing Compact / Cozy / Spacious), label fade by zoom, and
  Customize presets.
- Depth slider with − / +; smooth wheel and pinch zoom; animated flow stays on the selected node.
- Toggle for Mystic Forge material promotions.
- Renamed to **GW2 Visualizer**.

## 0.4.0 — 2026-09-24

- Ready for the web: installable PWA with an offline shell, Content Security Policy, pinned GW2 API schema version.
- Node-based tooling (dev server, checks, site build), ESLint, unit tests and GitHub Actions (CI, Pages deploy,
  weekly Mystic Forge data refresh).
- MIT license; ArenaNet Content Terms of Use notice and "unofficial fansite" labelling; wiki data attributed under
  GFDL 1.3 and fetched with an identifying User-Agent and `maxlag`.

## 0.3.0 — 2026-09-23

- Performance: O(n) tidy tree layout, cheaper hover and price updates.
- Fixed: the page froze on Aurene's Voice (a cycle in the merged view).
- Fixed: Fit didn't fit the whole graph.
- Code reorganised into modules and classes with descriptive names.

## 0.2.0 — 2026-09-22

- Mystic Forge recipes (from the Guild Wars 2 Wiki), with an indicator on forge-made items only.
- Clickable legend that highlights matching nodes, carried into PNG export.
- More view options, curved edges and smoother animations.

## 0.1.0 — 2026-09-21

- Search any item and explore its full crafting tree: pan, zoom, drag, hover for details, choose the direction and
  density. Recipes and items from the official GW2 API, cached in the browser.
