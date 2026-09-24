// Assemble the deployable site into _site/: everything in public/ plus the root LICENSE and third-party notices.
// There's no bundling/minification: the app ships as plain ES modules; hosts should serve with gzip/brotli.
// Usage:  node tools/build-site.mjs   (then upload _site/ to any static host)
import {
  cpSync,
  existsSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir = path.join(projectRoot, "_site");

const ROOT_FILES = ["LICENSE", "THIRD_PARTY_NOTICES.md"]; // linked from the About dialog

rmSync(outputDir, { recursive: true, force: true });
cpSync(path.join(projectRoot, "public"), outputDir, { recursive: true });
for (const file of ROOT_FILES)
  cpSync(path.join(projectRoot, file), path.join(outputDir, file));
writeFileSync(path.join(outputDir, ".nojekyll"), ""); // GitHub Pages: serve files as-is (keeps _headers etc.)

// Sanity check: every relative import in the shipped modules must exist in the output.
let missing = 0,
  totalBytes = 0;
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
for (const file of walk(outputDir)) {
  totalBytes += statSync(file).size;
  if (!file.endsWith(".js")) continue;
  for (const [, specifier] of readFileSync(file, "utf8").matchAll(
    /(?:from\s+|import\()\s*['"](\.[^'"]+)['"]/g,
  )) {
    if (!existsSync(path.resolve(path.dirname(file), specifier))) {
      missing++;
      console.error(
        `missing import ${specifier} in ${path.relative(outputDir, file)}`,
      );
    }
  }
}
if (missing) process.exit(1);
console.log(`Built _site/ (${(totalBytes / 1024).toFixed(0)} KB uncompressed)`);
