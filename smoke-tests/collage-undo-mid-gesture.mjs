// ABOUTME: Verifies Cmd/Ctrl+Z in the built collage studio interrupts a running gesture.
// ABOUTME: Seeds local scraps, drags a corner, presses undo mid-drag, and checks focus never reaches search.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const extension = resolve(process.env.SCRAPS_EXTENSION_DIR || "extension/dist/chrome-mv3");
const evidence = resolve(process.env.COLLAGE_EVIDENCE_DIR || "/private/tmp/collage-undo-evidence");
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "collage-undo-"));
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
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  await page.getByRole("button", { name: "create", exact: true }).waitFor();
  // The page opens the scrap store, so seeding from it finds the store made.
  await page.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const request = indexedDB.open("collection_events_db");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((done, reject) => {
        const tx = db.transaction("events", "readwrite");
        const events = tx.objectStore("events");
        for (let index = 0; index < 6; index += 1) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#${(index * 0x203040 + 0x4a9a8a).toString(16).slice(-6)}"/></svg>`;
          events.put({
            id: `undo-scrap-${index}`,
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
        }
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

  // The way a person finds a scrap: type in the drawer's search, then click
  // the result onto the paper. Focus is left wherever that path leaves it.
  const search = page.locator(".collage-tray").getByRole("textbox", { name: "Search scraps" });
  await search.click();
  await search.pressSequentially("Swatch");
  await page.waitForTimeout(400);
  await page.locator(".collage-tray__slot").first().click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".collage-piece").count(), 1, "one piece placed");

  const pieceBox = async () => {
    const box = await page.locator(".collage-piece").first().boundingBox();
    return { width: Math.round(box.width), height: Math.round(box.height), x: Math.round(box.x), y: Math.round(box.y) };
  };
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}` : "none";
    });

  // A first edit to undo back to: a plain move by drag.
  const start = await pieceBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 80, start.y + start.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterMove = await pieceBox();
  console.log("focus after placing and moving:", await focused());

  // Grab the bottom-right corner and scale up, then press undo mid-drag.
  await page.locator(".collage-piece--selected").waitFor();
  const grip = await page.locator('[data-grip="corner-bottom-right"]').first().boundingBox();
  assert.ok(grip, "a corner grip is showing");
  const gx = grip.x + grip.width / 2;
  const gy = grip.y + grip.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 120, gy + 90, { steps: 8 });
  await page.waitForTimeout(100);
  const midScale = await pieceBox();
  await page.screenshot({ path: `${evidence}/1-mid-scale.png` });
  const searchBefore = await search.inputValue();
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  const afterUndo = await pieceBox();
  const searchAfter = await search.inputValue();
  const focusAtUndo = await focused();
  await page.screenshot({ path: `${evidence}/2-after-undo-mid-drag.png` });
  // Keep moving the mouse: an interrupted drag must not keep scaling.
  await page.mouse.move(gx + 200, gy + 160, { steps: 6 });
  await page.waitForTimeout(100);
  const afterMoreMotion = await pieceBox();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterRelease = await pieceBox();
  await page.screenshot({ path: `${evidence}/3-after-release.png` });

  const report = { start, afterMove, midScale, afterUndo, afterMoreMotion, afterRelease, searchBefore, searchAfter, focusAtUndo, errors };
  console.log(JSON.stringify(report, null, 2));

  assert.equal(searchAfter, searchBefore, "undo must not edit the search field");
  assert.deepEqual(afterUndo, afterMove, "undo mid-scale returns the piece to where the scale began");
  assert.deepEqual(afterMoreMotion, afterMove, "an interrupted scale stops following the pointer");
  assert.deepEqual(afterRelease, afterMove, "releasing after an interrupt changes nothing");

  // A second undo goes back past the move to where the piece was placed.
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  assert.deepEqual(await pieceBox(), start, "the next undo takes back the move");
  // Redo steps forward one at a time: the move, then the interrupted scale,
  // which was kept as it stood when undo was pressed.
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.waitForTimeout(200);
  assert.deepEqual(await pieceBox(), afterMove, "the first redo restores the move");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.waitForTimeout(200);
  assert.deepEqual(await pieceBox(), midScale, "the second redo restores the interrupted scale");
  await page.screenshot({ path: `${evidence}/4-after-redo.png` });
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  assert.deepEqual(await pieceBox(), afterMove);

  // The keyboard scale (S) runs as a mode; undo there used to fall through to
  // the browser, which undid the drawer's search text instead.
  await page.locator(".collage-piece").first().click();
  const beforeKeyScale = await pieceBox();
  await page.keyboard.press("s");
  await page.mouse.move(1250, 820, { steps: 6 });
  await page.waitForTimeout(150);
  const keyScaled = await pieceBox();
  assert.notDeepEqual(keyScaled, beforeKeyScale, "the S scale follows the pointer");
  await page.screenshot({ path: `${evidence}/5-key-scale-running.png` });
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  assert.equal(await search.inputValue(), "Swatch", "undo in scale mode leaves the search text alone");
  assert.deepEqual(await pieceBox(), beforeKeyScale, "undo in scale mode returns the piece to where the scale began");
  await page.mouse.move(1350, 860, { steps: 6 });
  await page.waitForTimeout(150);
  assert.deepEqual(await pieceBox(), beforeKeyScale, "the scale mode has ended");
  await page.screenshot({ path: `${evidence}/6-key-scale-undone.png` });

  // A filter chip keeps its own keys, but undo from there is still the
  // studio's: the browser's undo would erase the search text.
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.waitForTimeout(200);
  const chip = page.locator(".collage-tray .scrap-filters__chip", { hasText: "type" });
  await chip.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  assert.equal(await search.inputValue(), "Swatch", "undo from a filter chip leaves the search text alone");
  assert.deepEqual(await pieceBox(), beforeKeyScale, "undo from a filter chip undoes the collage");

  // A reopened collage starts with no history. A crop lives outside the
  // history until it is committed, so the Undo button must still offer to
  // take back a crop that is the first edit.
  await page.getByRole("button", { name: "back to collages" }).click();
  await page.waitForTimeout(900);
  const leaving = page.getByRole("button", { name: "leave without saving" });
  if (await leaving.count()) await leaving.click();
  await page.locator(".collage-card__open").first().click();
  await page.locator(".collage-piece").first().waitFor();
  await page.waitForTimeout(900);
  const undoButton = page.getByRole("button", { name: "Undo", exact: true });
  assert.equal(await undoButton.isDisabled(), true, "a reopened collage has nothing to undo");
  const beforeCrop = await pieceBox();
  await page.locator(".collage-piece").first().click();
  await page.keyboard.press("c");
  const cropGrip = await page.getByRole("button", { name: "Crop from the right" }).boundingBox();
  await page.mouse.move(cropGrip.x + cropGrip.width / 2, cropGrip.y + cropGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(cropGrip.x - 40, cropGrip.y + cropGrip.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await undoButton.isDisabled(), false, "a pending crop can be undone from the toolbar");
  await page.screenshot({ path: `${evidence}/7-pending-crop-undo-enabled.png` });
  await undoButton.click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".collage-crop").count(), 0, "undo ends the crop session");
  assert.deepEqual(await pieceBox(), beforeCrop, "undo takes back the crop");
  assert.equal(await page.getByRole("button", { name: "Redo", exact: true }).isDisabled(), false, "redo can bring the crop back");
  await page.screenshot({ path: `${evidence}/8-pending-crop-undone.png` });

  assert.deepEqual(errors, []);
  console.log("PASS");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
