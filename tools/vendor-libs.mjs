// Copy the browser builds of the third-party libraries into public/lib/ (the app has no bundler; it loads these as
// plain UMD scripts). Versions are pinned in package.json devDependencies, so updating is:
//   npm install --save-dev --save-exact cytoscape@<version>  &&  npm run vendor
// then update THIRD_PARTY_NOTICES.md. `npm run check` fails if public/lib/ drifts from the pinned versions.
// Usage:  node tools/vendor-libs.mjs [--check]
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const libDir = path.join(projectRoot, "public", "lib");

/** package → file in its dist → file in public/lib/. */
export const VENDORED = [
  { name: "cytoscape", from: "dist/cytoscape.min.js", to: "cytoscape.min.js" },
];

const installedVersion = (name) =>
  JSON.parse(
    readFileSync(
      path.join(projectRoot, "node_modules", name, "package.json"),
      "utf8",
    ),
  ).version;

const manifestPath = path.join(libDir, "VERSIONS.json");
const isCheck = process.argv.includes("--check");

if (isCheck) {
  const pinned = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ).devDependencies;
  const vendored = JSON.parse(readFileSync(manifestPath, "utf8"));
  const drift = VENDORED.filter(({ name }) => vendored[name] !== pinned[name]);
  for (const { name } of drift)
    console.error(
      `✗ public/lib has ${name} ${vendored[name]}, package.json pins ${pinned[name]}: run npm run vendor`,
    );
  process.exit(drift.length ? 1 : 0);
}

const versions = {};
for (const { name, from, to } of VENDORED) {
  copyFileSync(
    path.join(projectRoot, "node_modules", name, from),
    path.join(libDir, to),
  );
  versions[name] = installedVersion(name);
  console.log(`✓ ${name} ${versions[name]} → public/lib/${to}`);
}
writeFileSync(manifestPath, `${JSON.stringify(versions, null, 2)}\n`);
