// ABOUTME: Measures SVG and Canvas trail path drawing in real Chromium.
// ABOUTME: Captures matched color and monochrome frames for visual review.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const outputDirectory = process.argv[2] ?? "/private/tmp/playhtml-trail-canvas-benchmark";
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  optimizeDeps: { noDiscovery: true },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const url = new URL("smoke-tests/fixtures/trail-canvas.html", server.resolvedUrls.local[0]).href;
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];

const results = [];
for (const scene of [
  { trails: 10, points: 200, mono: false },
  { trails: 50, points: 500, mono: false },
  { trails: 50, points: 500, activeCount: 2, mono: false },
  { trails: 150, points: 300, mono: false },
  { trails: 150, points: 300, activeCount: 5, mono: false },
  { trails: 2, points: 100, mono: true },
  { trails: 50, points: 500, mono: true },
]) {
  for (const option of scene.mono && scene.trails <= 2 ? [
    { mode: "svg" }, { mode: "canvas" }, { mode: "canvas", canvasFilter: true },
  ] : [{ mode: "svg" }, { mode: "canvas" }]) {
    const { mode, canvasFilter = false } = option;
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((options) => window.setup(options), { ...scene, ...option });
    await page.evaluate(() => window.drawFrame(45, true));
    const label = `${scene.trails}x${scene.points}-${scene.activeCount ?? scene.trails}active-${scene.mono ? "mono" : "color"}-${mode}${canvasFilter ? "-filter" : ""}`;
    await page.screenshot({ path: path.join(outputDirectory, `${label}.png`) });
    const frames = await page.evaluate(() => window.measureFrames());
    const sortedFrameTimes = [...frames.frameTimes].sort((a, b) => a - b);
    results.push({
      ...scene,
      mode,
      canvasFilter,
      averageDrawMs: frames.drawTimes.reduce((sum, n) => sum + n, 0) / frames.drawTimes.length,
      p95FrameMs: sortedFrameTimes[Math.floor(sortedFrameTimes.length * 0.95)],
      slowFrames: frames.frameTimes.filter((n) => n > 20).length,
    });
    console.log(results.at(-1));
    await page.close();
  }
}
await browser.close();
await server.close();
if (errors.length) throw new Error(errors.join("\n"));
await writeFile(path.join(outputDirectory, "results.json"), JSON.stringify(results, null, 2));
