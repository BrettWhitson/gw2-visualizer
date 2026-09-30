# Changelog

All notable changes. Versions follow `0.MINOR.PATCH` until the first stable release; bump `APP_VERSION` in
`web/src/config/constants.js` and `version` in `package.json` together (the service-worker cache is keyed on it).

## Unreleased

- **The ribbon is gone: a View popover takes its place** (the **View** button in the header, or V). It holds the
  layout and style presets, what you're viewing (tree or merged, depth, path) and the everyday layout, style and
  recipe options. **All settings** opens Customize for every other look option, and App settings covers how the app
  behaves. The graph gets the room the ribbon took.
- **Edges show where each ingredient comes from**: crafted, Mystic Forge, bought, currency or generic, each in its own
  colour, with a key in the legend (click it to highlight those ingredients). It's the new default under Customize →
  Edges → Color ("Where it comes from"); saved single-colour edges move to it once, and the other colourings are
  still there.
- **A KPI strip over the graph** for the item you're crafting: craft cost, what buying it on the Trading Post costs,
  what selling it brings after the 15% fee, and the profit or loss with its margin.
- **A minimap** in the graph's bottom-right corner (not on phones): the whole tree at a glance, with the visible area
  framed; click or drag it to move the view.
- **Fixed: on phones, the toolbar and side panel stayed collapsed on later visits.** They start collapsed on a small
  screen for that visit only, but the next change to any setting used to save that too.
- **Items as cards** (Customize → Nodes → Items as): wide cards with the item's name, quantity and where it comes from,
  its cost in coins and what you own, a rarity stripe and dots where the lines meet. Icons stay the default. Card
  links chooses dots, arrowheads or both. Drawn by Prism 0.3.0.
- The Characters page is now a Svelte app (phase 3 of the move to Svelte, first page). It looks and works as before:
  the list, each character's armory, the view choices (focus and scroll kept when they redraw) and the gear tooltips.
- The legend is the site's first Svelte component (phase 2 of the move to Svelte). It looks and works as before, and
  now follows setting changes on its own.
- Development: Svelte 5, with `svelte-check`, ESLint and Prettier covering `.svelte` files in `npm run verify`.
  Settings announce their changes (`SettingsStore.onChange`), `settings.svelte.js` mirrors them as Svelte state,
  `islands.js` mounts a component inside a page that isn't Svelte yet, and `GraphCanvas.svelte` hosts Prism for the
  pages that move over next.

## 0.11.0 — 2026-09-30

- **Fixed: costs missing on a return visit.** With prices already saved in the browser and still fresh (always the
  case with manual price updates, the default), the crafting page showed no costs until something else redrew it,
  because loading the saved prices didn't count as prices arriving. Costs now appear straight away.
- **A calmer, more neutral look**, the first step of the new design: neutral greys instead of blue-tinted ones, and
  prices set in tabular figures with small gold, silver and copper coin dots, silver and copper quieter than gold.
  The colours are design tokens in the stylesheet, and the graph takes its node and label colours from them.
- **The site is now built with Vite** (phase 1 of moving to Svelte; nothing looks or works differently). Pages load
  a handful of bundled, content-hashed files instead of about 80 separate modules: the crafting page drops from 82
  requests and 408 KB to 9 requests and 285 KB (gzip, Cytoscape and the Mystic Forge data included). Hashed files are
  cached for good, by the browser and by the service worker, whose list of files to keep offline now comes from the
  build.
- Development: `public/` is now `web/`, with the files that ship untouched in `web/static/`. `npm start` runs Vite
  with hot reload, `npm run preview` serves the built site, and `npm run dev:local` runs against the Prism and Tether
  checkouts beside the repo. Prism and Tether are pinned packages that Vite bundles, no longer copied into the repo.
- **Cytoscape is gone.** Prism draws every graph; the Classic renderer and the Customize → Canvas → Renderer option are
  removed (a saved Classic choice is simply dropped). With the Vite build, the crafting page now downloads 8 files and
  143 KB (gzip, Mystic Forge data included), down from 82 files and 408 KB in 0.10.0. Browsers without WebGL2 (hardware acceleration off, a blocklisted GPU) now see a message saying so on
  the graph pages, instead of the old renderer.
- Development: Prism and Tether are now at 0.2.0 (pinned by release tag instead of commit), with a public API: one entry point each, schemas for every option,
  theme colour and physics constant (checked, with warnings for bad values), events, plugins (node shapes, arrowheads,
  edge routings, easings, layouts and forces), and TypeScript declarations. Nothing on the site changes. The engine
  sandbox's Tuning tab now shows all 39 of Tether's constants, including the layout ones that were hardcoded before.

## 0.10.0 — 2026-09-30

- **Prism, the app's own renderer, is now the default.** It draws the crafting and What you can craft graphs on the
  GPU instead of with Cytoscape. The previous renderer stays available for now under **Customize → Canvas → Renderer →
  Classic** (or `?renderer=classic` for one visit). It stays smooth with thousands of items, and everything moves on
  springs, so a change can interrupt another without jumping: branches unfold from and fold back into their parent,
  the view glides after a flick, hover and selection ease in and out, and colours blend when they change (prices
  arriving, another colour mode). Hovered and selected lineages flow with travelling light pulses. Nodes can be
  dragged, and the rest of the graph follows. Owned items and better buys glow, collapsed items show a card stack, and
  Mystic Forge results get a ring and badge. PNG export, legend highlights, keyboard navigation, touch (tap,
  double-tap, long-press, pinch), high-density screens and every style setting work in it too.
- **Engine sandbox** (new page, linked from the home page): developer test tools for Prism and Tether on made-up
  crafting graphs of 1 to 10,000 items (crafting trees with shared materials, even trees, wide, deep or tangled).
  Tabs for the graph; the layout and physics options; **every Tether constant**, live, with copy / paste as JSON;
  every rendering option; **automated tests** (hold and drag probes that report how far items moved by how many links
  they are from the one dragged, determinism, layout timing, a render benchmark); and tools (shake, scatter, glow
  what the physics is moving, colour by links from the selection, save / load graphs, PNG export). Live numbers show
  what both engines are doing. Its options are kept apart from the crafting page's.
- **Tether, the app's own layout and physics.** Both renderers now lay graphs out with the app's own engine. The
  Merged view's layered layout replaces dagre, and Prism no longer needs Cytoscape at all (it's still loaded for
  Classic). **Two layouts**: a directional tree (up, down, left → right or right → left) and radial (the result in the
  centre). The force-directed engine, and the ranking and alignment options, are gone; saved force-directed layouts
  become radial and floating.
- **Two physics modes** (**Customize → Physics → Mode**, or the ribbon): **Elastic** (the default): the graph holds
  its layout, and the item you drag pulls the items linked to it, they pull theirs, the pull fading with every link;
  let go and it keeps the shape you pulled it into. **Floating**: the whole graph is a live simulation, like
  Obsidian's graph view: new graphs float into place, and grabbing an item makes the graph sway and settle around it.
  Either way, grabbing an item no longer sends the whole graph drifting (it used to re-run the layout, which isn't
  quite at rest, so everything moved at once). **Link force** sets how far a pull carries, **Center force** how
  firmly items hold their place. On touch screens a tap has to move 10 px before it counts as a drag.
- **Performance.** Measured in Chrome on the development machine (60 Hz display):
  - _Drawing:_ Prism holds 60 fps at 1,000, 3,000 and 10,000 items while panning and zooming, using under 1 ms of CPU
    per frame; its first frame at 10,000 items takes about 90 ms. Classic, for comparison: 0.4 s / 1 s / 8.6 s for
    the first frame, and at 10,000 items a 2.4 s stall and 84 ms frames on average.
  - _Animation:_ a frame costs what moves, not the size of the graph. Hovering, selecting or pulsing one item in a
    10,000-item graph costs about 1 ms per frame (42 ms before this was incremental); flowing lineages about 1 ms.
  - _Layout:_ the Merged view lays out 2.9× faster than with dagre, with 14% fewer edge crossings overall (five
    legendaries, six layout settings each). The physics runs 3.7× faster per step at 10,000 items (56 → 15 ms), so a
    10,000-item tree lays out in about 1.1 s.
- **Faster pages, saved data.** Account data, Trading Post prices and order books are kept in the browser, so pages
  open on what was saved instead of downloading it again: What you can craft now shows its ranked list in under a
  second on a revisit, with no API requests. **Account menu → Update account data and prices:** _When I refresh_ (the
  default: nothing is refetched until you press Refresh) or _Automatically_ (saved data shows at once and anything
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
- **Prism and Tether are their own open-source projects** ([Prism](https://github.com/BrettWhitson/prism),
  [Tether](https://github.com/BrettWhitson/tether)); the app uses pinned versions of both.
- **Fixes from a full audit before release:**
  - _Prices:_ a price or order-book request that fails (API down, rate-limited, offline) no longer marks items as
    "not tradeable" or "no buyers" and saves that; the previous price is kept, and pages say "price unavailable,
    refresh to retry". Saved prices from several tabs are merged instead of overwriting each other.
  - _What you can craft:_ Trading Post fees are worked out per item (5% + 10%, at least 1 copper each), so cheap items
    no longer show profits they can't make; a partial sale is costed for what actually sells; **Only what my
    characters can craft** now checks every step of the route, not just the last recipe; recomputing (prices
    arriving, Refresh) keeps the graph as you left it; items with no buyers no longer show "Loss 0c"; the list, tabs
    and graph work from the keyboard.
  - _Crafting:_ Background, Hover highlight, Smooth zoom, Zoom speed and the Mystic Forge indicator take effect at
    once in Prism; resetting or a preset that changes the Renderer switches it; the "Updating prices" indicator
    clears when the graph is cleared.
  - _Characters:_ the key field is emptied after connecting or forgetting; a key without the `builds` permission
    says so instead of showing a bare character; switching tabs, sets or views keeps focus and scroll; runes, sigils,
    jewels and infusions link to their crafting trees; tooltips with links can be reached from the keyboard.
  - _Account:_ a network hiccup while restoring a saved key no longer forgets it (the account menu offers Retry); a
    key you didn't ask to remember stays out of long-term storage even with several tabs open; storage-full errors no
    longer hang a page.
  - _Graphs:_ the picture comes back after the graphics driver resets; a second finger during a drag ends the drag
    cleanly; floating graphs always come to rest (within about 4 seconds) and settle the same on every machine;
    node-size changes apply at once; PNG export reports a failure instead of stalling.

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
