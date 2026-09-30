// Copy the third-party libraries into public/lib/ (the app has no bundler). Two kinds:
//  - UMD builds, loaded as plain scripts (Cytoscape);
//  - ES-module source trees, imported by the app (Prism, the graph engine, and Tether, its layout and physics). Their
//    imports of each other ("tether/…") are rewritten to relative paths, since the pages' CSP rules out import maps.
// Versions are pinned in package.json devDependencies, so updating is:
//   npm install --save-dev --save-exact cytoscape@<version>  &&  npm run vendor
//   npm install --save-dev --save-exact prism@github:BrettWhitson/prism#<commit>  &&  npm run vendor
// then update THIRD_PARTY_NOTICES.md. `npm run check` fails if public/lib/ drifts from the pinned versions.
// Usage:  node tools/vendor-libs.mjs [--check]
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const libDir = path.join(projectRoot, "public", "lib");

/**
 * package → what to copy into public/lib/: a file (`from` → `to`), or a directory of ES modules (`dir` → `to`)
 * whose bare imports of the other vendored module trees become relative.
 */
export const VENDORED = [
  { name: "cytoscape", from: "dist/cytoscape.min.js", to: "cytoscape.min.js" },
  { name: "tether", dir: "src", to: "tether" },
  { name: "prism", dir: "src", to: "prism" },
];

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * The installed version, in the same form package.json pins it: the version number for registry packages, the
 * `github:owner/repo#commit` spec for GitHub ones (their commit, from package-lock.json).
 */
function installedVersion(name) {
  const lock = readJson(path.join(projectRoot, "package-lock.json"));
  const resolved = lock.packages[`node_modules/${name}`]?.resolved ?? "";
  const github = resolved.match(
    /github\.com[/:]([^/]+\/[^/.#]+)(?:\.git)?#(\w+)/,
  );
  if (github) return `github:${github[1]}#${github[2]}`;
  return readJson(path.join(projectRoot, "node_modules", name, "package.json"))
    .version;
}

const manifestPath = path.join(libDir, "VERSIONS.json");
const isCheck = process.argv.includes("--check");

if (isCheck) {
  const pinned = readJson(
    path.join(projectRoot, "package.json"),
  ).devDependencies;
  const vendored = readJson(manifestPath);
  const drift = VENDORED.filter(({ name }) => vendored[name] !== pinned[name]);
  for (const { name } of drift)
    console.error(
      `✗ public/lib has ${name} ${vendored[name]}, package.json pins ${pinned[name]}: run npm run vendor`,
    );
  process.exit(drift.length ? 1 : 0);
}

const moduleTrees = VENDORED.filter((entry) => entry.dir);

/** Copy a module tree, rewriting `from "<vendored>/x.js"` to a path relative to the file. */
function copyModuleTree(sourceDir, targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyModuleTree(source, target);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    let code = readFileSync(source, "utf8");
    for (const { name, to } of moduleTrees) {
      const relative = path
        .relative(targetDir, path.join(libDir, to))
        .split(path.sep)
        .join("/");
      code = code.replace(
        new RegExp(`(from\\s+["'])${name}/`, "g"),
        `$1${relative}/`,
      );
    }
    writeFileSync(target, code);
  }
}

const versions = {};
for (const { name, from, dir, to } of VENDORED) {
  const packageDir = path.join(projectRoot, "node_modules", name);
  if (dir) copyModuleTree(path.join(packageDir, dir), path.join(libDir, to));
  else copyFileSync(path.join(packageDir, from), path.join(libDir, to));
  versions[name] = installedVersion(name);
  console.log(`✓ ${name} ${versions[name]} → public/lib/${to}`);
}
writeFileSync(manifestPath, `${JSON.stringify(versions, null, 2)}\n`);
