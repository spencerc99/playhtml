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
const overall = process.env.SCRAPS_OVERALL !== "0";
const motion =
  process.env.SCRAPS_MOTION === "reduce" ? "reduce" : "no-preference";
const ordinaryCount = Number(process.env.SCRAPS_HISTORY_COUNT || 20000);
const scrapCount = 1000;
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "scraps-drift-loading-"));
let context;
async function launch() {
  const browserContext = await chromium.launchPersistentContext(profile, {
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
  browserContext.setDefaultTimeout(30000);
  browserContext.setDefaultNavigationTimeout(30000);
  browserContext.on("close", () =>
    console.log(
      JSON.stringify({ lifecycle: "context-closed", at: Date.now() }),
    ),
  );
  browserContext
    .browser()
    ?.on("disconnected", () =>
      console.log(
        JSON.stringify({ lifecycle: "browser-disconnected", at: Date.now() }),
      ),
    );
  await browserContext.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["chrome-extension:", "blob:", "data:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await browserContext.routeWebSocket("**/*", (socket) => socket.close());
  return browserContext;
}
try {
  context = await launch();
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
        originalDigest: [
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", await blobs[0].arrayBuffer()),
          ),
        ]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
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

    const finishedChecks = [];
    const waitVisibleImages = async (page, minimumImages) => {
      const examinedImage = page.locator(".scrap-lightbox__scrap img");
      if (await examinedImage.count()) {
        await examinedImage.evaluate(async (img) => {
          await img.decode();
          await new Promise((resolveFrame) =>
            requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
          );
        });
        return;
      }
      await expect
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
          { timeout: 20000, intervals: [50] },
        )
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise((resolveFrame) =>
            requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
          ),
      );
      let check;
      await expect
        .poll(
          async () => {
            const centers = await page
              .locator(".scrap-collage__image")
              .evaluateAll((images) => {
                const controls = document
                  .querySelector('[aria-label="Scrap controls"]')
                  ?.getBoundingClientRect();
                return images.flatMap((img) => {
                  const box = img.getBoundingClientRect();
                  const x = box.x + box.width / 2;
                  const y = box.y + box.height / 2;
                  if (
                    x < 2 ||
                    x >= innerWidth - 2 ||
                    y < 70 ||
                    y >= innerHeight - 2 ||
                    (controls &&
                      x >= controls.left &&
                      x <= controls.right &&
                      y >= controls.top &&
                      y <= controls.bottom)
                  )
                    return [];
                  return [{ x, y }];
                });
              });
            const png = await page.screenshot();
            check = await page.evaluate(
              async ({ png, centers }) => {
                const image = new Image();
                image.src = `data:image/png;base64,${png}`;
                await image.decode();
                const canvas = new OffscreenCanvas(
                  image.naturalWidth,
                  image.naturalHeight,
                );
                const context = canvas.getContext("2d");
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                ).data;
                const painted = centers.filter(({ x, y }) => {
                  for (const offsetX of [-3, 0, 3])
                    for (const offsetY of [-3, 0, 3]) {
                      const index =
                        (Math.round(y + offsetY) * canvas.width +
                          Math.round(x + offsetX)) *
                        4;
                      const red = pixels[index],
                        green = pixels[index + 1],
                        blue = pixels[index + 2];
                      const max = Math.max(red, green, blue),
                        min = Math.min(red, green, blue);
                      if (
                        max > 0 &&
                        ((max - min) / max >= 0.45 ||
                          (max < 175 && min > 85 && (max - min) / max < 0.2))
                      )
                        return true;
                    }
                  return false;
                }).length;
                return {
                  viewport: { width: innerWidth, height: innerHeight },
                  tileCount: document.querySelectorAll(".scrap-collage__tile")
                    .length,
                  sampledCenters: centers.length,
                  paintedCenters: painted,
                  grayNoiseCenters: centers.filter(({ x, y }) => {
                    const index =
                      (Math.round(y) * canvas.width + Math.round(x)) * 4;
                    const channels = [
                      pixels[index],
                      pixels[index + 1],
                      pixels[index + 2],
                    ];
                    const max = Math.max(...channels),
                      min = Math.min(...channels);
                    return max < 175 && min > 85 && (max - min) / max < 0.2;
                  }).length,
                  paintedFraction: painted / centers.length,
                  fullViewportReadyMs: performance.now(),
                  verification:
                    "Actual screenshot pixels at fixture image centers, excluding control overlays",
                };
              },
              { png: png.toString("base64"), centers },
            );
            return (
              check.sampledCenters >=
                (minimumImages ?? (check.viewport.width >= 1200 ? 100 : 6)) &&
              check.tileCount >=
                (minimumImages ?? (check.viewport.width >= 1200 ? 100 : 20)) &&
              check.paintedFraction >= 0.9
            );
          },
          { timeout: 20000, intervals: [100] },
        )
        .toBe(true)
        .catch(async (error) => {
          await writeFile(
            `${evidence}/pixel-failure.json`,
            JSON.stringify(check, null, 2),
          );
          await page.screenshot({ path: `${evidence}/pixel-failure.png` });
          throw error;
        });
      finishedChecks.push(check);
      await writeFile(
        `${evidence}/finished-readiness.json`,
        JSON.stringify(finishedChecks, null, 2),
      );
    };
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
      let relaunchedAt = null;
      if (process.env.SCRAPS_COLD_BROWSER === "1") {
        await context.close();
        context = await launch();
        relaunchedAt = Date.now();
      }
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on("crash", () =>
        console.error(`Renderer crashed in run ${run + 1}`),
      );
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
      await page.addInitScript(
        ({ overall }) => {
          window.driftTiming = {
            firstImageMs: null,
            firstSixImagesMs: null,
            firstFullyRevealedImageMs: null,
            firstSixFullyVisibleImagesMs: null,
            firstImageDecodedMs: null,
            decodeResolutions: [],
            firstSixSharpFrameMs: null,
            decodeRetries: [],
            scrapImageErrors: [],
            decodeErrors: [],
            detachedDecodeCancellations: 0,
            searchInputs: [],
            searchImageLoads: [],
            frameGaps: [],
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
          document.addEventListener(
            "error",
            (event) => {
              const img = event.target;
              if (
                img instanceof HTMLImageElement &&
                img.matches(".scrap-collage__image")
              )
                window.driftTiming.scrapImageErrors.push({
                  ms: performance.now(),
                  src: img.getAttribute("src"),
                  currentSrc: img.currentSrc,
                  loading: img.loading,
                  decoding: img.decoding,
                  naturalWidth: img.naturalWidth,
                  key: img.closest(".scrap-collage__tile")?.dataset.scrapKey,
                });
            },
            true,
          );
          document.addEventListener(
            "input",
            (event) => {
              if (
                event.target instanceof HTMLInputElement &&
                event.target.getAttribute("aria-label") === "Search scraps"
              )
                window.driftTiming.searchInputs.push(performance.now());
            },
            true,
          );
          document.addEventListener(
            "load",
            (event) => {
              const img = event.target;
              const search = document.querySelector(
                'input[aria-label="Search scraps"]',
              );
              if (
                img instanceof HTMLImageElement &&
                img.matches(".scrap-collage__image") &&
                search?.value
              )
                window.driftTiming.searchImageLoads.push({
                  ms: performance.now(),
                  key: img.closest(".scrap-collage__tile")?.dataset.scrapKey,
                  naturalWidth: img.naturalWidth,
                });
            },
            true,
          );
          let lastFrame = null;
          const observeFrames = (now) => {
            if (lastFrame !== null)
              window.driftTiming.frameGaps.push({
                start: lastFrame,
                end: now,
                duration: now - lastFrame,
              });
            lastFrame = now;
            requestAnimationFrame(observeFrames);
          };
          requestAnimationFrame(observeFrames);
          const decoding = new WeakMap();
          let decodeCandidates = [];
          let fullyVisibleFrames = 0;
          const check = () => {
            if (overall) return;
            const loaded = [
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
            const count = loaded.length;
            decodeCandidates = decodeCandidates.filter(
              (img) => img.isConnected,
            );
            for (const img of loaded) {
              if (decodeCandidates.length >= 6) break;
              if (
                img.currentSrc &&
                img.getAttribute("src") &&
                !decodeCandidates.includes(img)
              )
                decodeCandidates.push(img);
            }
            for (const img of decodeCandidates) {
              const src = img.currentSrc;
              if (!src) continue;
              let state = decoding.get(img);
              if (!state || state.src !== src) {
                state = { src, decoded: false };
                decoding.set(img, state);
                const decode = (retried = false) =>
                  img
                    .decode()
                    .then(() => {
                      if (decoding.get(img) !== state || img.currentSrc !== src)
                        return;
                      state.decoded = true;
                      window.driftTiming.decodeResolutions.push({
                        candidate: decodeCandidates.indexOf(img),
                        ms: performance.now(),
                        src,
                      });
                      if (window.driftTiming.firstImageDecodedMs === null)
                        window.driftTiming.firstImageDecodedMs =
                          performance.now();
                    })
                    .catch((error) => {
                      if (!img.isConnected) {
                        window.driftTiming.detachedDecodeCancellations += 1;
                        return;
                      }
                      if (decoding.get(img) !== state || img.currentSrc !== src)
                        return;
                      const failure = {
                        src,
                        error: String(error),
                        complete: img.complete,
                        naturalWidth: img.naturalWidth,
                        currentSrc: img.currentSrc,
                        attributeSrc: img.getAttribute("src"),
                        loading: img.loading,
                        connected: img.isConnected,
                      };
                      if (!retried) {
                        window.driftTiming.decodeRetries.push(failure);
                        requestAnimationFrame(() => {
                          if (img.isConnected && img.currentSrc === src)
                            decode(true);
                        });
                      } else window.driftTiming.decodeErrors.push(failure);
                    });
                decode();
              }
            }
            if (count > 0 && window.driftTiming.firstImageMs === null)
              window.driftTiming.firstImageMs = performance.now();
            if (count >= 6 && window.driftTiming.firstSixImagesMs === null)
              window.driftTiming.firstSixImagesMs = performance.now();
            const fullyVisible = loaded.filter((img) => {
              if (!decoding.get(img)?.decoded) return false;
              const tile = img.closest(".scrap-collage__tile");
              return [img, tile].every((element) => {
                const style = getComputedStyle(element);
                const blurs = [...style.filter.matchAll(/blur\(([^)]+)\)/g)];
                return (
                  Number(style.opacity) >= 0.99 &&
                  blurs.every((match) => Number.parseFloat(match[1]) === 0)
                );
              });
            });
            if (
              fullyVisible.length > 0 &&
              window.driftTiming.firstFullyRevealedImageMs === null
            )
              window.driftTiming.firstFullyRevealedImageMs = performance.now();
            if (
              fullyVisible.length >= 6 &&
              window.driftTiming.firstSixSharpFrameMs === null
            )
              window.driftTiming.firstSixSharpFrameMs = performance.now();
            fullyVisibleFrames =
              fullyVisible.length >= 6 ? fullyVisibleFrames + 1 : 0;
            if (
              fullyVisibleFrames >= 2 &&
              window.driftTiming.firstSixFullyVisibleImagesMs === null
            )
              window.driftTiming.firstSixFullyVisibleImagesMs =
                performance.now();
            if (window.driftTiming.firstSixFullyVisibleImagesMs === null)
              requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        },
        { overall },
      );
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      const before = await cdp.send("Performance.getMetrics");
      if (process.env.SCRAPS_PROFILE === "1") {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        await cdp.send("Tracing.start", {
          categories: "devtools.timeline,blink.user_timing",
          transferMode: "ReturnAsStream",
        });
      }
      const coldLaunchToNavigationMs =
        relaunchedAt === null ? null : Date.now() - relaunchedAt;
      await page.goto(`${origin}/scraps.html`, { waitUntil: "load" });
      if (overall) {
        const windows = [];
        const measure = async (name, action, settle) => {
          const start =
            name === "initial-drift" || name === "reload-drift"
              ? 0
              : await page.evaluate(() => performance.now());
          const profileAction =
            process.env.SCRAPS_OVERALL_PROFILE_ACTION === name;
          if (profileAction) {
            await cdp.send("Profiler.enable");
            await cdp.send("Profiler.start");
            await cdp.send("Tracing.start", {
              categories:
                "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing",
              transferMode: "ReturnAsStream",
            });
          }
          await action();
          if (settle) await settle();
          else await waitVisibleImages(page);
          await page.evaluate(
            () =>
              new Promise((resolveFrame) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(resolveFrame),
                ),
              ),
          );
          const metrics = await page.evaluate((start) => {
            const end = performance.now();
            const inputs = window.driftTiming.searchInputs.filter(
              (time) => time >= start && time < end,
            );
            const imageLoads = window.driftTiming.searchImageLoads.filter(
              (event) => event.ms >= start && event.ms < end,
            );
            const tasks = window.driftTiming.longTasks.filter(
              (task) => task.start >= start && task.start < end,
            );
            const gaps = window.driftTiming.frameGaps.filter(
              (gap) => gap.end >= start && gap.end < end,
            );
            return {
              start,
              end,
              durationMs: end - start,
              lastInputToPaintMs: inputs.length
                ? end - inputs[inputs.length - 1]
                : null,
              inputDurationMs:
                inputs.length > 1 ? inputs[inputs.length - 1] - inputs[0] : 0,
              inputTimestamps: inputs,
              imageLoads,
              maxFrameGapMs: Math.max(0, ...gaps.map((gap) => gap.duration)),
              longTaskCount: tasks.length,
              longTaskDurationMs: tasks.reduce(
                (sum, task) => sum + task.duration,
                0,
              ),
              longestTaskMs: Math.max(0, ...tasks.map((task) => task.duration)),
              tasks,
              gaps: gaps.filter((gap) => gap.duration > 32),
              tileCount: document.querySelectorAll(".scrap-collage__tile")
                .length,
            };
          }, start);
          if (profileAction) {
            const { profile: cpuProfile } = await cdp.send("Profiler.stop");
            await writeFile(
              `${evidence}/${name}.cpuprofile`,
              JSON.stringify(cpuProfile),
            );
            const completed = new Promise((resolveTrace) =>
              cdp.once("Tracing.tracingComplete", resolveTrace),
            );
            await cdp.send("Tracing.end");
            const { stream } = await completed;
            let trace = "";
            while (true) {
              const chunk = await cdp.send("IO.read", { handle: stream });
              trace += chunk.data;
              if (chunk.eof) break;
            }
            await cdp.send("IO.close", { handle: stream });
            await writeFile(`${evidence}/${name}.trace.json`, trace);
          }
          if (
            name === "search-typing" &&
            process.env.SCRAPS_CAPTURE_PREVIEW_PROBE === "1"
          )
            await writeFile(
              `${evidence}/preview-probe.json`,
              JSON.stringify(
                await page.evaluate(() => window.__scrapPreviewProbe ?? null),
                null,
                2,
              ),
            );
          windows.push({ name, ...metrics });
          await writeFile(
            `${evidence}/overall-${run + 1}.json`,
            JSON.stringify({ extension, seeded, windows }, null, 2),
          );
          console.log(
            JSON.stringify({
              phase: "overall",
              name,
              durationMs: metrics.durationMs,
              maxFrameGapMs: metrics.maxFrameGapMs,
              longestTaskMs: metrics.longestTaskMs,
            }),
          );
        };
        await measure("initial-drift", async () => {});
        await page.screenshot({
          path: `${evidence}/overall-drift-${run + 1}.png`,
        });
        await measure("archive", async () =>
          page.getByRole("button", { name: "archive", exact: true }).click(),
        );
        await page.screenshot({
          path: `${evidence}/overall-archive-${run + 1}.png`,
        });
        await measure("place-filter", async () => {
          await page.getByRole("button", { name: /^from / }).click();
          await page.locator('[data-place="notebook.example"]').click();
          await page
            .getByRole("textbox", { name: "Find a domain or page" })
            .press("Escape");
        });
        await page.screenshot({
          path: `${evidence}/overall-filtered-${run + 1}.png`,
        });
        await measure("clear-place", async () => {
          await page.getByRole("button", { name: /^from / }).click();
          await page
            .getByRole("button", { name: "clear", exact: true })
            .click();
          await page
            .getByRole("textbox", { name: "Find a domain or page" })
            .press("Escape");
        });
        const search = page.getByRole("textbox", {
          name: "Search scraps",
          exact: true,
        });
        await measure(
          "search-typing",
          async () =>
            search.pressSequentially("Visual notebook page 123", { delay: 40 }),
          async () => {
            await expect(page.locator(".scrap-collage__tile")).toHaveCount(1);
            await waitVisibleImages(page, 1);
          },
        );
        await measure("clear-search", async () => search.fill(""));
        await measure(
          "kind-no-match",
          async () => {
            await page.getByRole("button", { name: /^type / }).click();
            await page.locator('[data-scrap-kind="button"]').click();
            await page.locator('[data-scrap-kind="button"]').press("Escape");
          },
          async () => {
            await expect(page.getByRole("status")).toHaveText(
              "No scraps match these filters.",
            );
          },
        );
        await measure("clear-kind", async () => {
          await page.getByRole("button", { name: /^type / }).click();
          await page.locator('[data-scrap-kind="all"]').click();
          await page.locator('[data-scrap-kind="all"]').press("Escape");
        });
        await measure("return-drift", async () =>
          page.getByRole("button", { name: "drift", exact: true }).click(),
        );
        await page.screenshot({
          path: `${evidence}/overall-finished-${run + 1}.png`,
        });
        await measure("reload-drift", async () =>
          page.reload({ waitUntil: "load" }),
        );
        await page.screenshot({
          path: `${evidence}/overall-reload-${run + 1}.png`,
        });
        const tileDimensions = await page
          .locator(".scrap-collage__image")
          .evaluateAll((images) => ({
            maxWidth: Math.max(...images.map((img) => img.naturalWidth)),
            maxHeight: Math.max(...images.map((img) => img.naturalHeight)),
          }));
        await page.locator(".scrap-collage__tile").first().click();
        const originalDimensions = await page
          .locator(".scrap-lightbox__scrap img")
          .evaluate(async (img) => {
            await img.decode();
            return { width: img.naturalWidth, height: img.naturalHeight };
          });
        assert.deepEqual(originalDimensions, { width: 1200, height: 800 });
        await page.waitForFunction(() => {
          const overlay = document.querySelector(".scrap-lightbox--visible");
          return (
            overlay &&
            Number(getComputedStyle(overlay).opacity) === 1 &&
            overlay
              .getAnimations({ subtree: true })
              .every((animation) => animation.playState === "finished")
          );
        });
        const originalPixels = await page
          .locator(".scrap-lightbox__scrap img")
          .screenshot();
        const paintedOriginalFraction = await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = new OffscreenCanvas(image.width, image.height);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
          let saturated = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
            if (max > 0 && (max - min) / max >= 0.45) saturated++;
          }
          return saturated / (image.width * image.height);
        }, originalPixels.toString("base64"));
        assert.ok(
          paintedOriginalFraction > 0.3,
          "Examine image has real fixture pixels",
        );
        await page.screenshot({
          path: `${evidence}/overall-original-${run + 1}.png`,
        });
        await page
          .getByRole("button", { name: "Close examine view", exact: true })
          .click();
        await expect(page.locator(".scrap-lightbox")).toHaveCount(0);
        const cache = await page.evaluate(async () => {
          const db = await new Promise((resolveDb, reject) => {
            const request = indexedDB.open("scrap_image_copies_db");
            request.onsuccess = () => resolveDb(request.result);
            request.onerror = () => reject(request.error);
          });
          const request = (value) =>
            new Promise((resolveValue, reject) => {
              value.onsuccess = () => resolveValue(value.result);
              value.onerror = () => reject(value.error);
            });
          const originals = await request(
            db.transaction("blobs").objectStore("blobs").getAllKeys(),
          );
          const original = await request(
            db.transaction("blobs").objectStore("blobs").get("0".repeat(64)),
          );
          const previews = db.objectStoreNames.contains("previews")
            ? await request(
                db.transaction("previews").objectStore("previews").getAll(),
              )
            : [];
          db.close();
          const digest = [
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                await original.blob.arrayBuffer(),
              ),
            ),
          ]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          return {
            originalCount: originals.length,
            originalKeys: originals,
            originalDigest: digest,
            previewCount: previews.length,
            previewBytes: previews.reduce((sum, row) => sum + row.blob.size, 0),
          };
        });
        if (cache.previewCount > 0)
          assert.ok(
            tileDimensions.maxWidth <= 640 && tileDimensions.maxHeight <= 640,
            "Gallery images use bounded previews",
          );
        assert.equal(cache.originalCount, 1000);
        assert.equal(cache.originalDigest, seeded.originalDigest);
        assert.deepEqual(
          cache.originalKeys,
          Array.from({ length: 1000 }, (_, index) =>
            index.toString(16).padStart(64, "0"),
          ),
        );
        await writeFile(
          `${evidence}/cache-${run + 1}.json`,
          JSON.stringify(
            {
              ...cache,
              originalKeys: undefined,
              originalDimensions,
              tileDimensions,
            },
            null,
            2,
          ),
        );
        const unexpected = errors.filter(
          (error) =>
            !(
              typeof error === "object" &&
              error.text ===
                "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector" &&
              /^https:\/\/(fonts\.googleapis\.com|www\.google\.com|icons\.duckduckgo\.com)\//.test(
                error.url,
              )
            ),
        );
        await measure("responsive-mobile", async () =>
          page.setViewportSize({ width: 390, height: 844 }),
        );
        await page.screenshot({
          path: `${evidence}/overall-mobile-${run + 1}.png`,
        });
        assert.deepEqual(unexpected, []);
        assert.deepEqual(
          await page.evaluate(() => window.driftTiming.scrapImageErrors),
          [],
        );
        results.push({
          run: run + 1,
          windows,
          cache: { ...cache, originalKeys: undefined },
          originalDimensions,
          tileDimensions,
          errors: [],
        });
        await page.close();
        continue;
      }
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
        () => window.driftTiming.firstSixFullyVisibleImagesMs !== null,
      );
      if (process.env.SCRAPS_PROFILE === "1") {
        const { profile: cpuProfile } = await cdp.send("Profiler.stop");
        await writeFile(
          `${evidence}/critical-${run + 1}.cpuprofile`,
          JSON.stringify(cpuProfile),
        );
        const completed = new Promise((resolveTrace) =>
          cdp.once("Tracing.tracingComplete", resolveTrace),
        );
        await cdp.send("Tracing.end");
        const { stream } = await completed;
        let trace = "";
        while (true) {
          const chunk = await cdp.send("IO.read", { handle: stream });
          trace += chunk.data;
          if (chunk.eof) break;
        }
        await cdp.send("IO.close", { handle: stream });
        await writeFile(`${evidence}/critical-${run + 1}.trace.json`, trace);
      }
      const revealStyles = await page
        .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
        .first()
        .evaluate((img) => {
          const style = getComputedStyle(img);
          const probe = document.createElement("div");
          probe.className = "scrap-collage__tile--washing-in";
          document.body.append(probe);
          const washInDuration = getComputedStyle(probe).animationDuration;
          probe.remove();
          return {
            imageTransition: style.transitionDuration,
            imageFilter: style.filter,
            washInDuration,
            initialWashingTiles: document.querySelectorAll(
              ".scrap-collage__tile--washing-in",
            ).length,
          };
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
      await writeFile(
        `${evidence}/decode-timing-${run + 1}.json`,
        JSON.stringify(timing, null, 2),
      );
      if (timing.decodeErrors.length)
        await page.screenshot({ path: `${evidence}/decode-errors.png` });
      assert.deepEqual(
        timing.decodeErrors,
        [],
        "Visible image decoding succeeds",
      );
      if (process.env.SCRAPS_FIRST_IMAGES_BUDGET_MS)
        assert.ok(
          timing.firstSixFullyVisibleImagesMs <=
            Number(process.env.SCRAPS_FIRST_IMAGES_BUDGET_MS),
          `Six fully visible images took ${timing.firstSixFullyVisibleImagesMs}ms`,
        );
      if (process.env.SCRAPS_EARLY_SCREENSHOT === "1") {
        const captureStartedMs = await page.evaluate(() => performance.now());
        await page.screenshot({
          path: `${evidence}/first-images-${run + 1}.png`,
        });
        await writeFile(
          `${evidence}/first-images-${run + 1}.json`,
          JSON.stringify(
            {
              firstImageDecodedMs: timing.firstImageDecodedMs,
              decodeRetries: timing.decodeRetries,
              firstSixFullyVisibleImagesMs: timing.firstSixFullyVisibleImagesMs,
              detachedDecodeCancellations: timing.detachedDecodeCancellations,
              captureStartedMs,
            },
            null,
            2,
          ),
        );
      }
      await page.getByRole("button", { name: "archive", exact: true }).click();
      await expect(
        page.locator(".scrap-collage__archive-summary"),
      ).toContainText("1000 of 1000", { timeout: 30000 });
      const fullArchiveReadyMs = await page.evaluate(() => performance.now());
      const archiveInventory = await page.evaluate(() => ({
        tileCount: document.querySelectorAll(".scrap-collage__tile").length,
        imageCount: document.querySelectorAll(".scrap-collage__image").length,
        errors: window.driftTiming.scrapImageErrors,
      }));
      await writeFile(
        `${evidence}/archive-inventory-${run + 1}.json`,
        JSON.stringify(archiveInventory, null, 2),
      );
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
      const currentImageErrors = await page.evaluate(
        () => window.driftTiming.scrapImageErrors,
      );
      await writeFile(
        `${evidence}/image-errors-${run + 1}.json`,
        JSON.stringify(currentImageErrors, null, 2),
      );
      assert.deepEqual(
        currentImageErrors,
        [],
        "All scrap image resources load successfully",
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
        firstImageDecodedMs: timing.firstImageDecodedMs,
        decodeRetries: timing.decodeRetries,
        detachedDecodeCancellations: timing.detachedDecodeCancellations,
        coldLaunchToNavigationMs,
        firstSixFullyVisibleImagesMs: timing.firstSixFullyVisibleImagesMs,
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
      await writeFile(
        `${evidence}/completed-runs.json`,
        JSON.stringify(results, null, 2),
      );
      await page.close();
    }
    const median = (key) =>
      [...results].sort((a, b) => a[key] - b[key])[
        Math.floor(results.length / 2)
      ][key];
    const medians = Object.fromEntries(
      [
        "firstVisibleImageMs",
        "firstImageDecodedMs",
        "firstFullyRevealedImageMs",
        "firstSixFullyVisibleImagesMs",
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
      overall,
      extension,
      motion,
      coldBrowser: process.env.SCRAPS_COLD_BROWSER === "1",
      decodeGating:
        "HTMLImageElement.decode resolved, then opacity and zero blur on two consecutive animation frames",
      seeded,
      results,
      medians,
      queryTimings,
      evidence,
      note: overall
        ? "Pixel readiness includes screenshot validation overhead, bounded metadata polling at 50ms and pixel sampling at 100ms. Frame gaps are measured continuously. First visit begins with original copies only; reload uses naturally derived previews."
        : "Full archive readiness includes switching from Drift to Archive after visible images load.",
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
