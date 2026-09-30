// Finish the deployable site after `vite build` has written the pages into _site/: add the root LICENSE and
// third-party notices (linked from the About dialog) and tell GitHub Pages to serve the files as they are.
// Usage:  npm run build   (vite build, then this; upload _site/ to any static host)
import { cpSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir = path.join(projectRoot, "_site");

if (!existsSync(path.join(outputDir, "index.html"))) {
  console.error("No _site/index.html: run `vite build` first (npm run build)");
  process.exit(1);
}
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  cpSync(path.join(projectRoot, file), path.join(outputDir, file));
writeFileSync(path.join(outputDir, ".nojekyll"), ""); // keeps _headers and other dotless files as they are
console.log("Added LICENSE, THIRD_PARTY_NOTICES.md and .nojekyll to _site/");
