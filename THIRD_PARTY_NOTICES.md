# Third-party notices

GW2 Visualizer's own source code is MIT licensed (see `LICENSE`). The components below keep their own terms.

## Bundled libraries (`public/lib/`)

| Library | Version | License | Copyright |
|---|---|---|---|
| [Cytoscape.js](https://js.cytoscape.org/) | 3.34.3 | MIT | © 2016–2026 The Cytoscape Consortium |

Versions are pinned in `package.json` and copied into `public/lib/` by `npm run vendor` (recorded in
`public/lib/VERSIONS.json`). Development-only tools (ESLint, Prettier, globals) are not shipped.

### MIT License

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
> Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
> WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Game content and data

- **Guild Wars 2 API.** Item, recipe, currency and price data and item icons come from the official
  [Guild Wars 2 API](https://wiki.guildwars2.com/wiki/API:Main). Nothing from it is stored in this repository; the
  deployed site serves a daily snapshot of the recipe and item data (built by `npm run snapshot` at deploy time) so
  visitors don't each re-download it from the API, and prices and icons are requested live.
  Use is subject to ArenaNet's [Content Terms of Use](https://www.arena.net/en/legal/content-terms-of-use): this is an
  unofficial, non-commercial fansite made by an individual, labelled as such (including in the browser title), and it
  carries the required notice below.
- **Guild Wars 2 Wiki.** Mystic Forge recipes in `public/data/mystic-forge-recipes.js` are derived from the
  [Guild Wars 2 Wiki](https://wiki.guildwars2.com/) through its public query API (`api.php?action=ask`), with an
  identifying User-Agent, `maxlag` and rate limiting, at most weekly. When a visitor opens an item's details, the app
  also asks the wiki's query API which vendors sell it and which containers drop it (two small queries, cached for a
  week per browser, can be turned off in Settings); those results are shown with a link back to the wiki. Per the wiki's
  [copyrights page](https://wiki.guildwars2.com/wiki/Guild_Wars_2_Wiki:Copyrights), contributor content is available
  under the **GNU Free Documentation License 1.3** — a copy is included at `public/data/LICENSE-GFDL-1.3.txt` — and content
  obtained from the game remains © ArenaNet LLC. This data file is not covered by the project's MIT license.

© ArenaNet LLC. All rights reserved. NCSOFT, ArenaNet, Guild Wars, Guild Wars 2, GW2, Heart of Thorns, Path of Fire, End of Dragons, Secrets of the Obscure, Janthir Wilds, Visions of Eternity, and all associated logos, designs, and composite marks are trademarks or registered trademarks of NCSOFT Corporation. All other trademarks are the property of their respective owners.

This project is a fan-made tool and is not affiliated with, endorsed, sponsored or approved by ArenaNet or NCSOFT.
