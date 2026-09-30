# Changelog

All notable changes. Versions follow `0.MINOR.PATCH` until the first stable release; bump `APP_VERSION` in
`public/src/config/constants.js` and `version` in `package.json` together (the service-worker cache is keyed on it).

## Unreleased

- **Faster pages, saved data.** Account data, Trading Post prices and order books are kept in the browser, so pages
  open on what was saved instead of downloading it again: What you can craft now shows its ranked list in under a
  second on a revisit, with no API requests. **Account menu → Update account data and prices:** *When I refresh* (the
  default: nothing is refetched until you press Refresh) or *Automatically* (saved data shows at once and anything
  older than five minutes refreshes in the background). Account data is saved only where the key is (in the browser if
  remembered, otherwise for the tab) and is deleted when you forget the key; the key itself is never saved with it.
- What you can craft shows its ranking as soon as profits are known and refines it with order-book depth afterwards,
  and says how old its data is, with a Refresh button.
- **What you can craft** (new page, linked from the header): with an account connected (`inventories` permission), a
  ranked list of everything you can craft right now from what you own, counting intermediate crafts and currencies
  from your wallet, filterable by name and discipline and sortable by **most profitable**, highest price, how many you
  can make, rarity or name. Profit is what the crafted items sell for into buy orders minus what the materials they use
  up would, both after the Trading Post's 15%; the top results are priced against the real order book, so a lone high
  buy order can't inflate a big stack. Each result shows its **route** ("Mithril Ore → Mithril Ingot → … → Catapult"),
  each material its best use, and an item's details its profit, the crafts on the way and the best routes onward; recipes no character has the level for are left out unless you ask. Pick an item, or one of your
  materials, to see a graph of what it can become: the three most profitable routes open and are highlighted in gold,
  branches leading to the best profit come first, double-click to go further, big fan-outs fold into "+N more", and the layout switches to rings when a step gets crowded (or pick Columns / Radial).
- Fixed: in left-right layouts, wide labels made neighbouring levels collide, so big trees stacked into a tall
  column with overlapping nodes. Levels now make room for their labels, and nodes on a level never overlap.
- About and a new header button link to the source code on GitHub.
- **Clear graph** (✕ in the header, or `X`) returns to the start screen; Back reopens the cleared item.
- Live at [gw2visualizer.com](https://gw2visualizer.com).
- Tests run on Node 22 (the minimum is now Node 22).
- **Home page:** the site opens on a home page linking to each tool; the crafting explorer moved to
  `crafting.html` (old `/#item=…` links still open it). Every page shares one header (links between the tools)
  and one footer with About and the version.
- **Characters** (new page, linked from the header): connect a GW2 API key (`characters` and `builds` permissions)
  to see each character's equipped gear laid out like the in-game hero panel: game-style tooltips with upgrades,
  rune tiers lit by how many pieces you wear, infusions, dyes and skins; gear-only attribute totals with a
  per-source breakdown, critical chance, critical damage, health and armor; switch equipment templates and weapon
  sets. The key stays in your browser (remembered only if you choose) and is sent only to the official API.
- **Connect your account on any page** (top right). The crafting explorer then uses what you own first: ingredients
  in your bank, material storage, shared slots, bags and Trading Post pickup are taken before anything is bought or
  crafted, items you hold enough of are marked ✓ and not expanded, and costs and the shopping list cover only the
  rest (with how much you already have). Crafted steps no character has the level for are flagged, and the shopping
  list sums up the crafting levels you lack. Toggle it with **Use what I own** in the ribbon's Recipes section.
- Characters: a **Full** gear view shows every slot's details in place (stats on one line, rune tiers in a grid),
  remembered in this browser; the character's **bags** appear below the gear (with the `inventories` permission);
  every gear piece and bag item links to its crafting tree.
- Characters: **Share image** exports the current template's gear as a PNG to download or copy, as Compact rows or
  Full detail cards. It shows gear only: no attribute totals, account name or wallet.
- A key that isn't remembered is now kept for the browser tab, so it carries across pages until the tab closes.

## 0.9.0 — 2026-09-29

- **Forces** replace the node / level spacing sliders, like Obsidian's graph view: center, repel, link strength
  and link distance, acting in every direction in every layout. Layered layouts pull nodes toward their level and
  radial layouts toward evenly spaced rings instead of pinning them; Force-directed has no structure. A collision
  force keeps nodes and labels from overlapping, and center also sets how firmly nodes keep to their level or ring
  (0 = loose and organic, 1 = crisp). Saved spacing settings are converted.
- Fixed: in radial layouts the first rings bunched up in the middle while the outer rings were pushed far out.
- **Layered customization:** each ribbon section has ↺ (reset that section) and ⌄ (a popout with the section's
  full options: every force, all node / edge / canvas styling, labels and highlight, layout, filters, recipe
  settings), with a link to the same place in the Customize panel, which still has everything.
- Fixed: option sliders in the side panel pushed their value readouts and reset buttons out of view.
- **Physics on drag:** dragging a node pulls its neighbours along and pushes others aside; the graph settles when
  you let go (Settings → Interaction).
- Removed the Breadth-first engine (it duplicated Layered); saved settings switch to Layered.
- The app icon appears in the page header.

## 0.8.0 — 2026-09-28

- **Data snapshot:** the deploy workflow publishes a daily, gzipped snapshot of every recipe and item (~0.7 MB).
  Visitors download that one file instead of each making ~150 GW2 API requests; returning visitors make no API calls
  on startup. The API is only used directly when no snapshot is published.
- **Direction now names the crafting flow** (raw materials → result): "left to right" puts the result on the right.
  Saved settings are converted so existing layouts don't change.
- Separate **Layout** and **Style** presets in the ribbon.
- Collapse handles on the toolbar and side panel edges; the side panel is resizable (drag or arrow keys).
- − / + fine-tuning on every slider, in the ribbon and in Customize (hold to repeat).
- Keyboard navigation of the graph with screen-reader announcements; reduced-motion and high-contrast support.
- New app icon and an SVG icon set for the interface.
- Updated Cytoscape.js 3.34.3 and cytoscape-dagre 4.0.1 (bundles the maintained `@dagrejs/dagre`); both are now pinned
  dev dependencies copied into `public/lib/` by `npm run vendor`.
- Fixed: node spacing jumped at 0.75× in merged view; spacing is now linear across the slider.
- Fixed: the edge curvature slider didn't appear when routing was changed from the ribbon.
- Layout regression tests run the real layout code against headless Cytoscape.

## 0.7.0 — 2026-09-27

- **Path** modes: Craft all, Cheapest (buy or craft, whichever costs less, recursively) and Fewest crafts.
- Details → **Source** chips with hover cards: crafting disciplines and recipes, Mystic Forge, trading post prices,
  and vendors and containers looked up on the Guild Wars 2 Wiki on demand (cached a week).
- Edge customization: line style, arrow shape / end / size, corner radius, curvature, lineage colours, flow speed.
- Spacing-aware radial tree layout; spacing sliders range from 0 to 6×.
- Prettier formatting for all JavaScript and CSS.
- Fixed: repeated "invalid endpoints" warnings during merged-view transitions.

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
