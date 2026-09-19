// ABOUTME: Verifies the built local audit workbench using generated public-page examples.
// ABOUTME: Exercises label persistence, correction interchange, and private artifact boundaries.

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.join(root, "private-data/commute-evaluation-data.json");
assert(!existsSync(artifact), "Run in an isolated worktree without a generated evaluation dataset");
const evidence = await mkdtemp(path.join(os.tmpdir(), "commute-audit-proof-"));
const output = path.join(evidence, "build");
const run = (args) => execFileSync("bun", args, { cwd: root, stdio: "pipe" });
let server;
let browser;
try {
  run(["--eval", `
    import { CommuteEvaluationBuilder } from './extension/website/commute-audit/evaluationAnalysis.ts';
    import { mkdir, writeFile } from 'node:fs/promises';
    const builder = new CommuteEvaluationBuilder();
    const examples = [['https://en.wikipedia.org/wiki/Tree','Tree — Wikipedia'], ['https://www.gutenberg.org/ebooks/11','Alice in Wonderland'], ['https://www.nasa.gov/missions/','NASA missions']];
    let ts = Date.parse('2026-09-18T12:00:00Z');
    for (const [url,title] of examples) for (const pid of ['example-reader-a','example-reader-b']) {
      for (const event of ['focus','blur']) { builder.addNavigation({id:String(ts),type:'navigation',ts,data:{event,title},meta:{pid,sid:pid,url,vw:1440,vh:900,tz:'UTC'}});ts+=120000; }
    }
    const data=builder.finalize('public-examples',{collectionRows:12,navigationRows:12,metadataRows:0,parseFailures:0,failureExamples:[]});
    await mkdir('private-data',{recursive:true});await writeFile('private-data/commute-evaluation-data.json',JSON.stringify(data));
  `]);
  run(["run", "--cwd", "extension/website", "build", "--", "--mode", "commute-audit", "--outDir", output]);
  assert(!existsSync(path.join(output, "commute-evaluation-data.json")));
  server = spawn("bun", ["run", "--cwd", "extension/website", "preview", "--", "--mode", "commute-audit", "--outDir", output, "--host", "127.0.0.1", "--port", "5198", "--strictPort"], { cwd: root, stdio: "pipe" });
  const base = "http://127.0.0.1:5198";
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await fetch(`${base}/commute-evaluation-data.json`, { headers: { Origin: "https://attacker.example" } })).status, 403);
  assert.equal((await fetch(`${base}/commute-evaluation-data.json`)).status, 200);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/commute-audit/`);
  await page.getByRole("heading", { name: "Finding the human web" }).waitFor();
  assert.equal(await page.locator(".candidate-row").count(), 3);
  await page.screenshot({ path: path.join(evidence, "overview.png"), fullPage: true });
  await page.getByLabel("Search candidates").fill("Wikipedia");
  assert.equal(await page.locator(".candidate-row").count(), 1);
  await page.getByRole("button", { name: "Promote", exact: true }).click();
  await page.getByLabel("Content", { exact: true }).selectOption("Learning & reference");
  await page.reload();
  await page.getByLabel("Search candidates").fill("Wikipedia");
  assert.equal(await page.getByRole("button", { name: "Promote", exact: true }).getAttribute("aria-pressed"), "true");
  await page.locator(".workbench-grid").screenshot({ path: path.join(evidence, "reviewed.png") });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export corrections" }).click();
  const download = await downloadPromise;
  const correctionsPath = path.join(evidence, "corrections.json");
  await download.saveAs(correctionsPath);
  const corrections = JSON.parse(await readFile(correctionsPath, "utf8"));
  assert.equal(Object.values(corrections.corrections)[0].judgment, "Promote");
  await page.getByRole("button", { name: "Revert this correction" }).click();
  await page.locator('input[type="file"]').setInputFiles(correctionsPath);
  await page.getByRole("button", { name: "Revert this correction" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ corrections: { [Object.keys(corrections.corrections)[0]]: null } })) });
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Promote", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, evidence, assertions: "built page load; private dataset excluded from build; cross-origin denied; filter; label; reload; export; revert; import; invalid import; no page errors" }, null, 2));
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
  if (existsSync(artifact)) await unlink(artifact);
}
