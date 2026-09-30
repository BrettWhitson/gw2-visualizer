// Vite builds the pages in web/ into _site/ for GitHub Pages. Static files that ship untouched (icons, the web
// manifest, the data snapshot) live in web/static/. See the README's Development section.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

/** The deployed pages, one build input each. lab/ holds development-only pages, served by `vite` but not built. */
const PAGES = ["index", "crafting", "craftable", "characters", "sandbox"];

/**
 * The pages carry their Content-Security-Policy in a <meta> tag (GitHub Pages can't send headers). While `vite`
 * serves, its client needs a WebSocket back to the dev server for hot reload, and a blob: worker to wait for the
 * server when it restarts, so allow both in development only.
 */
function devCsp() {
  return {
    name: "gw2v:dev-csp",
    apply: "serve",
    transformIndexHtml: (html) =>
      html
        .replace(/connect-src 'self'/, "connect-src 'self' ws://localhost:*")
        .replace(/worker-src 'self'/, "worker-src 'self' blob:"),
  };
}

/** script-src 'self' blocks inline scripts, so a build that emits one would ship a broken page: fail it instead. */
function noInlineScripts() {
  return {
    name: "gw2v:no-inline-scripts",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (!file.fileName.endsWith(".html")) continue;
        const inline = /<script\b(?![^>]*\bsrc=)[^>]*>/i.exec(
          String(file.source),
        );
        if (inline)
          this.error(`${file.fileName} has an inline script: ${inline[0]}`);
      }
    },
  };
}

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * `npm run dev:local` (mode "engines": Vite reserves "local") runs against the Prism and Tether checkouts beside this
 * repo instead of the pinned packages, so an edit in ../prism/src or ../tether/src reloads the app at once.
 */
function localEngines(mode) {
  if (mode !== "engines") return {};
  const engines = ["prism", "tether"].map((name) => ({
    find: new RegExp(`^${name}/`),
    replacement: `${path.resolve(projectRoot, "..", name, "src")}/`,
  }));
  return {
    resolve: { alias: engines },
    server: {
      fs: { allow: [projectRoot, ...engines.map((e) => e.replacement)] },
    },
  };
}

export default defineConfig(({ mode }) => ({
  ...localEngines(mode),
  root: "web",
  base: "./",
  appType: "mpa", // separate pages: a missing file is a 404, never another page's HTML
  publicDir: "static",
  build: {
    outDir: "../_site",
    emptyOutDir: true,
    // The Mystic Forge recipes are ~700 KB of generated data in their own lazily loaded chunk.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      input: Object.fromEntries(
        PAGES.map((page) => [page, `web/${page}.html`]),
      ),
    },
  },
  server: {
    port: 8642,
    strictPort: true,
    ...localEngines(mode).server,
  },
  preview: { port: 8642, strictPort: true },
  plugins: [
    svelte(),
    devCsp(),
    noInlineScripts(),
    VitePWA({
      // Our own worker (web/sw.js) keeps its caching rules; the plugin only fills in the list of built files.
      strategies: "injectManifest",
      srcDir: ".",
      filename: "sw.js",
      injectRegister: false, // src/pwa.js registers it
      manifest: false, // web/static/manifest.webmanifest
      injectManifest: {
        rollupFormat: "iife", // a classic worker script, like the one it replaces
        globPatterns: [
          "*.html",
          "assets/**/*.{js,css}",
          "manifest.webmanifest",
          "icons/icon.svg",
        ],
        // The forge data chunk is ~700 KB; precache it too, so the crafting page is complete offline.
        maximumFileSizeToCacheInBytes: 1024 * 1024,
      },
    }),
  ],
}));
