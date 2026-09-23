// Local static server for development. No dependencies.
//
// Serves public/ with correct MIME types (browsers refuse ES modules served as text/plain) and
// `Cache-Control: no-store`, so edits show up on reload. LICENSE and THIRD_PARTY_NOTICES.md live in the repository
// root but are linked from the About dialog, so they're served too (the build copies them into the site).
//
// Usage:  node tools/dev-server.mjs [port] [--open]      (default port 8642; --open launches the browser)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");
const ROOT_FILES_SERVED = new Set(["/LICENSE", "/THIRD_PARTY_NOTICES.md"]);
const DEFAULT_PORT = 8642;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gz": "application/gzip",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  "": "text/plain; charset=utf-8", // LICENSE
};

const args = process.argv.slice(2);
const port = Number(
  args.find((arg) => /^\d+$/.test(arg)) ?? process.env.PORT ?? DEFAULT_PORT,
);
const shouldOpenBrowser = args.includes("--open");

/** Map a request URL to a file inside public/ (or an allowed root file), refusing anything that escapes it. */
async function resolveFile(requestUrl) {
  const { pathname } = new URL(requestUrl, "http://localhost");
  if (ROOT_FILES_SERVED.has(pathname))
    return path.join(PROJECT_ROOT, pathname.slice(1));
  const filePath = path.resolve(
    PUBLIC_ROOT,
    `.${decodeURIComponent(pathname)}`,
  );
  if (filePath !== PUBLIC_ROOT && !filePath.startsWith(PUBLIC_ROOT + path.sep))
    return null;
  try {
    const info = await stat(filePath);
    return info.isDirectory() ? path.join(filePath, "index.html") : filePath;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const filePath = await resolveFile(request.url);
  try {
    if (!filePath)
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(filePath).toLowerCase()] ??
        "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    const status =
      error.code === "ENOENT" || error.code === "EISDIR" ? 404 : 500;
    if (status === 500) console.error(error);
    else console.warn(`404 ${request.url}`);
    response
      .writeHead(status, { "Content-Type": "text/plain; charset=utf-8" })
      .end(status === 404 ? "Not found" : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}/`;
  console.log(`GW2 Visualizer: ${url}   (Ctrl+C to stop)`);
  if (shouldOpenBrowser) openInBrowser(url);
});

server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Try: node tools/dev-server.mjs ${port + 1}`
      : error,
  );
  process.exit(1);
});

function openInBrowser(url) {
  const [command, commandArgs] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command, commandArgs, { stdio: "ignore", detached: true }).unref();
}
