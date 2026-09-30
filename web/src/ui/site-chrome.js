import {
  APP_NAME,
  APP_VERSION,
  ARENANET_NOTICE,
  REPOSITORY_URL,
} from "../config/constants.js";
import { AccountMenu } from "./account-menu.js";

/**
 * The header and footer every page shares: brand, links between the visualizers, source link, and a footer with
 * the fan-site notice, About and the version. Each page's own markup keeps only its page-specific parts:
 *
 *   <header id="topbar">…page tools…</header>        → brand + nav go in front, the source link at the end
 *   <footer id="status">…page status…</footer>       → notice, About and version are added after it
 */

export const PAGES = [
  { id: "home", href: "./", label: "Home" },
  { id: "crafting", href: "crafting.html", label: "Crafting" },
  { id: "craftable", href: "craftable.html", label: "Craftable" },
  { id: "characters", href: "characters.html", label: "Characters" },
];

const GITHUB_ICON =
  '<svg class="ico filled" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

/** Links to other sites: new tab, no referrer. */
const external = (href, text) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

function brandHtml() {
  return `<h1 class="brand"><a class="brand-link" href="./" title="${APP_NAME} home">
      <img class="brand-icon" src="icons/icon.svg" alt="" width="26" height="26">
      GW2 <span>Visualizer</span>
      <small class="fansite-tag" title="Unofficial fansite, not affiliated with ArenaNet or NCSOFT">unofficial fansite</small>
    </a></h1>`;
}

function navHtml(currentPage) {
  const links = PAGES.filter((page) => page.id !== "home")
    .map(
      (page) =>
        `<a href="${page.href}"${page.id === currentPage ? ' aria-current="page"' : ""}>${page.label}</a>`,
    )
    .join("");
  return `<nav class="page-nav" aria-label="Visualizers">${links}</nav>`;
}

function aboutHtml() {
  return `<dialog id="aboutDialog" aria-labelledby="aboutTitle">
    <h2 id="aboutTitle">About ${APP_NAME}</h2>
    <p>An <strong>unofficial fansite</strong>: free, non-commercial fan-made tools for exploring Guild Wars 2 crafting
      trees and your characters. Not affiliated with, endorsed, sponsored or approved by ArenaNet or NCSOFT. Game
      content is used under ArenaNet's ${external("https://www.arena.net/en/legal/content-terms-of-use", "Content Terms of Use")}.</p>
    <h3>Data</h3>
    <ul>
      <li>Items, recipes, currencies, prices, characters and icons: the official
        ${external("https://wiki.guildwars2.com/wiki/API:Main", "Guild Wars 2 API")}.</li>
      <li>Mystic Forge recipes: derived from the ${external("https://wiki.guildwars2.com/", "Guild Wars 2 Wiki")} via its
        public query API. Wiki contributor content is available under the
        <a href="data/LICENSE-GFDL-1.3.txt" target="_blank" rel="noopener">GNU Free Documentation License 1.3</a>
        (${external("https://wiki.guildwars2.com/wiki/Guild_Wars_2_Wiki:Copyrights", "wiki copyrights")}); game content
        remains © ArenaNet LLC.</li>
    </ul>
    <h3>Privacy</h3>
    <p>No accounts, cookies, analytics or tracking, and no server of ours that sees your data. View settings are kept
      in this browser's local storage and game data is cached in IndexedDB. The site only talks to
      <code>api.guildwars2.com</code>, <code>render.guildwars2.com</code> and, when you open an item's details,
      <code>wiki.guildwars2.com</code> (to list vendors and containers; turn this off in the crafting Settings).</p>
    <p>If you connect an API key, it stays in this browser (saved only if you ask) and is sent only to
      <code>api.guildwars2.com</code>. Keys are read-only; revoke one at any time at
      ${external("https://account.arena.net/applications", "account.arena.net/applications")}.</p>
    <h3>Open source</h3>
    <ul>
      <li>Graphs are drawn by ${external("https://github.com/BrettWhitson/prism", "Prism")} and laid out by
        ${external("https://github.com/BrettWhitson/tether", "Tether")}, our own open-source engines (MIT).</li>
      <li>The classic renderer is built with ${external("https://js.cytoscape.org/", "Cytoscape.js")} (MIT).</li>
      <li>${APP_NAME} itself is open source under the <a href="LICENSE" target="_blank" rel="noopener">MIT License</a>
        (<a href="THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">third-party notices</a>).</li>
      ${REPOSITORY_URL ? `<li>${external(REPOSITORY_URL, "Source code")}</li>` : ""}
    </ul>
    <p class="legal">${ARENANET_NOTICE}</p>
    <div class="btnrow"><button type="button" data-chrome="close-about" autofocus>Close</button></div>
  </dialog>`;
}

/**
 * Fill in the shared header and footer, and add the About dialog and the account control.
 * @param {{ page: "home" | "crafting" | "craftable" | "characters" | "sandbox", account: import('../data/account-session.js').AccountSession }} options
 * @returns {{ showAbout(): void, accountMenu: AccountMenu }}
 */
export function mountSiteChrome({ page, account }) {
  const header = document.getElementById("topbar");
  header.insertAdjacentHTML("afterbegin", brandHtml() + navHtml(page));
  header.insertAdjacentHTML("beforeend", '<div class="account-slot"></div>');
  const accountMenu = new AccountMenu(
    header.querySelector(".account-slot"),
    account,
  );
  if (REPOSITORY_URL)
    header.insertAdjacentHTML(
      "beforeend",
      `<a class="icon repo-link" href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer"
        title="Source code on GitHub" aria-label="Source code on GitHub (opens in a new tab)">${GITHUB_ICON}</a>`,
    );

  const footer = document.getElementById("status");
  footer.classList.add("site-footer");
  // [page status] [notice, centred] [page extras] [About · version]
  const notice =
    '<span class="footer-notice">Unofficial fansite · not affiliated with ArenaNet or NCSOFT · Guild Wars 2 © ArenaNet LLC</span>';
  if (footer.firstElementChild)
    footer.firstElementChild.insertAdjacentHTML("afterend", notice);
  else footer.insertAdjacentHTML("afterbegin", `<span></span>${notice}`);
  footer.insertAdjacentHTML(
    "beforeend",
    `<span class="footer-end">
       <button type="button" class="linklike" data-chrome="about">About</button>
       <span class="muted">v${APP_VERSION}</span>
     </span>`,
  );

  document.body.insertAdjacentHTML("beforeend", aboutHtml());
  const about = document.getElementById("aboutDialog");
  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-chrome]")?.dataset.chrome;
    if (action === "about") about.showModal();
    else if (action === "close-about") about.close();
  });
  return { showAbout: () => about.showModal(), accountMenu };
}
