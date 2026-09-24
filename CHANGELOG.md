# Changelog

All notable changes. Versions follow `0.MINOR.PATCH` until the first stable release; bump `APP_VERSION` in
`public/src/config/constants.js` and `version` in `package.json` together (the service-worker cache is keyed on it).

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
