// Copy the third-party UMD builds that pages load as plain scripts (Cytoscape, the classic renderer) into
// web/static/lib/, which Vite serves and ships untouched. Prism and Tether are ordinary packages that Vite bundles.
// Versions are pinned in package.json devDependencies, so updating is:
//   npm install --save-dev --save-exact cytoscape@<version>  &&  npm run vendor
// then update THIRD_PARTY_NOTICES.md. `npm run check` fails if web/static/lib/ drifts from the pinned versions.
// Usage:  node tools/vendor-libs.mjs [--check]
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const libDir = path.join(projectRoot, "web", "static", "lib");

/** package → the file to copy into web/static/lib/ (`from` → `to`). */
export const VENDORED = [
  { name: "cytoscape", from: "dist/cytoscape.min.js", to: "cytoscape.min.js" },
];

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const manifestPath = path.join(libDir, "VERSIONS.json");

if (process.argv.includes("--check")) {
  const pinned = readJson(
    path.join(projectRoot, "package.json"),
  ).devDependencies;
  const vendored = readJson(manifestPath);
  const drift = VENDORED.filter(({ name }) => vendored[name] !== pinned[name]);
  for (const { name } of drift)
    console.error(
      `✗ web/static/lib has ${name} ${vendored[name]}, package.json pins ${pinned[name]}: run npm run vendor`,
    );
  process.exit(drift.length ? 1 : 0);
}

const versions = {};
for (const { name, from, to } of VENDORED) {
  const packageDir = path.join(projectRoot, "node_modules", name);
  copyFileSync(path.join(packageDir, from), path.join(libDir, to));
  versions[name] = readJson(path.join(packageDir, "package.json")).version;
  console.log(`✓ ${name} ${versions[name]} → web/static/lib/${to}`);
}
writeFileSync(manifestPath, `${JSON.stringify(versions, null, 2)}\n`);
