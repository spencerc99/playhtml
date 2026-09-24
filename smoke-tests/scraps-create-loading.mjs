// ABOUTME: Verifies scraps browsing and Create loading in the built Chrome extension.
// ABOUTME: Seeds real local scrap events, checks resource timing, and records browser metrics.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const extension = resolve(process.env.SCRAPS_EXTENSION_DIR || "extension/dist/chrome-mv3");
const evidence = resolve(process.env.SCRAPS_EVIDENCE_DIR || "/private/tmp/scraps-create-loading");
const runs = Number(process.env.SCRAPS_RUNS || 3);
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "scraps-create-loading-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });
  await context.route("**/*", (route) =>
    route.request().url().startsWith("chrome-extension:")
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      wwoFeatureAccess: {
        features: {
          SCRAPS: { stage: "beta", available: true },
          SCRAP_COLLAGES: { stage: "internal", available: true },
        },
        checkedAt: Date.now(),
      },
      wwoFeatureOverrides: { SCRAPS: true, SCRAP_COLLAGES: true },
    });
    const db = await new Promise((resolveDb, reject) => {
      const request = indexedDB.open("collection_events_db");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((done, reject) => {
        const tx = db.transaction("events", "readwrite");
        const events = tx.objectStore("events");
        for (let index = 0; index < 1000; index += 1) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#${(index + 0x987654).toString(16)}"/></svg>`;
          events.put({
            id: `lazy-scrap-${index}`,
            type: "element",
            ts: Date.now() + index,
            domain: "example.test",
            meta: {
              url: `https://example.test/page/${index}`,
              pid: "fixture",
              sid: "fixture",
              vw: 1440,
              vh: 900,
              tz: "UTC",
            },
            data: {
              kind: "image",
              src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
              naturalWidth: 80,
              naturalHeight: 60,
              pageTitle: `Scrap page ${index}`,
            },
          });
        }
        tx.oncomplete = done;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

  const results = [];
  for (let index = 0; index < runs; index += 1) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const initialMetrics = await cdp.send("Performance.getMetrics");
    const started = Date.now();
    await page.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
    await page.getByRole("button", { name: "create", exact: true }).waitFor();
    await page.locator(".scraps-stage").waitFor();
    const loadMs = Date.now() - started;
    await page.waitForTimeout(150);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const browseMetrics = await cdp.send("Performance.getMetrics");
    const browseHeap = await cdp.send("Runtime.getHeapUsage");
    const browseResources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    const createRequestsBefore = requests.filter((url) => /CreateMode-|html2canvas/.test(url));
    const createResourcesBefore = browseResources.filter((url) => /CreateMode-|html2canvas/.test(url));
    const scrapCount = await page.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "GET_SCRAPS" });
      return response.scraps.length;
    });
    assert.equal(scrapCount, 1000);
    if (process.env.SCRAPS_EXPECT_LAZY === "1") {
      assert.deepEqual(createRequestsBefore, []);
      assert.deepEqual(createResourcesBefore, []);
    }
    if (index === 0) await page.screenshot({ path: `${evidence}/browse.png` });
    await page.getByRole("button", { name: "create", exact: true }).click();
    await page.getByRole("heading", { name: "your collages" }).waitFor();
    await page.getByText("opening the drawer...").waitFor({ state: "hidden" });
    const createRequestsAfter = requests.filter((url) => /CreateMode-|html2canvas/.test(url));
    if (process.env.SCRAPS_EXPECT_LAZY === "1") {
      assert.ok(createRequestsAfter.some((url) => /CreateMode-/.test(url)));
    }
    if (index === 0) await page.screenshot({ path: `${evidence}/create.png` });
    await page.getByRole("button", { name: "start a new one" }).click();
    await page.locator(".collage-studio").waitFor();
    if (index === 0) await page.screenshot({ path: `${evidence}/studio.png` });
    await page.getByRole("button", { name: "browse", exact: true }).click();
    await page.locator(".scraps-stage").waitFor();
    await page.getByRole("button", { name: "create", exact: true }).click();
    await page.locator(".collage-studio").waitFor();
    assert.deepEqual(errors, []);
    const metric = (name) => {
      const initial = initialMetrics.metrics.find((item) => item.name === name)?.value;
      const final = browseMetrics.metrics.find((item) => item.name === name)?.value;
      return initial === undefined || final === undefined ? null : (final - initial) * 1000;
    };
    results.push({
      run: index + 1,
      loadMs,
      taskDurationMs: metric("TaskDuration"),
      scriptDurationMs: metric("ScriptDuration"),
      retainedHeapMb: browseHeap.usedSize / 1048576,
      createRequestsBefore,
      createResourcesBefore,
      createRequestsAfter,
      resourceCountBefore: browseResources.length,
    });
    await page.close();
  }
  if (process.env.SCRAPS_EXPECT_LAZY === "1") {
    const failurePage = await context.newPage();
    const failureLogs = [];
    failurePage.on("console", (message) => {
      if (message.type() === "error") failureLogs.push(message.text());
    });
    await failurePage.route("**/chunks/CreateMode-*.js", (route) => route.abort());
    await failurePage.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
    await failurePage.getByRole("button", { name: "create", exact: true }).click();
    await failurePage.getByText("collage tools could not be opened").waitFor();
    assert.ok(
      failureLogs.some((message) => message.startsWith("Failed to load collage create mode:")),
    );
    await failurePage.close();
  }
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      wwoFeatureOverrides: { SCRAPS: true, SCRAP_COLLAGES: false },
    });
  });
  const gatedPage = await context.newPage();
  const gatedRequests = [];
  gatedPage.on("request", (request) => gatedRequests.push(request.url()));
  await gatedPage.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  await gatedPage.locator(".scraps-stage").waitFor();
  assert.equal(await gatedPage.getByRole("button", { name: "create", exact: true }).count(), 0);
  assert.equal(gatedRequests.some((url) => /CreateMode-/.test(url)), false);
  await gatedPage.close();
  await writeFile(`${evidence}/results.json`, JSON.stringify({ extension, results }, null, 2));
  console.log(JSON.stringify({ extension, results }, null, 2));
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
