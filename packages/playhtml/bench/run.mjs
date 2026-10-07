// ABOUTME: Runs the client performance benchmark: bundle size plus the jsdom perf suite.
// ABOUTME: Usage: node bench/run.mjs <label>; appends one row to bench/out/history.tsv.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(pkgDir, "bench/out");
const label = process.argv[2] ?? "unlabeled";
mkdirSync(outDir, { recursive: true });

execSync("npx vite build", { cwd: pkgDir, stdio: "ignore" });

// Files a page downloads on load: the entry plus its static imports.
// Dynamic imports (development tools) load on demand and are excluded.
function staticClosure(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const pattern = /(?:import|export)\s*(?:[^"'()]*?from\s*)?["'](\.\/[^"']+)["']/g;
    for (const match of source.matchAll(pattern)) {
      visit(path.join(path.dirname(file), match[1]));
    }
  };
  visit(entry);
  return [...seen];
}

const entry = path.join(pkgDir, "dist/playhtml.es.js");
const files = staticClosure(entry);
let raw = 0;
let gz = 0;
for (const file of files) {
  const bytes = readFileSync(file);
  raw += bytes.byteLength;
  gz += gzipSync(bytes, { level: 9 }).byteLength;
}

execSync("npx vitest run --config bench/vitest.config.ts", {
  cwd: pkgDir,
  stdio: "ignore",
  env: { ...process.env, NODE_OPTIONS: "--no-experimental-webstorage" },
});
const metrics = {
  bundle_gz_kb: +(gz / 1024).toFixed(1),
  bundle_raw_kb: +(raw / 1024).toFixed(1),
  ...JSON.parse(readFileSync(path.join(outDir, "metrics.json"), "utf8")),
};

const historyFile = path.join(outDir, "history.tsv");
const keys = Object.keys(metrics);
if (!existsSync(historyFile)) appendFileSync(historyFile, ["label", ...keys].join("\t") + "\n");
appendFileSync(historyFile, [label, ...keys.map((k) => metrics[k])].join("\t") + "\n");
console.log(JSON.stringify({ label, ...metrics }));
