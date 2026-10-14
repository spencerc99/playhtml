// ABOUTME: Measures visible Drift images and verifies browsing against realistic local history.
// ABOUTME: Uses an isolated built extension, real IndexedDB image copies, and browser rendering.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const extension = resolve(
  process.env.SCRAPS_EXTENSION_DIR || "extension/dist/chrome-mv3",
);
const evidence = resolve(
  process.env.SCRAPS_EVIDENCE_DIR || "/private/tmp/scraps-drift-loading",
);
const runs = Number(process.env.SCRAPS_RUNS || 3);
const motion =
  process.env.SCRAPS_MOTION === "normal" ? "no-preference" : "reduce";
const ordinaryCount = Number(process.env.SCRAPS_HISTORY_COUNT || 20000);
const scrapCount = 1000;
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "scraps-drift-loading-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    reducedMotion: motion,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["chrome-extension:", "blob:", "data:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  await worker.evaluate(async () =>
    chrome.storage.local.set({
      wwoFeatureAccess: {
        features: { SCRAPS: { stage: "beta", available: true } },
        checkedAt: Date.now(),
      },
      wwoFeatureOverrides: { SCRAPS: true, SCRAP_COLLAGES: false },
      collection_mode_cursor: "off",
      collection_mode_navigation: "off",
      collection_mode_viewport: "off",
      collection_mode_keyboard: "off",
    }),
  );
  const seed = await context.newPage();
  await seed.goto(`${origin}/options.html`);
  const seeded = await seed.evaluate(
    async ({ ordinaryCount, scrapCount }) => {
      const open = (name) =>
        new Promise((resolveDb, reject) => {
          const request = indexedDB.open(name);
          request.onupgradeneeded = () => {
            if (name === "scrap_image_copies_db") {
              for (const [store, keyPath] of [
                ["copies", "hash"],
                ["blobs", "hash"],
                ["sources", "src"],
                ["pins", "collageId"],
                ["meta", "key"],
              ]) {
                const objectStore = request.result.createObjectStore(store, {
                  keyPath,
                });
                if (store === "sources")
                  objectStore.createIndex("hash", "hash");
              }
            }
          };
          request.onsuccess = () => resolveDb(request.result);
          request.onerror = () => reject(request.error);
        });
      const eventsDb = await open("collection_events_db");
      const imagesDb = await open("scrap_image_copies_db");
      const done = (tx) =>
        new Promise((resolveTx, reject) => {
          tx.oncomplete = resolveTx;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      // Encode varied 1200x800 copies using the browser's real WebP encoder.
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext("2d");
      const pixels = ctx.createImageData(1200, 800);
      let random = 1729;
      for (let i = 0; i < pixels.data.length; i += 4) {
        random = (random * 1664525 + 1013904223) >>> 0;
        pixels.data[i] = random & 255;
        pixels.data[i + 1] = (random >>> 8) & 255;
        pixels.data[i + 2] = (random >>> 16) & 255;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const blobs = [];
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsl(${i * 30} 65% 55%)`;
        ctx.fillRect(0, 0, 900, 650);
        ctx.fillStyle = "#fff9ee";
        ctx.font = "bold 90px sans-serif";
        ctx.fillText(`Internet scraps ${i + 1}`, 60, 300);
        blobs.push(
          await new Promise((resolveBlob) =>
            canvas.toBlob(resolveBlob, "image/webp", 0.8),
          ),
        );
      }
      const timestamp = Date.UTC(2026, 9, 1);
      let tx = eventsDb.transaction("events", "readwrite");
      let complete = done(tx);
      for (let i = 0; i < ordinaryCount; i++) {
        tx.objectStore("events").put({
          id: `history-${i}`,
          type: i % 2 ? "navigation" : "cursor",
          ts: timestamp + i * 10,
          domain: "history.example",
          meta: {
            url: `https://history.example/page/${i % 500}`,
            pid: "fixture",
            sid: `session-${i % 40}`,
            vw: 1440,
            vh: 900,
            tz: "UTC",
          },
          data:
            i % 2
              ? {
                  url: `https://history.example/page/${i % 500}`,
                  title: "Browsing history",
                }
              : { x: i % 1440, y: i % 900 },
        });
      }
      for (let i = 0; i < scrapCount; i++) {
        const domain = i % 2 ? "notebook.example" : "gallery.example";
        tx.objectStore("events").put({
          id: `drift-${i}`,
          type: "element",
          ts: timestamp + i * 200,
          domain,
          meta: {
            url: `https://${domain}/page/${i}`,
            pid: "fixture",
            sid: `session-${i % 40}`,
            vw: 1440,
            vh: 900,
            tz: "UTC",
          },
          data: {
            kind: "image",
            src: `https://images.example/photo-${i}.webp`,
            contentHash: i.toString(16).padStart(64, "0"),
            naturalWidth: 1200,
            naturalHeight: 800,
            pageTitle: `Visual notebook page ${i}`,
          },
        });
      }
      await complete;
      tx = imagesDb.transaction(
        ["copies", "blobs", "sources", "meta"],
        "readwrite",
      );
      complete = done(tx);
      for (let i = 0; i < scrapCount; i++) {
        const hash = i.toString(16).padStart(64, "0");
        const blob = blobs[i % blobs.length];
        tx.objectStore("copies").put({
          hash,
          byteLength: blob.size,
          storedAt: timestamp,
          form: "reduced",
          mimeType: "image/webp",
          width: 1200,
          height: 800,
        });
        tx.objectStore("blobs").put({ hash, blob });
        tx.objectStore("sources").put({
          src: `https://images.example/photo-${i}.webp`,
          hash,
        });
      }
      await complete;
      eventsDb.close();
      imagesDb.close();
      return {
        ordinaryCount,
        scrapCount,
        imageBytes:
          (blobs.reduce((n, blob) => n + blob.size, 0) / blobs.length) *
          scrapCount,
      };
    },
    { ordinaryCount, scrapCount },
  );
  const queryTimings = await seed.evaluate(async () => {
    const timings = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const response = await chrome.runtime.sendMessage({
        type: "GET_SCRAPS",
        options: { limit: 500 },
      });
      timings.push({
        durationMs: performance.now() - start,
        count: response.scraps?.length,
        nextCursor: response.nextCursor,
      });
    }
    return timings;
  });
  for (const timing of queryTimings) {
    assert.equal(timing.count, 500);
    assert.ok(timing.nextCursor);
  }
  await writeFile(
    `${evidence}/query-results.json`,
    JSON.stringify({ extension, seeded, queryTimings }, null, 2),
  );
  if (process.env.SCRAPS_QUERY_ONLY === "1") {
    console.log(JSON.stringify({ extension, queryTimings }));
    await seed.close();
    await context.close();
    context = null;
    process.exitCode = 0;
  } else {
    await seed.close();

    const waitVisibleImages = async (page) =>
      expect
        .poll(
          () =>
            page
              .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
              .evaluateAll((images) => {
                const visible = images.filter((img) => {
                  const box = img.getBoundingClientRect();
                  return (
                    box.bottom > 0 &&
                    box.top < innerHeight &&
                    box.right > 0 &&
                    box.left < innerWidth
                  );
                });
                return (
                  visible.length > 0 &&
                  visible.every((img) => img.complete && img.naturalWidth > 0)
                );
              }),
          { timeout: 20000 },
        )
        .toBe(true);
    const results = [];
    const loadedVisibleImages = (page) =>
      page
        .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
        .evaluateAll(
          (images) =>
            images.filter((img) => {
              const box = img.getBoundingClientRect();
              return (
                box.bottom > 0 &&
                box.top < innerHeight &&
                box.right > 0 &&
                box.left < innerWidth &&
                img.complete &&
                img.naturalWidth > 0
              );
            }).length,
        );
    for (let run = 0; run < runs; run++) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          errors.push({
            type: message.type(),
            text: message.text(),
            url: message.location().url,
          });
      });
      await page.addInitScript(() => {
        window.driftTiming = {
          firstImageMs: null,
          firstSixImagesMs: null,
          firstFullyRevealedImageMs: null,
          longTasks: [],
        };
        new PerformanceObserver((list) =>
          window.driftTiming.longTasks.push(
            ...list.getEntries().map((entry) => ({
              start: entry.startTime,
              duration: entry.duration,
            })),
          ),
        ).observe({ type: "longtask", buffered: true });
        const check = () => {
          const decoded = [
            ...document.querySelectorAll(
              ".scrap-collage__tile img:not(.scrap-collage__favicon)",
            ),
          ].filter((img) => {
            const box = img.getBoundingClientRect();
            return (
              img.complete &&
              img.naturalWidth > 0 &&
              box.bottom > 0 &&
              box.top < innerHeight &&
              box.right > 0 &&
              box.left < innerWidth
            );
          });
          const count = decoded.length;
          if (count > 0 && window.driftTiming.firstImageMs === null)
            window.driftTiming.firstImageMs = performance.now();
          if (count >= 6 && window.driftTiming.firstSixImagesMs === null)
            window.driftTiming.firstSixImagesMs = performance.now();
          if (
            window.driftTiming.firstFullyRevealedImageMs === null &&
            decoded.some((img) => {
              const tile = img.closest(".scrap-collage__tile");
              return (
                Number(getComputedStyle(img).opacity) >= 0.99 &&
                Number(getComputedStyle(tile).opacity) > 0
              );
            })
          )
            window.driftTiming.firstFullyRevealedImageMs = performance.now();
          if (
            window.driftTiming.firstSixImagesMs === null ||
            window.driftTiming.firstFullyRevealedImageMs === null
          )
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      const before = await cdp.send("Performance.getMetrics");
      await page.goto(`${origin}/scraps.html`, { waitUntil: "load" });
      await page.waitForFunction(
        () => window.driftTiming.firstImageMs !== null,
      );
      await page.waitForFunction(
        () => window.driftTiming.firstSixImagesMs !== null,
      );
      const visibleImagesReadyMs = await page.evaluate(
        () => window.driftTiming.firstSixImagesMs,
      );
      const driftMetrics = await cdp.send("Performance.getMetrics");
      await page.waitForFunction(
        () => window.driftTiming.firstFullyRevealedImageMs !== null,
      );
      const revealStyles = await page
        .locator(".scrap-collage__developing")
        .first()
        .evaluate((img) => {
          const style = getComputedStyle(img);
          const probe = document.createElement("div");
          probe.className = "scrap-collage__tile--washing-in";
          document.body.append(probe);
          const washInDuration = getComputedStyle(probe).animationDuration;
          probe.remove();
          return { imageTransition: style.transitionDuration, washInDuration };
        });
      if (motion === "no-preference") {
        assert.equal(revealStyles.washInDuration, "0.9s");
        if (process.env.SCRAPS_EXPECT_REVEAL_MS)
          assert.ok(
            revealStyles.imageTransition
              .split(", ")
              .every(
                (duration) =>
                  Number.parseFloat(duration) * 1000 ===
                  Number(process.env.SCRAPS_EXPECT_REVEAL_MS),
              ),
          );
      }
      const timing = await page.evaluate(() => ({
        ...window.driftTiming,
        resourceCount: performance.getEntriesByType("resource").length,
      }));
      await page.getByRole("button", { name: "archive", exact: true }).click();
      await expect(
        page.locator(".scrap-collage__archive-summary"),
      ).toContainText("1000 of 1000", { timeout: 30000 });
      const fullArchiveReadyMs = await page.evaluate(() => performance.now());
      const archiveMetrics = await cdp.send("Performance.getMetrics");
      const archiveLongTasks = await page.evaluate(
        () => window.driftTiming.longTasks,
      );
      console.log(
        JSON.stringify({
          phase: "timing",
          run: run + 1,
          firstVisibleImageMs: timing.firstImageMs,
          firstFullyRevealedImageMs: timing.firstFullyRevealedImageMs,
          visibleImagesReadyMs,
          fullArchiveReadyMs,
        }),
      );
      await writeFile(
        `${evidence}/timing-${run + 1}.json`,
        JSON.stringify(
          { timing, visibleImagesReadyMs, fullArchiveReadyMs, errors },
          null,
          2,
        ),
      );
      if (run === 0) {
        await expect.poll(() => loadedVisibleImages(page)).toBeGreaterThan(0);
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/archive.png` });
        await page.getByRole("button", { name: /^from / }).click();
        await page.locator('[data-place="notebook.example"]').click();
        await page
          .getByRole("textbox", { name: "Find a domain or page" })
          .press("Escape");
        await expect(
          page.locator(".scrap-collage__archive-summary"),
        ).toContainText("500 of 1000");
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/filtered.png` });
        await page.locator(".scrap-collage__tile").first().click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator(".scrap-lightbox__scrap img")
              .evaluate((img) => img.complete && img.naturalWidth > 0),
          )
          .toBe(true);
        await expect(page.getByRole("dialog")).toContainText(
          "notebook.example",
        );
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/lightbox.png` });
        await page
          .getByRole("button", { name: "Close examine view", exact: true })
          .click();
        await page.reload();
        await expect.poll(() => loadedVisibleImages(page)).toBeGreaterThan(0);
        await page
          .getByRole("button", { name: "archive", exact: true })
          .click();
        await expect(
          page.locator(".scrap-collage__archive-summary"),
        ).toContainText("1000 of 1000");
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/reload.png` });
        await page.getByRole("button", { name: /^from / }).click();
        await page.getByRole("button", { name: "clear", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Find a domain or page" })
          .press("Escape");
        await page.getByRole("button", { name: "drift", exact: true }).click();
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await expect.poll(() => loadedVisibleImages(page)).toBeGreaterThan(0);
        await expect
          .poll(() =>
            page.locator(".scrap-collage__tile").evaluateAll((tiles) =>
              tiles.some((tile) => {
                const image = tile.querySelector(
                  "img:not(.scrap-collage__favicon)",
                );
                return (
                  image?.complete &&
                  image.naturalWidth > 0 &&
                  Number(getComputedStyle(tile).opacity) > 0
                );
              }),
            ),
          )
          .toBe(true);
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/drift-normal-motion.png` });
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => loadedVisibleImages(page)).toBeGreaterThan(0);
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/drift-mobile.png` });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await waitVisibleImages(page);
        await page.screenshot({ path: `${evidence}/drift.png` });
      }
      console.log(
        JSON.stringify({
          run: run + 1,
          firstVisibleImageMs: timing.firstImageMs,
          visibleImagesReadyMs,
          fullArchiveReadyMs,
          errors,
        }),
      );
      const expectedNetworkErrors = errors.filter(
        (error) =>
          typeof error === "object" &&
          error.text ===
            "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector" &&
          /^https:\/\/(fonts\.googleapis\.com|www\.google\.com|icons\.duckduckgo\.com)\//.test(
            error.url,
          ),
      );
      assert.deepEqual(
        errors.filter((error) => !expectedNetworkErrors.includes(error)),
        [],
        "No unexpected browser warnings or errors",
      );
      const delta = (name) =>
        (driftMetrics.metrics.find((m) => m.name === name).value -
          before.metrics.find((m) => m.name === name).value) *
        1000;
      results.push({
        run: run + 1,
        firstFullyRevealedImageMs: timing.firstFullyRevealedImageMs,
        revealStyles,
        firstVisibleImageMs: timing.firstImageMs,
        visibleImagesReadyMs,
        fullArchiveReadyMs,
        archiveTaskDurationMs:
          (archiveMetrics.metrics.find((m) => m.name === "TaskDuration").value -
            before.metrics.find((m) => m.name === "TaskDuration").value) *
          1000,
        archiveScriptDurationMs:
          (archiveMetrics.metrics.find((m) => m.name === "ScriptDuration")
            .value -
            before.metrics.find((m) => m.name === "ScriptDuration").value) *
          1000,
        archiveLongTaskDurationMs: archiveLongTasks.reduce(
          (n, task) => n + task.duration,
          0,
        ),
        archiveLongestTaskMs: Math.max(
          0,
          ...archiveLongTasks.map((task) => task.duration),
        ),
        taskDurationMs: delta("TaskDuration"),
        scriptDurationMs: delta("ScriptDuration"),
        resourceCount: timing.resourceCount,
        longTaskCount: timing.longTasks.length,
        longTaskDurationMs: timing.longTasks.reduce(
          (n, task) => n + task.duration,
          0,
        ),
        longestTaskMs: Math.max(
          0,
          ...timing.longTasks.map((task) => task.duration),
        ),
        expectedNetworkErrors,
        errors: [],
      });
      await page.close();
    }
    const median = (key) =>
      [...results].sort((a, b) => a[key] - b[key])[
        Math.floor(results.length / 2)
      ][key];
    const medians = Object.fromEntries(
      [
        "firstVisibleImageMs",
        "firstFullyRevealedImageMs",
        "visibleImagesReadyMs",
        "fullArchiveReadyMs",
        "archiveTaskDurationMs",
        "archiveScriptDurationMs",
        "archiveLongTaskDurationMs",
        "archiveLongestTaskMs",
        "taskDurationMs",
        "scriptDurationMs",
        "resourceCount",
        "longTaskCount",
        "longTaskDurationMs",
        "longestTaskMs",
      ].map((key) => [key, median(key)]),
    );
    const report = {
      extension,
      motion,
      seeded,
      results,
      medians,
      queryTimings,
      evidence,
      note: "Full archive readiness includes switching from Drift to Archive after visible images load.",
    };
    await writeFile(
      `${evidence}/results.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
