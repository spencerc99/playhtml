// ABOUTME: Verifies Canvas click playback and pixel output in real Chromium.
// ABOUTME: Covers staggered clicks, replay, residue, resizing, and drawing cleanup.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { verifyClickAppearance } from "./clicks-appearance.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const server = await createServer({
  configFile: false,
  root: rootDir,
  esbuild: { jsx: "automatic" },
  optimizeDeps: { entries: ["smoke-tests/fixtures/clicks.html"] },
  resolve: {
    alias: {
      react: path.join(rootDir, "node_modules/react"),
      "react-dom": path.join(rootDir, "node_modules/react-dom"),
    },
  },
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-01-01") });
  await page.goto(
    `${server.resolvedUrls.local[0]}smoke-tests/fixtures/clicks.html`,
  );
  await page.waitForFunction(() => window.ready);
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  const mark = (id, x, startTime, completed = false) => ({
    id,
    sourceId: id,
    x,
    y: 100,
    color: "#345678",
    radiusFactor: 0.5,
    durationFactor: 0.5,
    trailIndex: 0,
    startTime,
    completed,
  });
  const pixels = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas");
      const data = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      let left = 0,
        right = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const alpha = data[(y * c.width + x) * 4 + 3];
          if (x < 100) left += alpha;
          else right += alpha;
        }
      return { left, right };
    });

  // These replay and schedule cases also exercise the actual parent timeline.
  await page.evaluate(() =>
    window.playClicks(
      [
        { id: "later", x: 180, y: 100, color: "#345678", spawnAtMs: 300 },
        { id: "first", x: 40, y: 100, color: "#345678", spawnAtMs: 0 },
        { id: "first", x: 40, y: 100, color: "#345678", spawnAtMs: 0 },
      ],
      { clickMinRadius: 20, clickMaxRadius: 20, clickExpansionDuration: 100 },
    ),
  );
  await page.waitForSelector("canvas");
  await page.clock.runFor(160);
  assert.ok((await pixels()).left > 0);
  assert.equal((await pixels()).right, 0);
  await page.clock.runFor(320);
  assert.ok((await pixels()).right > 0);

  await page.evaluate(() =>
    window.playClicks(
      [{ id: "repeat", x: 80, y: 100, color: "#345678", spawnAtMs: 0 }],
      { clickMinDuration: 1, clickMaxDuration: 1, clickExpansionDuration: 1 },
      100,
    ),
  );
  await page.clock.runFor(80);
  const firstPass = await pixels();
  await page.clock.runFor(320);
  assert.ok(
    (await pixels()).left > firstPass.left,
    "Replay must retain earlier marks",
  );

  await page.evaluate(() => window.clearClicks());
  await page.waitForFunction(() => !document.querySelector("canvas"));
  await page.clock.runFor(100);
  await page.evaluate(() => {
    window.completions = [];
    window.createDrawing();
  });
  const now = await page.evaluate(() => Date.now());
  await page.evaluate(
    ({ mark, now }) => {
      const settings = {
        clickMinRadius: 30,
        clickMaxRadius: 30,
        clickCoreRadius: 3,
        clickMinDuration: 500,
        clickMaxDuration: 500,
        clickExpansionDuration: 100,
        clickStrokeWidth: 3,
        clickOpacity: 0.6,
        clickNumRings: 6,
        clickRingDelayMs: 10,
        clickAnimationStopPoint: 0.45,
      };
      window.sceneSettings = settings;
      window.drawing.resize(400, 300, 1);
      window.drawing.update([mark], settings, now);
      window.drawing.tick(now + 600, true);
    },
    { mark: mark("settle", 80, now), now },
  );
  assert.deepEqual(await page.evaluate(() => window.completions), ["settle"]);
  const retained = await page.evaluate(() => window.drawingCanvas.toDataURL());
  await page.evaluate((now) => window.drawing.tick(now + 900, true), now);
  assert.equal(
    await page.evaluate(() => window.drawingCanvas.toDataURL()),
    retained,
  );
  await page.evaluate(() => window.drawing.resize(200, 150, 2));
  await page.evaluate((now) => window.drawing.tick(now + 1000, true), now);
  assert.equal(await page.evaluate(() => window.drawingCanvas.width), 400);
  assert.notEqual(
    await page.evaluate(() => window.drawingCanvas.toDataURL()),
    retained,
  );

  // An active mark removed by the retention cap must not stall the replay clock.
  await page.evaluate(
    ({ mark, now }) => {
      window.drawing.update([mark], window.sceneSettings, now);
      window.drawing.update([], window.sceneSettings, now);
      window.drawing.tick(now + 2000, true);
      window.drawing.destroy();
    },
    { mark: mark("evicted", 80, now + 1000), now },
  );
  assert.equal(
    (await page.evaluate(() => window.completions)).filter(
      (id) => id === "evicted",
    ).length,
    1,
  );
  const fade = await page.evaluate(() => {
    window.createDrawing();
    const drawing = window.drawing;
    const canvas = window.drawingCanvas;
    const now = Date.now();
    const settings = { ...window.defaultSettings, clickNumRings: 6 };
    const effects = Array.from({ length: 2003 }, (_, i) => ({
      id: `fade-${i}`,
      sourceId: `fade-${i}`,
      x: i === 0 ? 100 : -1000,
      y: i === 0 ? 100 : -1000,
      color: "#345678",
      radiusFactor: 0.5,
      durationFactor: 0.5,
      startTime: 0,
      trailIndex: 0,
      completed: false,
    }));
    drawing.resize(400, 300, 1);
    const alpha = () => {
      const data = canvas.getContext("2d").getImageData(0, 0, 400, 300).data;
      let total = 0;
      for (let i = 3; i < data.length; i += 4) total += data[i];
      return total;
    };
    drawing.update(effects, settings, now);
    drawing.tick(now, true);
    const before = alpha();
    drawing.update(
      effects.map((effect) => ({ ...effect, completed: true })),
      settings,
      now + 1000,
    );
    drawing.tick(now + 1100, true);
    const halfway = alpha();
    drawing.tick(now + 1200, true);
    const after = alpha();
    const finished = effects.map((effect) => ({ ...effect, completed: true }));
    drawing.update(finished, { ...settings, clickStrokeWidth: 0 }, now + 1300);
    drawing.tick(now + 1300, true);
    const zeroStroke = alpha();
    drawing.update(finished, settings, now + 1400);
    drawing.tick(now + 1400, true);
    const settled = canvas.toDataURL();
    const future = {
      ...effects[0],
      id: "hidden",
      sourceId: "hidden",
      startTime: now + 2000,
      completed: false,
    };
    drawing.update([future], settings, now + 2000);
    drawing.tick(now + 20000, false);
    const hiddenUnchanged = canvas.toDataURL() === settled;
    drawing.destroy();
    return { before, halfway, after, hiddenUnchanged, zeroStroke };
  });
  assert.ok(fade.before > fade.halfway && fade.halfway > fade.after);
  assert.ok(
    Math.abs(fade.halfway - (fade.before + fade.after) / 2) <
      fade.before * 0.01,
  );
  assert.equal(fade.hiddenUnchanged, true);
  assert.equal(fade.zeroStroke, 0);
  assert.ok((await page.evaluate(() => window.completions)).includes("hidden"));

  const budget = await page.evaluate(() => {
    const cache = window.createCache();
    const source = document.createElement("canvas");
    source.width = source.height = 64;
    const ctx = source.getContext("2d");
    ctx.fillStyle = "#123456";
    ctx.fillRect(0, 0, 64, 64);
    const slots = [];
    for (let i = 0; i < 10000; i++) {
      const slot = cache.store(source, 64, 64);
      if (!slot) break;
      slots.push(slot);
    }
    const bytes = cache.byteLength;
    const full = cache.store(source, 64, 64) === undefined;
    cache.release(slots[0]);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 64, 64);
    const reused = cache.store(source, 64, 64);
    const pixel = Array.from(
      reused.canvas
        .getContext("2d")
        .getImageData(reused.x + 4, reused.y + 4, 1, 1).data,
    );
    const sameSlot =
      reused.canvas === slots[0].canvas &&
      reused.x === slots[0].x &&
      reused.y === slots[0].y;
    cache.clear();
    return { bytes, full, sameSlot, pixel, afterClear: cache.byteLength };
  });
  assert.ok(budget.bytes <= 32 * 1024 * 1024);
  assert.equal(budget.full, true);
  assert.equal(budget.sameSlot, true);
  assert.deepEqual(budget.pixel, [255, 0, 0, 255]);
  assert.equal(budget.afterClear, 0);

  const appearance = await verifyClickAppearance(
    page,
    process.env.CLICK_SCREENSHOT_DIR,
  );
  console.log("Appearance:", JSON.stringify(appearance));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: click scheduling, replay residue, settling, resizing, eviction, and cleanup in Chromium",
  );
} finally {
  await browser?.close();
  await server.close();
}
