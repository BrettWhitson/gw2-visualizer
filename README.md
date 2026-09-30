# GW2 Visualizer

*Unofficial fansite — not affiliated with ArenaNet or NCSOFT.*

Guild Wars 2 tools that run entirely in the browser and install as a PWA:

- **Crafting:** search any item and explore its full crafting tree as an interactive graph: Mystic Forge recipes,
  trading post costs, the cheapest buy-or-craft path, where every ingredient comes from, and a shopping list.
- **Characters:** connect an API key to see each character's equipped gear, rune sets and gear-only attribute
  totals. The key never leaves the browser except to the official API.
- **Your account in the crafting explorer:** with a key connected, what you already own is used first, so costs and
  the shopping list show only what's left to buy, and missing crafting levels are flagged.

**Live: [gw2visualizer.com](https://gw2visualizer.com)** · Current version: **0.9.0** · [Changelog](CHANGELOG.md) · [Next steps](#next-steps) · [Roadmap](#roadmap) · [Considerations](#considerations)

## Quick start

Requires [Node.js](https://nodejs.org/) 22 or newer.

```bash
npm install
npm run snapshot   # optional: build the game-data snapshot locally (~25 s); without it the app uses the API directly
npm start          # http://localhost:8642
```

The app is plain ES modules, which browsers only load over http, so opening the HTML files in `public/` from disk won't work.

## Using it

| Action | Does |
|---|---|
| Drag background / scroll or pinch | Pan / zoom (smooth; speed in Settings) |
| Drag a node | Move it; its neighbours follow and the graph resettles |
| Hover | Tooltip; highlights the node's ingredients and its path to the result |
| Click | Select: Details panel (sources, prices, recipe, "used in"); its lineage stays highlighted |
| Double-click | Expand / collapse (collapsed = buy it instead of crafting; the shopping list updates) |
| Right-click (long-press on touch) | Cycle alternate recipes |
| Shift+click | Make that item the root |
| `/` `F` `R` `+` `-` `Esc` `Alt+←` `X` | Search · fit · centre on the result · zoom · clear / deselect · back · clear the graph |
| `[` `]` `T` `P` `,` `?` | Depth less / more · toggle toolbar · toggle side panel · Settings · all shortcuts |
| Tab to the graph, then arrows | ↑ product, ↓ first ingredient, ← → siblings, Enter expand / collapse, Home result |

**Toolbar (ribbon).** View (tree / merged, depth), Recipes (Path, forge promotions), Presets (a *Layout* preset and a
*Style* preset, independent of each other), Layout (flow direction, engine), Forces (repel, link distance), Style
(colour mode, edge routing) and Labels (names / quantities / cost, fade when zoomed out). Every slider has − / + for
fine steps (hold to repeat) and any row resets on double-click. The toolbar and side panel collapse from handles on
their own edges; drag the side panel's edge to resize it.

**Three layers of customization.** The ribbon holds the everyday controls. Each ribbon section's ⌄ opens a popout with
that section's full options (for example every force, or all node, edge and canvas styling), and ↺ resets the
section. The **Customize** panel has everything in one place.

**Direction** describes the crafting flow, raw materials → result: *left → right* puts the raw materials on the left
and the finished item on the right; *upward* (the default) puts the result on top; *radial* puts it in the centre
with each level on a ring around it.

**Forces** work like Obsidian's graph view, in every direction: *center* pulls everything toward the middle,
*repel* pushes nodes apart, *link strength* is how strongly links pull toward the *link distance* (the length they
settle at). Every layout runs the same simulation with one extra pull: toward each node's level (layered) or ring
(radial); *center* also sets how firmly nodes keep to it, from loose and organic (0) to crisp (1). Force-directed
has no structure at all. Nodes and labels never overlap, results are deterministic, and **dragging a node** pulls
its neighbours along and pushes others aside until the graph settles (turn off in Settings → Interaction).

**Path.** *Craft all* crafts every ingredient with its default recipe. *Cheapest* picks, for every item, the lowest
cost of buying it or crafting it with any of its recipes, all the way down, using trading post prices (ingredients
with no gold value, such as account-bound items, count as free and mark the total "partial"). *Fewest crafts* buys
everything tradeable. Bought items appear collapsed and can still be expanded; a recipe you pick by hand always wins.

**Details → Source** lists every way to get the selected item, with details on hover: crafting disciplines and
recipes, Mystic Forge and promotion recipes, trading post prices, and (from the Guild Wars 2 Wiki) the vendors that
sell it and the containers that drop it. The source this tree uses is ticked.

**Customize (side panel)** is how the graph looks: layout, nodes, labels, edges (routing, width, colour, style,
arrows, corner radius, curvature), the Mystic Forge indicator, highlight colours and flow animation, filters and the
canvas. **Settings (⚙)** is how the app behaves: price basis, recipe preferences, forge promotions, vendor lookups,
hover and selection behaviour, tooltips, zoom and animation, plus game-data info and the keyboard reference. In both,
changed options are marked and can be reset one at a time, per section or all at once. Everything persists.

Also: a clickable legend that highlights matching nodes (kept in PNG exports), label fading by zoom, recent items,
and shareable URLs (`#item=19621&qty=2`). Reduced-motion and high-contrast preferences are respected.

### Mystic Forge recipes

The official API only covers crafting-station recipes; Mystic Forge combinations (Gen 2/3 legendaries, Perfected
Envoy armour, gifts, clovers…) have never been part of it. So `public/data/mystic-forge-recipes.js` ships ~2,100 of
them, read from the [Guild Wars 2 Wiki](https://wiki.guildwars2.com/)'s query API (structured data, not HTML).

- API recipes are the default; Mystic Forge recipes show as alternates (right-click to cycle) where both exist.
- Material promotions (T5 → T6 materials, lodestones and other tradeable materials that are normally bought) count
  as raw materials unless **Promotions** is on. The ✦ indicator marks only items the tree actually forges.
- Generic wiki ingredients ("any Charm", "Exotic sword") appear as grey placeholder nodes.
- Add your own recipes to `public/data/custom-recipes.json` in `/v2/recipes` shape.

### Network use

What a visitor's browser requests, and how often:

| Request | When | Volume |
| --- | --- | --- |
| `data/snapshot/game-data.json.gz` (this site) | First visit, cache older than 7 days, or Settings → Reload game data | 1 file, ~0.7 MB |
| `data/snapshot/meta.json` (this site) | Each visit, to see whether newer data was published | 1 tiny file |
| GW2 API `/v2/commerce/prices` | Items in the current tree; refreshed after 5 minutes | 1–30 requests per tree |
| GW2 Wiki `api.php?action=ask` | Only when an item's details are opened; cached a week per item | 2 small queries |
| `render.guildwars2.com` icons | As nodes appear; cached by the browser and service worker | ArenaNet's CDN |

The snapshot is rebuilt daily by the deploy workflow, the only client that downloads all recipes and items from the
GW2 API. Without a published snapshot (e.g. local development before `npm run snapshot`) the app downloads from the
API itself. Mystic Forge recipes are bundled with the site (weekly `refresh-forge-data` workflow).

## Next steps

Near-term polish on what's already here.

**Graph engine improvements and tweaking**
- Tune the force defaults per layout and view (tree vs merged, small vs 1,000+ node trees) so each looks good
  without adjustment.
- Keep dragged nodes where they're dropped (pin on drop, double-click or a button to release) and remember manual
  positions across re-renders of the same tree.
- Run large simulations off the main thread (Web Worker) and warm-start re-layouts from the current positions so
  small setting changes don't reshuffle the whole graph.
- Better edge routing in layered layouts: fewer crossings, and bundling for items used many times in merged view.

**Control ribbon tweaks**
- Let users choose which controls appear in each ribbon section, and save custom Layout / Style presets.
- A compact single-row ribbon mode, and better overflow on narrow screens than horizontal scrolling.
- Show a changed-from-default marker on ribbon sections, matching the Customize panel.

**UI/UX improvements**
- A first-visit tour of the ribbon layers, keyboard navigation and the Path modes.
- Screen-reader pass on the popouts and details panel; check colour contrast of every node palette.
- Clearer loading and error states for the snapshot, prices and wiki lookups, with retry where it's safe.
- Touch: larger drag targets on phones and a long-press menu in place of right-click cycling.

## Roadmap

Ideas, roughly in order; none of this is promised.

- **Image export with preview:** choose what's included (legend, title, notice), background, scale and crop, and see
  the result before saving; SVG export.
- **GW2 account (API key), next:** "expected stock" (items you'll have soon, such as Wizard's Vault picks) counted
  as owned; let owned intermediates steer the Cheapest path; wallet currencies against currency ingredients.
- **More visualizers** built on the same graph and data layer:
  - characters: equipment, builds and crafting disciplines;
  - achievements and collections: progress trees, what's left and what it costs;
  - account progression: legendary armoury, masteries, unlocks;
  - account value: total value of items, materials and currencies, and how it changes over time.
- Shopping list export (CSV / clipboard) and a trading post watchlist.

## Considerations

Larger architectural changes that have been weighed but not made. Each is worth revisiting when the trigger in
*When* applies.

**Moving to a web framework** (Svelte, Preact, Lit or similar, with Vite)
- *For:* the panels, ribbon, popouts and options are hand-wired DOM that the app keeps in sync with settings
  (`render` / `syncValues` / `refreshStatus`); a component model with reactive state would remove that plumbing and
  make new UI cheaper. It would also bring TypeScript, hot reload and bundling almost for free.
- *Against:* a build step and toolchain to maintain, a larger download, and a rewrite of the UI layer for no
  visible change. The data, model and graph layers would carry over unchanged either way.
- *Middle ground:* Lit web components, or TypeScript checking of the existing JSDoc (`jsconfig.json` is already
  there), both without a bundler.
- *When:* the Roadmap's extra visualizers (characters, achievements, account) start; several views sharing
  components is where a framework pays for itself.

**Our own graph engines: Prism and Tether** (replacing Cytoscape)
- **Prism** (`src/render/`) draws, animates and handles input: WebGL2 instanced drawing of nodes, edges and
  arrowheads, a label layer, springs for every motion, partial GPU uploads (a frame costs what moves), hit-testing,
  pan / zoom / pinch, tiled PNG export. Prism is the default; Classic (Cytoscape) stays selectable under
  Customize → Canvas → Renderer for now, and goes, with Cytoscape, once nobody needs it.
- **Tether** (`src/layout/`) decides where things go: tidy and radial tree seeds, a layered layout for the merged
  view (ranks, crossing minimisation by barycentre sweeps and transposition, exact per-rank placement; it replaced
  dagre), the physics (a deterministic force simulation with a Barnes-Hut quadtree and a hashed collision grid,
  allocation-free per tick), and an elastic net for dragging (`elastic.js`: a pull fades hop by hop and only
  disturbed nodes are simulated). Both renderers use it. d3-force would bring a well-tested core but still need the
  structure and collision forces; ELK's layered algorithm is the heavyweight alternative if crossings need to go
  lower.
- Moving the physics to a Web Worker (or WebAssembly) keeps the page responsive on very large trees; see Next steps.

**A small backend**
- The site is fully static: the daily snapshot covers recipes and items, and visitors fetch prices directly from
  the GW2 API. A serverless function or edge cache in front of `/v2/commerce/prices` would cut those per-visitor
  requests further and allow price history.
- API-key features should stay in the browser so the site never holds anyone's key; that argues for keeping the
  backend limited to shared, public data.

**Data snapshot growth**
- The snapshot is one ~0.7 MB gzip file. If more data is added (for achievements, skins, currencies), split it by
  kind and load parts on demand, or publish daily deltas instead of a full file.

## Development

The app has no runtime dependencies and no build step: everything the browser loads lives in `public/` (ES modules in
`public/src/`, vendored libraries in `public/lib/`). All tooling is Node.

```bash
npm install            # dev tooling: ESLint, Prettier, and the pinned Cytoscape builds for vendoring and tests
npm start              # dev server on :8642 + open browser   (npm run serve: without opening)
npm run verify         # syntax/import + vendored-version check, ESLint, Prettier check, unit tests
npm run format         # format JS and CSS with Prettier (default options)
npm run build          # assemble the deployable site into _site/
npm run snapshot       # build public/data/snapshot/ (what visitors download; ~150 API requests)
npm run vendor         # copy the pinned Cytoscape build into public/lib/
npm run update-forge   # re-read Mystic Forge recipes from the wiki (needs WIKI_CONTACT or REPOSITORY_URL)
npm run icons          # regenerate public/icons/ from tools/generate-icons.mjs
```

- Tests (`tests/`, Node's built-in `node:test`) cover tree building and cost roll-up, the Path planner, graph
  projection, search, data loading, caching and the snapshot path, price and wiki lookups, settings migrations, and
  layout behaviour (flow direction, radial rings, forces, drag physics) against real headless Cytoscape.
- The service worker is skipped on localhost so you always run fresh code; add `?sw=1` to test offline and install
  behaviour locally.

### Project layout

```
README.md, CHANGELOG.md, LICENSE, THIRD_PARTY_NOTICES.md
package.json               npm scripts; dev dependencies only (nothing ships from node_modules)
eslint.config.js, .prettierrc.json, .prettierignore, jsconfig.json, .editorconfig, .gitattributes, .gitignore
.github/workflows/
  ci.yml                   verify + build on every push / pull request
  deploy-pages.yml         GitHub Pages: on push to main and daily, with a fresh data snapshot
  refresh-forge-data.yml   weekly wiki re-read → pull request
tools/
  dev-server.mjs           local server for public/ (correct MIME types, no caching)
  build-site.mjs           public/ + LICENSE + notices → _site/
  check.mjs                syntax + import check; generated data must stay unformatted
  build-data-snapshot.mjs  GW2 API → public/data/snapshot/ (gzip + meta)
  vendor-libs.mjs          node_modules → public/lib/ (+ VERSIONS.json)
  update-mystic-forge.mjs  wiki → public/data/mystic-forge-recipes.js
  generate-icons.mjs       public/icons/ (SVG + PNGs, no dependencies)
tests/                     node:test suites + helpers/fixtures.js
public/                    the web app, served as-is
  index.html               home page
  sandbox.html             engine sandbox: Prism and Tether on generated graphs (src/sandbox/, src/sandbox-main.js)
  crafting.html            crafting explorer markup (+ inline SVG icon sprite); controls declare data-setting /
                           data-command. Old /#item= links on the home page redirect here.
  characters.html          Characters page (API key, character list, armory)
  manifest.webmanifest, sw.js, _headers, robots.txt
  css/app.css              base + crafting styles (CSS variables mirror UI_COLORS in constants.js)
  css/pages.css, characters.css  the scrolling pages (home, characters)
  icons/                   app icons (generated)
  lib/                     vendored Cytoscape.js (UMD global; the classic renderer)
  data/
    mystic-forge-recipes.js  generated by `npm run update-forge`; don't edit (GFDL 1.3, not MIT)
    LICENSE-GFDL-1.3.txt     licence text for the wiki-derived data
    custom-recipes.json      your own recipes
    snapshot/                generated by `npm run snapshot` (git-ignored)
  src/
    main.js, pwa.js        crafting entry point; service worker registration
    home-main.js, characters-main.js  the other pages' entry points
    app.js                 CraftingTreeApp: wires services and components, owns user actions
    types.js               JSDoc typedefs
    config/                constants.js (version, endpoints, palettes, limits, legal notice);
                           settings-schema.js (defaults, Customize / Settings options, presets, migrations)
    core/                  SettingsStore, RecentItems, ApiKeyStore
    data/                  Gw2ApiClient, IndexedDbStore, GameData (+ core-data-sources: snapshot / API),
                           PriceBook, WikiSources, ItemSearchIndex, AccountClient + CharacterCatalogs
    model/                 TreeState, CraftTreeBuilder, PathPlanner, buildGraphModel, character armory
    graph/                 the classic (Cytoscape) renderer: GraphView, GraphTransition, SmoothWheelZoom, stylesheet,
                           layouts (adapter onto layout/); NodeAppearance, PNG export (shared)
    render/                Prism, our renderer: WebGLGraph (the engine), WebGLGraphView (the pages' interface),
                           shaders, springs, instance data, labels, edge geometry, style resolver
    layout/                Tether, layout and physics: LayoutGraph, tree and layered seeds, the force simulation
    ui/                    site chrome (shared header, footer, About), character view, Toolbar (+ ribbon-sections, RibbonPopout), OptionsPanel (Customize, Settings,
                           popouts), range steppers, Legend, SearchBox,
                           Tooltip, DetailsPanel, ShoppingListPanel, toasts, status bar / overlay / side panel
    utils/                 dom, async, format helpers
```

### How a render works

```
TreeState + GameData + PriceBook
   → CraftTreeBuilder.build()        TreeNode tree (one node per ingredient occurrence; PathPlanner decides
                                     buy vs craft and which recipe; costs rolled up)
   → buildGraphModel()               GraphModel (tree or merged view, filters, ordering)
   → NodeAppearance                  element data (colour, label, classes)
   → graph view .render()            Tether lays it out; Prism (or Classic) morphs from the previous graph
   → Legend / DetailsPanel / ShoppingListPanel refresh
```

Components never call each other; they get the services they read (`gameData`, `priceBook`, `settings`) and call
back into `CraftingTreeApp` for actions. Settings changes carry a `Redraw` level (`fit` / `relayout` / `restyle` /
`none`) so only the necessary work happens.

### Conventions

- ES modules formatted by Prettier (default options), LF line endings; classes for stateful components, plain
  functions for pure transforms; private members use `#`.
- Descriptive names over abbreviations (`quantity`, `craftCount`, `isCollapsed`).
- New settings: a default in `DEFAULT_SETTINGS` and an entry in `CUSTOMIZE_GROUPS` (looks) or `SETTINGS_GROUPS`
  (behaviour) with its `redraw` level; the panels pick it up automatically. If a preset should cover it, it must be
  in the preset's section.
- Saved settings and cached data from older versions are migrated (`migrateLegacySettings`, `migrateLegacyCache`).
- Release: update `CHANGELOG.md`, bump `APP_VERSION` (constants.js) and `version` (package.json) together, then
  `npm run verify`. The service-worker cache is keyed on the version, so returning users get a reload prompt.

## Publishing

The site is static; `npm run build` writes the deployable files to `_site/`.

| Host | How |
|---|---|
| **GitHub Pages** | Settings → Pages → Source: *GitHub Actions*. `deploy-pages.yml` verifies, builds a fresh data snapshot and deploys on every push to `main` and once a day. Paths are relative, so `https://<user>.github.io/<repo>/` works. |
| **Netlify / Cloudflare Pages** | Build command `npm ci && npm run snapshot && npm run build`, publish directory `_site`. `_headers` supplies security and caching headers. |
| **Anything else** | Run the same commands and upload `_site/`; serve over HTTPS with gzip / brotli. |

For the weekly Mystic Forge refresh on GitHub, allow Actions to create pull requests (Settings → Actions → General →
Workflow permissions). Before going public, set `REPOSITORY_URL` in `constants.js`: it's linked from About and is
the contact the wiki updater identifies itself with.

**In place:** a strict Content-Security-Policy (no inline scripts; only `api.guildwars2.com`, `render.guildwars2.com`
and `wiki.guildwars2.com` as third parties; keep the `<meta>` in every page and `_headers` in sync), HTML-escaped
API and wiki text, an installable PWA with an offline shell, request timeouts with retry and back-off, graceful
fallbacks when storage, the snapshot or the wiki is unavailable, and a pinned GW2 API schema version.

### Staying within the rules

- **ArenaNet's [Content Terms of Use](https://www.arena.net/en/legal/content-terms-of-use)** cover fan projects
  that use game content and the API. This app is run by an individual, free and non-commercial, labelled as an
  **unofficial fansite** (header, footer, About, exported PNGs and the browser title bar, which the terms require),
  uses no ArenaNet logos, loads item icons from ArenaNet's render service, and shows the required notice. The deployed
  site serves a snapshot of API data so visitors don't each re-download it. It has no ads, donation links or paid
  features; the terms (section II.3) allow only limited, non-intrusive advertising without a written agreement with
  ArenaNet.
- **Guild Wars 2 Wiki:** only the official query API is used, never HTML pages, following
  [MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette). The weekly recipe updater sends an
  identifying User-Agent with contact details (it refuses to run without one), makes sequential requests with pauses,
  uses `maxlag` and honours `Retry-After`. In the app, vendor and container lookups happen only when someone opens an
  item's details: two small queries, one at a time, with `maxlag`, cached for a week, never retried after a failure,
  and switchable off in Settings. Browsers can't set a User-Agent, and the wiki's CORS rules reject the
  `Api-User-Agent` header, so those requests are anonymous. Everything is read-only.
- **Licensing:** wiki contributor content is under the GNU FDL 1.3, so the derived data file carries that notice and
  the full licence text ships with it (`public/data/LICENSE-GFDL-1.3.txt`); it is excluded from the MIT license.

## License

The source code is released under the [MIT License](LICENSE).

Not covered by that license:
- **Guild Wars 2 content.** © ArenaNet LLC. All rights reserved. NCSOFT, ArenaNet, Guild Wars, Guild Wars 2, GW2,
  Heart of Thorns, Path of Fire, End of Dragons, Secrets of the Obscure, Janthir Wilds, Visions of Eternity, and all
  associated logos, designs, and composite marks are trademarks or registered trademarks of NCSOFT Corporation. All
  other trademarks are the property of their respective owners. This is an unofficial fansite, not affiliated with,
  endorsed, sponsored or approved by ArenaNet or NCSOFT.
- **`public/data/mystic-forge-recipes.js`**, derived from the [Guild Wars 2 Wiki](https://wiki.guildwars2.com/):
  contributor content under the [GNU FDL 1.3](public/data/LICENSE-GFDL-1.3.txt).
- **Bundled libraries** in `public/lib/` keep their own (MIT) licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
