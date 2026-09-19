// ABOUTME: Verifies image collection, exact matching, and source provenance in isolated Chromium.
// ABOUTME: Exercises the built extension with real local pages, downloads, IndexedDB, and restart.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = process.env.SCRAP_EVIDENCE_DIR || "/tmp/scrap-photo-evidence";
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "wwo-scrap-photos-"));
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#f0c77c"/><circle cx="300" cy="200" r="100" fill="#b76841"/><path d="M220 190L300 130L380 190L300 250Z" fill="#ffeed1"/></svg>';
let changingColor = "#a182cb";
const downloads = [];
let active = 0;
let peak = 0;
const server = createServer((request, response) => {
  if (request.url.startsWith("/photo/")) {
    const isFingerprint = request.headers["sec-fetch-dest"] === "empty";
    if (isFingerprint) {
      downloads.push({
        url: request.url,
        cookie: request.headers.cookie,
        referer: request.headers.referer,
      });
      active++;
      peak = Math.max(peak, active);
      response.on("close", () => active--);
    }
    response.setHeader("content-type", "image/svg+xml");
    const body = request.url.includes("changing")
      ? image.replace("#f0c77c", changingColor)
      : request.url.includes("different")
        ? image.replace("#f0c77c", "#aecfd3")
        : image;
    setTimeout(
      () => response.end(body),
      request.url.includes("slow") ? 700 : 20,
    );
    return;
  }
  if (request.url === "/favicon.ico") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("content-type", "text/html");
  response.setHeader("set-cookie", "photoTest=private; Path=/");
  const slug = request.url.slice(1) || "first";
  const src =
    slug === "first" || slug === "third"
      ? "a"
      : slug === "second"
        ? "b"
        : "different";
  const title =
    {
      first: "Ceramics journal",
      second: "Objects worth keeping",
      third: "Studio references",
    }[slug] || "Color studies";
  response.end(
    `<!doctype html><title>${title}</title><style>body{margin:50px;background:#faf9f6;font:20px sans-serif}img{width:300px;height:200px}</style><h1>${title}</h1><img alt="Collected artwork" src="/photo/${src}.svg">`,
  );
});
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let worker;
let extensionOrigin;
const pageErrors = [];
async function launch() {
  const extension = resolve(workspace, "extension/dist/chrome-mv3");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    reducedMotion: "reduce",
    viewport: { width: 1200, height: 850 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol === "chrome-extension:" || url.hostname === "127.0.0.1"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  context.on("page", (page) =>
    page.on("pageerror", (error) => pageErrors.push(error.message)),
  );
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
}
async function records() {
  return worker.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const r = indexedDB.open("collection_events_db");
      r.onsuccess = () => resolveDb(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolveRows, reject) => {
        const r = db
          .transaction("events")
          .objectStore("events")
          .index("type")
          .getAll("element");
        r.onsuccess = () =>
          resolveRows(r.result.filter((event) => event.data.kind === "image"));
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function seedUnchecked(count, prefix) {
  await worker.evaluate(
    async ({ count, prefix, origin }) => {
      const db = await new Promise((resolveDb) => {
        const r = indexedDB.open("collection_events_db");
        r.onsuccess = () => resolveDb(r.result);
      });
      try {
        await new Promise((done, reject) => {
          const tx = db.transaction("events", "readwrite");
          for (let i = 0; i < count; i++)
            tx.objectStore("events").put({
              id: `${prefix}-${i}`,
              type: "element",
              ts: Date.now() + i,
              domain: "127.0.0.1",
              meta: {
                url: `${origin}/${prefix}-${i}`,
                pid: "fixture",
                sid: "fixture",
                vw: 1200,
                vh: 850,
                tz: "UTC",
              },
              data: {
                kind: "image",
                src: `${origin}/photo/slow-${prefix}-${i}.svg`,
                naturalWidth: 600,
                naturalHeight: 400,
                pageTitle: `Visual notebook · page ${i + 1}`,
              },
            });
          tx.oncomplete = done;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { count, prefix, origin },
  );
}
try {
  await launch();
  // The isolated tester has early access; the user still opts in through Settings.
  await worker.evaluate(async () =>
    chrome.storage.local.set({
      wwoFeatureAccess: {
        features: { SCRAPS: { stage: "beta", available: true } },
        checkedAt: Date.now(),
      },
      collection_mode_cursor: "off",
      collection_mode_navigation: "off",
      collection_mode_viewport: "off",
      collection_mode_keyboard: "off",
    }),
  );
  const settings = await context.newPage();
  await settings.goto(`${extensionOrigin}/options.html`);
  await settings
    .getByRole("checkbox", { name: "Enable Internet scraps" })
    .click();
  await expect(
    settings.getByRole("checkbox", { name: "Enable Internet scraps" }),
  ).toBeChecked();
  const page = await context.newPage();
  for (const [index, slug] of [
    "first",
    "second",
    "third",
    "different",
  ].entries()) {
    await page.goto(`${origin}/${slug}`);
    await expect
      .poll(
        async () =>
          (await records()).filter((event) => event.data.contentHash).length,
        { timeout: 20000 },
      )
      .toBe(index + 1);
  }
  await page.reload();
  await page.waitForTimeout(2500);
  assert.equal((await records()).length, 4, "repeat visits do not add records");
  const original = (await records()).find(
    (event) => event.meta.url === `${origin}/first`,
  );
  assert.ok(original);
  const earlier = {
    ...original,
    id: "earlier-first",
    ts: original.ts - 86400000,
  };
  const storeResponse = await settings.evaluate(
    (events) => chrome.runtime.sendMessage({ type: "STORE_EVENTS", events }),
    [earlier],
  );
  assert.equal(storeResponse.success, true);
  await settings.evaluate(
    (events) => chrome.runtime.sendMessage({ type: "STORE_EVENTS", events }),
    [{ ...earlier, id: "earlier-repeat" }],
  );
  assert.equal(
    (await records()).length,
    5,
    "another day is retained while same-day repeats are suppressed",
  );
  const scraps = await context.newPage();
  await scraps.goto(`${extensionOrigin}/scraps.html`);
  await scraps.getByRole("button", { name: "archive", exact: true }).click();
  await expect(scraps.locator(".scrap-collage__tile")).toHaveCount(2);
  await scraps
    .locator(".scrap-collage__tile")
    .filter({ has: scraps.locator('img[src*="different"]') })
    .click();
  await expect(scraps.locator(".scrap-lightbox__timeline li")).toHaveCount(1);
  await expect(scraps.locator(".scrap-lightbox")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      scraps
        .locator(".scrap-lightbox__scrap img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await expect(scraps.locator(".scrap-lightbox__timeline")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(scraps.locator(".scrap-lightbox__timeline li")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(scraps.locator(".scrap-lightbox__actions")).toHaveCSS(
    "border-top-width",
    "1px",
  );
  await scraps.screenshot({
    path: resolve(evidence, "single-encounter-divider.png"),
  });
  await scraps
    .getByRole("button", { name: "Close examine view", exact: true })
    .click();
  await scraps
    .locator(".scrap-collage__tile")
    .filter({ has: scraps.locator('img[src$="/photo/a.svg"]') })
    .click();
  await expect(
    scraps.getByRole("region", { name: "Places this photo was found" }),
  ).toBeVisible();
  await expect(
    scraps.getByText("Encounter history", { exact: true }),
  ).toBeVisible();
  await expect(scraps.locator(".scrap-lightbox__timeline li")).toHaveCount(4);
  await expect(scraps.locator(".scrap-lightbox__timeline h4")).toHaveCount(2);
  await expect(
    scraps.locator(".scrap-lightbox__timeline section").first().locator("li"),
  ).toHaveCount(3);
  await expect(
    scraps.locator(".scrap-lightbox__timeline section").last().locator("li"),
  ).toHaveCount(1);
  await expect(
    scraps.locator(".scrap-lightbox__timeline a").first(),
  ).toHaveAttribute("title", `${origin}/third`);
  await scraps.locator(".scrap-lightbox__timeline a").first().focus();
  await expect(
    scraps.locator(".scrap-lightbox__encounter-url").first(),
  ).toBeVisible();
  const moments = await scraps
    .locator(".scrap-lightbox__timeline time")
    .evaluateAll((nodes) =>
      nodes.map((node) => Date.parse(node.getAttribute("datetime"))),
    );
  assert.deepEqual(
    moments,
    [...moments].sort((a, b) => b - a),
  );
  const timeline = scraps.getByRole("region", {
    name: "Scrollable encounter history",
  });
  await expect(timeline).toHaveCSS("overflow-y", "auto");
  await timeline.focus();
  await expect(timeline).toBeFocused();
  await expect(scraps.locator(".scrap-lightbox")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      scraps
        .locator(".scrap-lightbox__scrap img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  for (const slug of ["first", "second", "third"]) {
    await expect(
      scraps.locator(`.scrap-lightbox__places a[href="${origin}/${slug}"]`),
    ).toHaveCount(slug === "first" ? 2 : 1);
  }
  await scraps.screenshot({ path: resolve(evidence, "photo-places.png") });
  await scraps.setViewportSize({ width: 390, height: 844 });
  await scraps.screenshot({
    path: resolve(evidence, "photo-places-mobile.png"),
  });
  await scraps.setViewportSize({ width: 1200, height: 850 });
  await scraps
    .getByRole("button", { name: "Close examine view", exact: true })
    .click();
  await seedUnchecked(6, "archived");
  const beforeArchive = downloads.length;
  await scraps.reload();
  await expect(
    scraps.getByText("check for matching photos", { exact: true }),
  ).toHaveCount(0);
  await scraps.getByRole("button", { name: "archive", exact: true }).click();
  await expect(scraps.locator(".scrap-collage__tile")).toHaveCount(8);
  await expect
    .poll(() =>
      scraps
        .locator(".scrap-collage__tile img")
        .evaluateAll(
          (images) =>
            images.length === 8 &&
            images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await scraps.screenshot({
    path: resolve(evidence, "archive-no-photo-check.png"),
  });
  await context.close();
  await launch();
  const reopened = await context.newPage();
  await reopened.goto(`${extensionOrigin}/scraps.html`);
  await reopened.getByRole("button", { name: "archive", exact: true }).click();
  await expect(reopened.locator(".scrap-collage__tile")).toHaveCount(8);
  await reopened.waitForTimeout(1200);
  assert.equal(
    downloads.length,
    beforeArchive,
    "opening or restarting the archive does not fingerprint saved photos",
  );
  assert.equal(
    (await records()).filter((event) => event.data.contentHash).length,
    5,
  );
  assert.equal(
    (await records()).filter(
      (event) => event.id.startsWith("archived-") && !event.data.contentHash,
    ).length,
    6,
  );
  const changingEvent = (id) => ({
    ...original,
    id,
    ts: Date.now(),
    meta: { ...original.meta, url: `${origin}/${id}` },
    data: {
      ...original.data,
      contentHash: undefined,
      src: `${origin}/photo/slow-changing.svg`,
    },
  });
  const beforeChanging = downloads.filter((request) =>
    request.url.includes("changing"),
  ).length;
  await reopened.evaluate(
    (events) => chrome.runtime.sendMessage({ type: "STORE_EVENTS", events }),
    [changingEvent("changing-a"), changingEvent("changing-b")],
  );
  await expect
    .poll(
      async () =>
        (await records()).filter(
          (event) => event.id.startsWith("changing-") && event.data.contentHash,
        ).length,
    )
    .toBe(2);
  assert.equal(
    downloads.filter((request) => request.url.includes("changing")).length,
    beforeChanging + 1,
  );
  changingColor = "#85b593";
  await reopened.evaluate(
    (events) => chrome.runtime.sendMessage({ type: "STORE_EVENTS", events }),
    [changingEvent("changing-c")],
  );
  await expect
    .poll(
      async () =>
        (await records()).filter(
          (event) => event.id.startsWith("changing-") && event.data.contentHash,
        ).length,
    )
    .toBe(3);
  const changingRecords = (await records()).filter((event) =>
    event.id.startsWith("changing-"),
  );
  assert.equal(
    changingRecords[0].data.contentHash,
    changingRecords[1].data.contentHash,
  );
  assert.notEqual(
    changingRecords[0].data.contentHash,
    changingRecords[2].data.contentHash,
  );
  assert.equal(
    downloads.filter((request) => request.url.includes("changing")).length,
    beforeChanging + 2,
  );
  await reopened.reload();
  await reopened.getByRole("button", { name: "archive", exact: true }).click();
  await expect(reopened.locator(".scrap-collage__tile")).toHaveCount(10);
  assert.ok(downloads.every((request) => !request.cookie && !request.referer));
  assert.ok(peak <= 2);
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      records: 14,
      visiblePhotos: 10,
      peakDownloads: peak,
      evidence,
    }),
  );
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}
