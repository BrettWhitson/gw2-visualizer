// Syntax-check every JavaScript file (node --check), verify every relative import resolves, and make sure generated
// data files are still in their generated one-line form (a formatter pass would bloat and break them).
// Usage:  node tools/check.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoots = ["web/src", "tools", "tests"].map((dir) =>
  path.join(projectRoot, dir),
);

function listJavaScriptFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = path.join(dir, name);
    if (statSync(fullPath).isDirectory()) return listJavaScriptFiles(fullPath);
    return /\.m?js$/.test(name) ? [fullPath] : [];
  });
}

let failures = 0;
const files = [
  ...sourceRoots.flatMap(listJavaScriptFiles),
  path.join(projectRoot, "web", "sw.js"),
];
for (const file of files) {
  const relative = path.relative(projectRoot, file);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures++;
    console.error(`✗ ${relative}\n${error.stderr}`);
    continue;
  }
  for (const [, specifier] of readFileSync(file, "utf8").matchAll(
    /from\s+['"](\.[^'"]+)['"]/g,
  )) {
    if (!existsSync(path.resolve(path.dirname(file), specifier))) {
      failures++;
      console.error(`✗ ${relative}: unresolved import '${specifier}'`);
    }
  }
}
// Generated modules: a header comment, then `export default {…};` on a single line.
for (const relative of ["web/data/mystic-forge-recipes.js"]) {
  const source = readFileSync(path.join(projectRoot, relative), "utf8");
  const body = source.slice(source.indexOf("export default "));
  if (body.trimEnd().includes("\n")) {
    failures++;
    console.error(
      `✗ ${relative}: was reformatted; regenerate it with \`npm run update-forge\` (or restore it from git)`,
    );
  }
}

console.log(
  failures
    ? `${failures} problem(s) in ${files.length} files`
    : `✓ ${files.length} files OK`,
);
process.exit(failures ? 1 : 0);
