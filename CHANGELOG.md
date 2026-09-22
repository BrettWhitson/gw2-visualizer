# Changelog

All notable changes. Versions follow `0.MINOR.PATCH` until the first stable release; bump `APP_VERSION` in
`public/src/config/constants.js` and `version` in `package.json` together (the service-worker cache is keyed on it).

## 0.2.0 — 2026-09-22

- Mystic Forge recipes (from the Guild Wars 2 Wiki), with an indicator on forge-made items only.
- Clickable legend that highlights matching nodes, carried into PNG export.
- More view options, curved edges and smoother animations.

## 0.1.0 — 2026-09-21

- Search any item and explore its full crafting tree: pan, zoom, drag, hover for details, choose the direction and
  density. Recipes and items from the official GW2 API, cached in the browser.
