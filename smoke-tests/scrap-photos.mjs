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
      request.url.includes("slow") && !request.url.includes("layout")
        ? 700
        : 20,
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
              domain:
                prefix === "layout" && i % 2 ? "notebook.example" : "127.0.0.1",
              meta: {
                url:
                  prefix === "layout" && i % 2
                    ? `https://notebook.example/studies/${i}`
                    : `${origin}/${prefix}-${i}`,
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
      scraps.locator(".scrap-collage__tile img").evaluateAll(
        (images) =>
          images.length === 8 &&
          images.every((image) => {
            const bounds = image.getBoundingClientRect();
            return (
              bounds.bottom <= 0 ||
              bounds.top >= innerHeight ||
              (image.complete && image.naturalWidth > 0)
            );
          }),
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
  await reopened.getByRole("button", { name: /^Found on/ }).click();
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .fill(`${origin}/first`);
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .press("Enter");
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .press("Escape");
  await expect(reopened.locator(".scrap-collage__tile")).toHaveCount(1);
  await reopened.locator(".scrap-collage__tile").click();
  await expect(reopened.locator(".scrap-lightbox__timeline li")).toHaveCount(4);
  await reopened
    .getByRole("button", { name: "Close examine view", exact: true })
    .click();
  await expect(reopened.getByRole("dialog")).toHaveCount(0);
  await reopened.getByRole("button", { name: /^Found on/ }).click();
  await reopened.getByRole("button", { name: "Clear", exact: true }).click();
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .press("Escape");
  await seedUnchecked(420, "layout");
  await reopened.reload();
  await expect(reopened.getByLabel("Number of scraps shown")).toHaveCount(0);
  await expect(
    reopened.getByRole("button", { name: "cycle", exact: true }),
  ).toHaveCount(0);
  const layoutControl = reopened.getByRole("group", {
    name: "Scrap layout",
    exact: true,
  });
  const keys = () =>
    reopened
      .locator(".scrap-collage__tile:not(.scrap-collage__tile--washing-out)")
      .evaluateAll((tiles) => tiles.map((tile) => tile.dataset.scrapKey));
  const beforeShuffle = new Set(await keys());
  await reopened.getByRole("button", { name: "shuffle", exact: true }).click();
  await expect
    .poll(async () => (await keys()).some((key) => !beforeShuffle.has(key)))
    .toBe(true);
  await layoutControl
    .getByRole("button", { name: "grid", exact: true })
    .click();
  await expect
    .poll(() =>
      reopened
        .locator(".scrap-collage__tile")
        .evaluateAll((tiles) =>
          tiles.every(
            (tile) =>
              tile.style.getPropertyValue("--scrap-rotation") === "0deg",
          ),
        ),
    )
    .toBe(true);
  const reducedKeys = await keys();
  await reopened.waitForTimeout(7500);
  assert.deepEqual(
    await keys(),
    reducedKeys,
    "reduced motion holds Drift still",
  );
  await reopened.emulateMedia({ reducedMotion: "no-preference" });
  await reopened.waitForTimeout(7500);
  assert.deepEqual(
    await keys(),
    reducedKeys,
    "focused controls hold Drift still",
  );
  await reopened.locator("body").click({ position: { x: 1, y: 1 } });
  await reopened.mouse.move(0, 0);
  await expect
    .poll(async () => JSON.stringify(await keys()), { timeout: 15000 })
    .not.toBe(JSON.stringify(reducedKeys));
  const firstTile = reopened
    .locator(".scrap-collage__tile:not(.scrap-collage__tile--washing-out)")
    .first();
  await firstTile.hover();
  const hoveredKeys = await keys();
  await reopened.waitForTimeout(7500);
  assert.deepEqual(await keys(), hoveredKeys, "hover holds Drift still");
  await firstTile.focus();
  await reopened.mouse.move(0, 0);
  const focusedKeys = await keys();
  await reopened.waitForTimeout(7500);
  assert.deepEqual(
    await keys(),
    focusedKeys,
    "keyboard focus holds Drift still",
  );
  await firstTile.press("Enter");
  await expect(reopened.getByRole("dialog")).toBeVisible();
  const examinedKeys = await keys();
  await reopened.waitForTimeout(7500);
  assert.deepEqual(await keys(), examinedKeys, "examining holds Drift still");
  await reopened
    .getByRole("button", { name: "Close examine view", exact: true })
    .click();
  await reopened.emulateMedia({ reducedMotion: "reduce" });
  await expect(reopened.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      () =>
        reopened
          .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
          .evaluateAll((images) =>
            images.every((image) => {
              const bounds = image.getBoundingClientRect();
              return (
                bounds.bottom <= 0 ||
                bounds.top >= innerHeight ||
                (image.complete && image.naturalWidth > 0)
              );
            }),
          ),
      { timeout: 20000 },
    )
    .toBe(true);
  await reopened.screenshot({ path: resolve(evidence, "drift-grid.png") });
  await layoutControl
    .getByRole("button", { name: "pile", exact: true })
    .click();
  await reopened.screenshot({ path: resolve(evidence, "drift-pile.png") });
  await reopened.getByRole("button", { name: "archive", exact: true }).click();
  await expect(
    reopened.getByRole("button", { name: "shuffle", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(
      () =>
        reopened
          .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
          .evaluateAll((images) =>
            images.every((image) => {
              const bounds = image.getBoundingClientRect();
              return (
                bounds.bottom <= 0 ||
                bounds.top >= innerHeight ||
                (image.complete && image.naturalWidth > 0)
              );
            }),
          ),
      { timeout: 20000 },
    )
    .toBe(true);
  await reopened.screenshot({ path: resolve(evidence, "archive-pile.png") });
  const scroll = reopened.locator(".scrap-collage__scroll");
  await scroll.evaluate((el) => {
    el.scrollTop = 900;
  });
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(900);
  const nearby = new Set(await keys());
  await layoutControl
    .getByRole("button", { name: "grid", exact: true })
    .click();
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await keys()).some((key) => nearby.has(key)))
    .toBe(true);
  await expect
    .poll(
      () =>
        reopened
          .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
          .evaluateAll((images) =>
            images.every((image) => {
              const bounds = image.getBoundingClientRect();
              return (
                bounds.bottom <= 0 ||
                bounds.top >= innerHeight ||
                (image.complete && image.naturalWidth > 0)
              );
            }),
          ),
      { timeout: 20000 },
    )
    .toBe(true);
  await reopened.screenshot({ path: resolve(evidence, "archive-grid.png") });
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() =>
      scroll.evaluate(
        (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      ),
    )
    .toBe(true);
  await reopened.reload();
  await expect(
    layoutControl.getByRole("button", { name: "grid", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await reopened.setViewportSize({ width: 390, height: 844 });
  await reopened.getByRole("button", { name: "archive", exact: true }).click();
  await expect
    .poll(() => reopened.locator(".scrap-collage__tile").count())
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        reopened
          .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every((image) => {
                const bounds = image.getBoundingClientRect();
                return (
                  bounds.bottom <= 0 ||
                  bounds.top >= innerHeight ||
                  (image.complete && image.naturalWidth > 0)
                );
              }),
          ),
      { timeout: 20000 },
    )
    .toBe(true);
  await reopened.screenshot({
    path: resolve(evidence, "archive-grid-mobile.png"),
  });
  await reopened.setViewportSize({ width: 1200, height: 850 });
  const waitForFilterImages = () =>
    expect
      .poll(
        () =>
          reopened
            .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
            .evaluateAll(
              (images) =>
                images.length > 0 &&
                images.every((image) => {
                  const bounds = image.getBoundingClientRect();
                  return (
                    bounds.bottom <= 0 ||
                    bounds.top >= innerHeight ||
                    (image.complete && image.naturalWidth > 0)
                  );
                }),
            ),
        { timeout: 20000 },
      )
      .toBe(true);
  const foundOn = reopened.getByRole("button", { name: /^Found on/ });
  await foundOn.click();
  await reopened
    .locator(".scrap-filters__domain")
    .filter({ hasText: "notebook.example" })
    .click();
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .press("Escape");
  await expect(foundOn).toContainText("notebook.example");
  await expect(
    reopened.locator(".scrap-collage__archive-summary"),
  ).toContainText("210 of 430");
  await foundOn.click();
  await reopened
    .locator(".scrap-filters__domain")
    .filter({ hasText: "127.0.0.1" })
    .click();
  await expect(foundOn).toContainText("127.0.0.1");
  await expect(foundOn).toContainText("notebook.example");
  await waitForFilterImages();
  await reopened.screenshot({ path: resolve(evidence, "filter-places.png") });
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .press("Escape");
  await reopened.getByRole("button", { name: /^Type/ }).click();
  await reopened.locator('[data-scrap-kind="button"]').click();
  await expect(reopened.getByRole("status")).toHaveText(
    "No scraps match these filters.",
  );
  await reopened.locator('[data-scrap-kind="image"]').click();
  await waitForFilterImages();
  await reopened.screenshot({ path: resolve(evidence, "filter-types.png") });
  await reopened.locator('[data-scrap-kind="image"]').press("Escape");
  await reopened
    .getByRole("button", { name: "Search scraps", exact: true })
    .click();
  await reopened
    .getByRole("textbox", { name: "Search scraps", exact: true })
    .fill("notebook.example page 112");
  await expect(reopened.locator(".scrap-collage__tile")).toHaveCount(1);
  await expect
    .poll(() =>
      reopened
        .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await reopened.screenshot({ path: resolve(evidence, "filter-search.png") });
  for (const layout of ["pile", "grid"]) {
    await layoutControl
      .getByRole("button", { name: layout, exact: true })
      .click();
    for (const mode of ["drift", "archive"]) {
      await reopened.getByRole("button", { name: mode, exact: true }).click();
      await expect(
        reopened.locator(
          ".scrap-collage__tile:not(.scrap-collage__tile--washing-out)",
        ),
      ).toHaveCount(1);
    }
  }
  await reopened.setViewportSize({ width: 390, height: 844 });
  await foundOn.click();
  await reopened.screenshot({ path: resolve(evidence, "filter-mobile.png") });
  const overflow = await reopened
    .locator('[aria-label="Scrap controls"]')
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  assert.equal(overflow, false, "mobile controls fit their panel");
  await reopened
    .getByRole("textbox", { name: "Find a domain or page" })
    .press("Escape");
  await reopened
    .getByRole("button", { name: "Clear and close search" })
    .click();
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      records: 434,
      layouts: ["drift-pile", "drift-grid", "archive-pile", "archive-grid"],
      peakDownloads: peak,
      evidence,
    }),
  );
} catch (error) {
  const activePage = context?.pages().at(-1);
  if (activePage)
    console.error(
      await activePage
        .locator(".scrap-collage__tile img:not(.scrap-collage__favicon)")
        .evaluateAll((images) =>
          images
            .filter((image) => !image.complete || image.naturalWidth === 0)
            .slice(0, 8)
            .map((image) => ({
              src: image.src,
              complete: image.complete,
              top: image.getBoundingClientRect().top,
            })),
        ),
    );
  throw error;
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}
