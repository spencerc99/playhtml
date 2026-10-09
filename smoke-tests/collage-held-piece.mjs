// ABOUTME: Verifies in the built collage studio that a held buried piece keeps the press and undo never reaches the search.
// ABOUTME: Seeds local scraps, places two overlapping pieces, and drives clicks, drags, shift presses and cmd+Z.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const extension = resolve(process.env.SCRAPS_EXTENSION_DIR || "extension/dist/chrome-mv3");
const evidence = resolve(process.env.COLLAGE_EVIDENCE_DIR || resolve(tmpdir(), "collage-held-piece-evidence"));
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "collage-held-piece-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    // Local runs can point at another build with PLAYWRIGHT_CHROMIUM_PATH.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : { channel: "chromium" }),
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
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  await page.getByRole("button", { name: "create", exact: true }).waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const request = indexedDB.open("collection_events_db");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((done, reject) => {
        const tx = db.transaction("events", "readwrite");
        const colors = ["c8553d", "2d7d6f", "3d5a98", "e0b043"];
        colors.forEach((color, index) => {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#${color}"/></svg>`;
          tx.objectStore("events").put({
            id: `held-scrap-${index}`,
            type: "element",
            ts: Date.now() + index,
            domain: "example.test",
            meta: { url: `https://example.test/page/${index}`, pid: "fixture", sid: "fixture", vw: 1440, vh: 900, tz: "UTC" },
            data: {
              kind: "image",
              src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
              naturalWidth: 160,
              naturalHeight: 120,
              pageTitle: `Swatch ${index}`,
            },
          });
        });
        tx.oncomplete = done;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "create", exact: true }).click();
  await page.getByRole("button", { name: "new collage", exact: true }).click();
  await page.locator(".collage-studio").waitFor();
  await page.waitForTimeout(900);

  const pieces = page.locator(".collage-piece");
  const search = page.locator(".collage-tray").getByRole("textbox", { name: "Search scraps" });
  const focused = () =>
    page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  const held = () =>
    pieces.evaluateAll((els) =>
      els.flatMap((el, index) => (el.classList.contains("collage-piece--selected") ? [index] : [])),
    );
  const boxOf = async (index) => {
    const box = await pieces.nth(index).boundingBox();
    return { x: Math.round(box.x), y: Math.round(box.y) };
  };

  // Undo after placing from the drawer. Safari and Firefox on macOS do not
  // focus a clicked button, so a click there leaves focus in the search; a
  // script click reproduces that here.
  await search.click();
  await search.pressSequentially("Swatch");
  await page.waitForTimeout(300);
  await page.locator(".collage-tray__slot").nth(0).evaluate((el) => el.click());
  await page.waitForTimeout(200);
  assert.equal(await pieces.count(), 1, "the clicked scrap is placed");
  assert.notEqual(await focused(), "Search scraps", "placing a scrap puts the search down");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  assert.equal(await search.inputValue(), "Swatch", "undo leaves the search text alone");
  assert.equal(await pieces.count(), 0, "undo takes back the placed scrap");
  await page.screenshot({ path: `${evidence}/1-undo-after-place.png` });
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.waitForTimeout(200);

  // A second piece fans out over the first, so the two overlap.
  await page.locator(".collage-tray__slot").nth(1).click();
  await page.waitForTimeout(300);
  assert.equal(await pieces.count(), 2);
  const lower = await pieces.nth(0).boundingBox();
  const upper = await pieces.nth(1).boundingBox();
  const overlap = {
    x: Math.max(lower.x, upper.x) + 12,
    y: Math.max(lower.y, upper.y) + 12,
  };
  assert.ok(overlap.x < Math.min(lower.x + lower.width, upper.x + upper.width), "the pieces overlap");

  // Reach the lower piece from the right-click list.
  await page.mouse.click(overlap.x, overlap.y, { button: "right" });
  await page.locator(".collage-here__pick").nth(1).click();
  await page.waitForTimeout(150);
  assert.deepEqual(await held(), [0], "the list hands over the buried piece");

  // A quick click on it, where the other piece lies on top, keeps it.
  await page.mouse.click(overlap.x, overlap.y);
  await page.waitForTimeout(150);
  assert.deepEqual(await held(), [0], "clicking the held buried piece keeps it");
  await page.screenshot({ path: `${evidence}/2-buried-piece-kept-on-click.png` });

  // A press that drags moves the buried piece, not the one on top.
  const lowerBefore = await boxOf(0);
  const upperBefore = await boxOf(1);
  await page.mouse.move(overlap.x, overlap.y);
  await page.mouse.down();
  await page.mouse.move(overlap.x - 90, overlap.y + 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.notDeepEqual(await boxOf(0), lowerBefore, "the buried piece moved");
  assert.deepEqual(await boxOf(1), upperBefore, "the piece on top stayed");
  assert.deepEqual(await held(), [0]);
  await page.screenshot({ path: `${evidence}/3-buried-piece-dragged.png` });
  // Put it back under the other one.
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  assert.deepEqual(await boxOf(0), lowerBefore);

  // Shift-dragging over the held piece moves it without adding the top one.
  await page.keyboard.down("Shift");
  await page.mouse.move(overlap.x, overlap.y);
  await page.mouse.down();
  await page.mouse.move(overlap.x - 60, overlap.y + 50, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(150);
  assert.deepEqual(await held(), [0], "a shift drag does not add the piece on top");
  assert.deepEqual(await boxOf(1), upperBefore, "a shift drag leaves the piece on top");
  assert.notDeepEqual(await boxOf(0), lowerBefore, "a shift drag moves the held piece");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);

  // A shift click there adds the piece on top.
  await page.keyboard.down("Shift");
  await page.mouse.click(overlap.x, overlap.y);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(150);
  assert.deepEqual(await held(), [0, 1], "a shift click adds the piece on top");
  await page.screenshot({ path: `${evidence}/4-shift-click-adds.png` });

  // Clicking away lets go, and the next click takes the piece on top.
  const frame = await page.locator(".collage-frame").boundingBox();
  await page.mouse.click(frame.x + 20, frame.y + 20);
  await page.waitForTimeout(150);
  assert.deepEqual(await held(), [], "a click on bare paper lets go");
  await page.mouse.click(overlap.x, overlap.y);
  await page.waitForTimeout(150);
  assert.deepEqual(await held(), [1], "after letting go, a click takes the piece on top");
  await page.screenshot({ path: `${evidence}/5-top-after-click-away.png` });

  assert.deepEqual(errors, []);
  console.log(`PASS (evidence in ${evidence})`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
