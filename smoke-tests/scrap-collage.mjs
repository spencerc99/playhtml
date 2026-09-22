// ABOUTME: Verifies the scrap collage create mode end to end in isolated Chromium.
// ABOUTME: Covers every scrap kind through the bake, autosave, the source peek, and the card's back.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { deflateSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = process.env.COLLAGE_EVIDENCE_DIR || "/tmp/collage-evidence";
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "wwo-scrap-collage-"));
/**
 * A real scraps export to exercise the studio at true scale. Nobody else has
 * this file, so the section that uses it is skipped when the variable is unset.
 */
const exportPath = process.env.SCRAPS_EXPORT || null;
/** How long the studio waits for an arrangement to settle before writing. */
const SETTLE_MS = 1200;

const photo = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${fill}"/><circle cx="300" cy="200" r="120" fill="#b76841"/></svg>`;
const cursorImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><polygon points="2,2 2,26 9,19 14,30 20,27 15,17 26,17" fill="#7a3fa0" stroke="#fff" stroke-width="2"/></svg>';
const favicon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#4a9a8a"/></svg>';

/**
 * A real PNG whose pixels are half see-through, and a real JPEG, which cannot
 * carry alpha at all. The drawer decides its backing from the actual decoded
 * pixels, so these have to be genuine encoded bytes rather than SVG.
 */
function pngFrom(raw, side) {
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolor with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function transparentPng(side = 64) {
  const raw = Buffer.alloc(side * (side * 4 + 1));
  let at = 0;
  for (let y = 0; y < side; y += 1) {
    raw[at] = 0;
    at += 1;
    for (let x = 0; x < side; x += 1) {
      raw[at] = 0xb7;
      raw[at + 1] = 0x68;
      raw[at + 2] = 0x41;
      // The left half is fully transparent, so an alpha read cannot miss it.
      raw[at + 3] = x >= side / 2 ? 255 : 0;
      at += 4;
    }
  }
  return pngFrom(raw, side);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

/**
 * A solid JPEG: a 64x64 opaque block, encoded once and inlined so the smoke
 * needs no image tooling and runs the same on any machine. A JPEG has no
 * alpha channel at all, which is the point — the drawer must not put a
 * chequer behind it.
 */
const SOLID_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAA" +
  "A6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAAD/7QA4UGhvdG9zaG9wIDMu" +
  "MAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAQABAAwEiAAIR" +
  "AQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAAB" +
  "fQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5" +
  "OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeo" +
  "qaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMB" +
  "AQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYS" +
  "QVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNU" +
  "VVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5" +
  "usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMF" +
  "BgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgIC" +
  "BAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ" +
  "EBAQEP/dAAQABP/aAAwDAQACEQMRAD8A/Syiiiv5PP2wKKKKACiiigAooooA/9D9LKKKK/k8/bAo" +
  "oooAKKKKACiiigD/0f0sooor+Tz9sCiiigAooooAKKKKAP/S/Syiiiv5PP2wKKKKACiiigAooooA" +
  "/9k=";

/**
 * Each page carries one of every scrap kind: a photo, a styled button with an
 * inner icon, a standalone inline svg icon, a heading, and an element with a
 * custom cursor. The button's background is a gradient and its font-family is
 * quoted, so the bake's XML escaping is exercised with real captured styles.
 *
 * A second button is light text outlined on a dark section, carrying no
 * background of its own. That is the case the recorded backdrop exists for:
 * without the dark patch behind it, its text bakes invisible on pale paper.
 */
function pageMarkup(slug, photoSrc, title) {
  return `<!doctype html><html><head><title>${title}</title>
<link rel="icon" href="/favicon.svg">
<style>
body{margin:40px;font:20px sans-serif;background:#fff}
img.photo{width:320px;height:213px;display:block}
button.fancy{
  width:220px;height:56px;margin:24px 0;
  background-image:linear-gradient(90deg, #c4724e 0%, #d4b85c 100%);
  background-color:#c4724e;color:#fffdf9;border:2px solid #8f4a29;
  border-radius:14px;font-family:"Georgia & Co", serif;font-size:18px;
  font-weight:700;letter-spacing:0.04em;box-shadow:0 4px 10px rgba(0,0,0,.25);
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
}
svg.badge{width:96px;height:96px;display:block;color:#4a9a8a}
.darksection{background:#1c2026;padding:28px;margin:24px 0}
button.outlined{
  width:200px;height:52px;background:transparent;color:#f4efe7;
  border:2px solid #f4efe7;border-radius:8px;font-size:17px;font-weight:600;
}
.cursorzone{width:300px;height:120px;background:#eee;margin-top:24px;
  cursor:url("/cursor.svg") 4 2, pointer;display:flex;align-items:center;justify-content:center}
</style></head><body>
<h1>${title}</h1>
<img class="photo" alt="Collected artwork ${slug}" src="${photoSrc}">
<button class="fancy" type="button">
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M10 1l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z" fill="currentColor"/></svg>
  Tom &amp; Jerry's "Pick"
</button>
<img class="photo" alt="Corner mark ${slug}" src="/photo/corner-${slug}.svg">
<img class="photo" alt="Solid jpeg ${slug}" src="/photo/solid-${slug}.jpg">
<img class="photo" alt="See-through png ${slug}" src="/photo/holes-${slug}.png">
<svg class="badge" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="4"/><path d="M14 24l7 7 13-14" fill="none" stroke="currentColor" stroke-width="4"/></svg>
<div class="cursorzone">hover me</div>
<div class="darksection">
  <button class="outlined" type="button">Read the notes</button>
</div>
</body></html>`;
}

const PAGE_TITLES = {
  first: "Ceramics journal",
  second: "Objects worth keeping",
  third: "Studio references",
};

const HOLES_PNG = transparentPng();
const SOLID_JPEG = Buffer.from(SOLID_JPEG_BASE64, "base64");

/** Flipped on to make a photo that browsed fine vanish at bake time. */
let missingPhotoGone = false;
/** Flipped on to make every photo fetch fail, so a re-bake cannot succeed. */
let photosBlocked = false;

const server = createServer((request, response) => {
  const path = request.url.split("?")[0];
  if (path === "/cursor.svg") {
    response.setHeader("content-type", "image/svg+xml");
    response.end(cursorImage);
    return;
  }
  if (path === "/favicon.svg") {
    response.setHeader("content-type", "image/svg+xml");
    response.end(favicon);
    return;
  }
  if (path.startsWith("/photo/")) {
    if (photosBlocked || (path.includes("missing") && missingPhotoGone)) {
      response.writeHead(404);
      response.end("gone");
      return;
    }
    if (path.startsWith("/photo/holes")) {
      response.setHeader("content-type", "image/png");
      response.end(HOLES_PNG);
      return;
    }
    if (path.startsWith("/photo/solid")) {
      response.setHeader("content-type", "image/jpeg");
      response.end(SOLID_JPEG);
      return;
    }
    if (path.startsWith("/photo/corner")) {
      response.setHeader("content-type", "image/svg+xml");
      // A dark block in the top-left only, so a mirror is unmistakable.
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
          '<rect width="400" height="300" fill="#e8dcc8"/>' +
          '<rect x="20" y="20" width="120" height="90" fill="#2b2724"/>' +
          "</svg>",
      );
      return;
    }
    response.setHeader("content-type", "image/svg+xml");
    response.end(photo(path.includes("b") ? "#aecfd3" : "#f0c77c"));
    return;
  }
  if (path === "/favicon.ico") {
    response.writeHead(404);
    response.end();
    return;
  }
  const slug = path.slice(1) || "first";
  const src =
    slug === "second"
      ? "/photo/b.svg"
      : slug === "third"
        ? "/photo/missing.svg"
        : "/photo/a.svg";
  response.setHeader("content-type", "text/html");
  response.end(pageMarkup(slug, src, PAGE_TITLES[slug] || "Color studies"));
});
await new Promise((ok, bad) => {
  server.once("error", bad);
  server.listen(0, "127.0.0.1", ok);
});
const origin = `http://127.0.0.1:${server.address().port}`;
// The production build, which `bun run build-extension` writes. The dev build
// fetches its modules from the WXT dev server, which this run blocks along with
// the rest of the network, so nothing would mount.
const extension = resolve(workspace, "extension/dist/chrome-mv3");
const pageErrors = [];
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: process.env.PLAYWRIGHT_CHROMIUM_PATH ? undefined : "chromium",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
    headless: true,
    viewport: { width: 1500, height: 980 },
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
  context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  const worker =
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;

  // The isolated tester has early access; a real user still opts in.
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

  // Browse three pages so the collectors gather every scrap kind.
  for (const slug of ["first", "second", "third"]) {
    const visit = await context.newPage();
    // A brand-new tab can still be settling when the goto lands, which aborts
    // it, so the first navigation of each visit is retried rather than
    // failing the run on a startup race.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await visit.goto(`${origin}/${slug}`, { waitUntil: "load" });
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await visit.waitForTimeout(500);
      }
    }
    await visit.waitForTimeout(1500);
    await visit.hover(".cursorzone");
    await visit.mouse.move(300, 300);
    await visit.waitForTimeout(700);
    await visit.hover("button.fancy");
    await visit.waitForTimeout(2000);
    // The page is taller than the viewport and a scrap is only captured after
    // it has been properly on screen for a moment, so the lower part is
    // brought into view in stages rather than scrolled straight past.
    await visit.locator("svg.badge").scrollIntoViewIfNeeded();
    await visit.waitForTimeout(2000);
    await visit.locator(".darksection").scrollIntoViewIfNeeded();
    await visit.waitForTimeout(2000);
    await visit.close();
  }
  await new Promise((r) => setTimeout(r, 3000));

  const byKind = await worker.evaluate(async () => {
    const db = await new Promise((ok, bad) => {
      const r = indexedDB.open("collection_events_db");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => bad(r.error);
    });
    try {
      const rows = await new Promise((ok, bad) => {
        const r = db
          .transaction("events")
          .objectStore("events")
          .index("type")
          .getAll("element");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
      });
      const counts = {};
      for (const row of rows) {
        const kind = row.data?.kind;
        if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
      }
      return counts;
    } finally {
      db.close();
    }
  });
  console.log("scraps collected by kind:", byKind);
  for (const kind of ["image", "button", "svg-icon", "heading", "cursor"]) {
    assert.ok(byKind[kind] > 0, `expected at least one ${kind} scrap`);
  }

  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  // ------------------------------------------------------------- utilities
  /** Every stored collage, as plain rows. */
  const storedCollages = () =>
    page.evaluate(async () => {
      const db = await new Promise((ok, bad) => {
        const r = indexedDB.open("scrap_collages_db");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
      });
      try {
        const rows = await new Promise((ok, bad) => {
          const r = db.transaction("collages").objectStore("collages").getAll();
          r.onsuccess = () => ok(r.result);
          r.onerror = () => bad(r.error);
        });
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: row.updatedAt,
          pieces: row.pieces.length,
          drawn: row.preview?.drawn === true,
          previewBytes: row.preview?.drawn ? row.preview.image.size : 0,
          firstPiece: row.pieces[0]
            ? { x: row.pieces[0].x, y: row.pieces[0].y }
            : null,
        }));
      } finally {
        db.close();
      }
    });

  const standing = async () => {
    const node = page.locator(".collage-standing");
    return (await node.count()) ? (await node.textContent()).trim() : "";
  };

  /** Selects a piece through the documented Tab cycling. */
  async function selectByTab(steps = 1) {
    for (let step = 0; step < steps; step += 1) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(140);
    }
    await page.waitForSelector(".collage-piece--selected");
  }

  async function placeFromTray(filter, index = 0) {
    await page.getByRole("button", { name: filter, exact: true }).click();
    await page.waitForTimeout(350);
    await page.locator(".collage-tray__slot").nth(index).click();
    await page.waitForTimeout(450);
  }

  async function openStudio() {
    await page.getByRole("button", { name: "start a new one" }).click();
    await page.waitForTimeout(900);
  }

  /** Gets back to the history whatever the studio is showing. */
  async function backToHistory() {
    if (await page.locator(".collage-bar").count()) {
      await page.getByRole("button", { name: "done" }).click();
      await page.waitForTimeout(900);
      const leaving = page.getByRole("button", { name: "leave without saving" });
      if (await leaving.count()) {
        await leaving.click();
        await page.waitForTimeout(700);
      }
    }
    await page.waitForSelector("text=start a new one", { timeout: 20_000 });
  }

  await page.getByRole("button", { name: "create", exact: true }).click();
  await page.waitForTimeout(600);

  // =========================================================== autosave
  // An untouched new collage leaves no trace at all.
  await openStudio();
  await page.waitForTimeout(SETTLE_MS + 1500);
  assert.deepEqual(
    await storedCollages(),
    [],
    "an untouched empty collage must write nothing",
  );
  assert.equal(
    await standing(),
    "",
    "an untouched collage should say nothing about saving",
  );
  await page.screenshot({ path: `${evidence}/01-autosave-untouched.png` });

  // Placing a piece writes the collage with nothing pressed.
  await placeFromTray("pics", 0);
  /** Waits for the stored rows to satisfy a condition, polling from Node. */
  async function waitForStored(describe, ready, timeoutMs = 30_000) {
    const until = Date.now() + timeoutMs;
    let rows = [];
    while (Date.now() < until) {
      rows = await storedCollages();
      if (ready(rows)) return rows;
      await page.waitForTimeout(400);
    }
    throw new Error(
      `timed out waiting for ${describe}; stored: ${JSON.stringify(rows)}`,
    );
  }
  await waitForStored("the collage to be autosaved", (rows) => rows.length > 0);
  let stored = await storedCollages();
  console.log("autosaved after placing:", stored);
  assert.equal(stored.length, 1, "placing a piece should store the collage");
  assert.equal(stored[0].pieces, 1);
  await page.waitForTimeout(3000);
  assert.equal(
    await standing(),
    "saved",
    "a healthy autosave should settle on 'saved'",
  );
  await page.screenshot({ path: `${evidence}/02-autosave-saved.png` });
  const collageId = stored[0].id;
  const firstPlace = stored[0].firstPiece;

  // Moving the piece and reloading right after the debounce keeps the move.
  await selectByTab();
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  await page.waitForTimeout(SETTLE_MS + 2500);
  stored = await storedCollages();
  console.log("after a nudge burst:", stored[0]);
  assert.ok(
    stored[0].firstPiece.x > firstPlace.x + 30,
    `the nudged position should be stored, ${firstPlace.x} -> ${stored[0].firstPiece.x}`,
  );
  const movedTo = stored[0].firstPiece;

  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const afterReload = await storedCollages();
  assert.deepEqual(
    afterReload[0].firstPiece,
    movedTo,
    "a reload right after the debounce must keep the new position",
  );
  assert.equal(afterReload.length, 1, "autosaving must not multiply records");

  // Reopen it and change something, then press done before the debounce fires.
  await page.getByRole("button", { name: "create", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "keep editing" }).first().click();
  await page.waitForTimeout(2500);
  await page.locator(".collage-title-input").fill("saved by leaving");
  // Straight to done, well inside the settle window.
  await page.getByRole("button", { name: "done" }).click();
  await page.waitForTimeout(3000);
  stored = await storedCollages();
  console.log("after done-before-debounce:", stored);
  assert.equal(
    stored.find((row) => row.id === collageId).title,
    "saved by leaving",
    "pressing done must flush the pending change",
  );
  assert.ok(
    await page.getByRole("button", { name: "start a new one" }).isVisible(),
    "a healthy autosave means done leaves with no prompt",
  );
  await page.screenshot({ path: `${evidence}/03-autosave-flushed-on-done.png` });

  // Cmd+S flushes too, and the history is up to date when he comes back.
  await page.getByRole("button", { name: "keep editing" }).first().click();
  await page.waitForTimeout(2500);
  await page.locator(".collage-title-input").fill("saved by the key");
  await page.locator(".collage-frame").click({ position: { x: 6, y: 6 } });
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(3000);
  stored = await storedCollages();
  assert.equal(
    stored.find((row) => row.id === collageId).title,
    "saved by the key",
    "cmd+S should write right away",
  );
  const previewBeforeBlock = stored.find(
    (row) => row.id === collageId,
  ).previewBytes;
  assert.ok(previewBeforeBlock > 0, "the collage should carry a real preview");

  // A bake that fails is not a save failure: the arrangement lands, the last
  // good preview is kept, and the status says the picture is behind.
  photosBlocked = true;
  await selectByTab();
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Shift+ArrowDown");
  }
  await page.waitForTimeout(SETTLE_MS + 6000);
  stored = await storedCollages();
  const blocked = stored.find((row) => row.id === collageId);
  console.log("after the image host went away:", blocked);
  const blockedStanding = await standing();
  console.log("standing with a failed bake:", blockedStanding);
  assert.ok(
    blocked.firstPiece.y > movedTo.y + 20,
    "the arrangement must still have been written",
  );
  assert.equal(
    blocked.drawn,
    true,
    "the last good preview must be kept, not replaced with nothing",
  );
  assert.equal(
    blocked.previewBytes,
    previewBeforeBlock,
    "a failed bake must not overwrite the preview it could not redraw",
  );
  assert.ok(
    blockedStanding.includes("preview out of date"),
    `the status should say the preview is behind, got "${blockedStanding}"`,
  );
  await page.screenshot({ path: `${evidence}/04-autosave-preview-behind.png` });

  // An export, unlike a save, fails out loud.
  await page.getByRole("button", { name: "export png" }).click();
  await page.waitForTimeout(4000);
  const exportNotice = (
    await page.locator(".collage-notice").first().textContent()
  ).trim();
  console.log("export notice while blocked:", exportNotice);
  assert.ok(
    exportNotice.startsWith("could not export"),
    `an export must fail loudly, got "${exportNotice}"`,
  );

  photosBlocked = false;
  await backToHistory();

  // =============================================== every kind through the bake
  await openStudio();
  for (const kind of ["pics", "btns", "icons", "heads", "curs"]) {
    await placeFromTray(kind, 0);
  }
  assert.equal(await page.locator(".collage-piece").count(), 5);

  // Spread the five pieces out so each occupies its own part of the frame.
  const spots = await page.evaluate(() =>
    [...document.querySelectorAll(".collage-piece")].map((node) =>
      node.getBoundingClientRect().toJSON(),
    ),
  );
  const frameBox = await page.locator(".collage-frame").boundingBox();
  const targets = [
    { x: 0.25, y: 0.24 },
    { x: 0.72, y: 0.24 },
    { x: 0.25, y: 0.7 },
    { x: 0.5, y: 0.47 },
    { x: 0.78, y: 0.72 },
  ];
  for (let index = 0; index < spots.length; index += 1) {
    const from = spots[index];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      frameBox.x + frameBox.width * targets[index].x,
      frameBox.y + frameBox.height * targets[index].y,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  await page.locator(".collage-title-input").fill("one of each");
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${evidence}/10-mixed-kinds-studio.png` });

  const baked = await page.evaluate(async () => {
    const db = await new Promise((ok) => {
      const r = indexedDB.open("scrap_collages_db");
      r.onsuccess = () => ok(r.result);
    });
    let record;
    try {
      const rows = await new Promise((ok) => {
        const r = db.transaction("collages").objectStore("collages").getAll();
        r.onsuccess = () => ok(r.result);
      });
      record = rows.find((row) => row.title === "one of each");
    } finally {
      db.close();
    }
    const bitmap = await createImageBitmap(record.preview.image);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const scaleX = bitmap.width / record.frame.width;
    const scaleY = bitmap.height / record.frame.height;
    const background = [...context.getImageData(4, 4, 1, 1).data].slice(0, 3);
    const samples = record.pieces.map((piece) => {
      // A piece that baked draws pixels away from the frame background.
      let painted = 0;
      let total = 0;
      for (let sx = 0.2; sx <= 0.8; sx += 0.1) {
        for (let sy = 0.2; sy <= 0.8; sy += 0.1) {
          const x = Math.round((piece.x + piece.width * sx) * scaleX);
          const y = Math.round((piece.y + piece.height * sy) * scaleY);
          if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
            continue;
          }
          const [r, g, b] = context.getImageData(x, y, 1, 1).data;
          total += 1;
          const distance =
            Math.abs(r - background[0]) +
            Math.abs(g - background[1]) +
            Math.abs(b - background[2]);
          if (distance > 24) painted += 1;
        }
      }
      return { kind: piece.scrap.kind, painted, total };
    });
    // A run of corner pixels, so grain can be told from a flat fill: grain
    // makes neighbouring paper pixels differ, a flat tone makes them equal.
    const corner = [];
    for (let step = 0; step < 24; step += 1) {
      corner.push([...context.getImageData(4 + step, 4, 1, 1).data].slice(0, 3));
    }
    return {
      pieceCount: record.pieces.length,
      previewType: record.preview.image.type,
      previewBytes: record.preview.image.size,
      width: bitmap.width,
      height: bitmap.height,
      samples,
      paper: record.paper,
      corner,
      bytes: [...new Uint8Array(await record.preview.image.arrayBuffer())],
    };
  });
  await writeFile(`${evidence}/11-baked-preview.png`, Buffer.from(baked.bytes));
  delete baked.bytes;
  console.log("baked:", JSON.stringify(baked, null, 2));
  assert.equal(baked.pieceCount, 5);
  assert.ok(
    baked.samples.some((sample) => sample.kind === "heading"),
    "a heading should be among the baked pieces",
  );
  assert.equal(baked.previewType, "image/png");
  assert.equal(baked.width, 3000);
  assert.equal(baked.height, 2000);
  for (const sample of baked.samples) {
    assert.ok(
      sample.painted > 0,
      `the baked ${sample.kind} drew nothing but frame background`,
    );
  }
  // The bake must show the same paper the studio did: grained paper varies
  // pixel to pixel where a flat tone is uniform.
  const cornerVaries = baked.corner.some(
    (pixel) =>
      pixel[0] !== baked.corner[0][0] ||
      pixel[1] !== baked.corner[0][1] ||
      pixel[2] !== baked.corner[0][2],
  );
  console.log(
    "baked paper:",
    baked.paper,
    "corner varies:",
    cornerVaries,
    baked.corner.slice(0, 4),
  );
  assert.equal(
    cornerVaries,
    baked.paper.grain,
    baked.paper.grain
      ? "grained paper should bake as grain, not a flat tone"
      : "ungrained paper should bake flat",
  );

  await backToHistory();

  // ==================================== a button that brought its own backdrop
  // The outlined button is light text with no background of its own, read
  // against a dark section. Its recorded backdrop has to bake as a dark patch,
  // or the words disappear into the pale paper.
  await openStudio();
  await page.getByRole("button", { name: "btns", exact: true }).click();
  await page.waitForTimeout(400);
  const outlinedIndex = await page.evaluate(() =>
    [...document.querySelectorAll(".collage-tray__slot")].findIndex((slot) =>
      slot.textContent.includes("Read the notes"),
    ),
  );
  assert.ok(
    outlinedIndex >= 0,
    "the outlined button should be in the drawer under btns",
  );
  await page.locator(".collage-tray__slot").nth(outlinedIndex).click();
  await page.waitForTimeout(600);
  await page.locator(".collage-title-input").fill("outlined on dark");
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(8000);

  const backdropBake = await page.evaluate(async () => {
    const db = await new Promise((ok) => {
      const r = indexedDB.open("scrap_collages_db");
      r.onsuccess = () => ok(r.result);
    });
    let record;
    try {
      const rows = await new Promise((ok) => {
        const r = db.transaction("collages").objectStore("collages").getAll();
        r.onsuccess = () => ok(r.result);
      });
      record = rows.find((row) => row.title === "outlined on dark");
    } finally {
      db.close();
    }
    const piece = record.pieces[0];
    const bitmap = await createImageBitmap(record.preview.image);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const scaleX = bitmap.width / record.frame.width;
    const scaleY = bitmap.height / record.frame.height;
    // Sample across the piece and keep the darkest pixel found: the patch is
    // dark even where the light glyphs and border are not.
    let darkest = 255;
    for (let sx = 0.1; sx <= 0.9; sx += 0.05) {
      for (let sy = 0.2; sy <= 0.8; sy += 0.05) {
        const x = Math.round((piece.x + piece.width * sx) * scaleX);
        const y = Math.round((piece.y + piece.height * sy) * scaleY);
        if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) continue;
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        darkest = Math.min(darkest, (r + g + b) / 3);
      }
    }
    const [pr, pg, pb] = context.getImageData(4, 4, 1, 1).data;
    return {
      kind: piece.scrap.kind,
      backdropColor: piece.scrap.backdropColor ?? null,
      darkest,
      paperLuma: (pr + pg + pb) / 3,
    };
  });
  console.log("backdrop bake:", backdropBake);
  assert.equal(backdropBake.kind, "button");
  assert.ok(
    backdropBake.backdropColor,
    "the outlined button should have carried a recorded backdrop",
  );
  assert.ok(
    backdropBake.darkest < 90,
    `the backdrop should bake as dark pixels behind the text, darkest was ${backdropBake.darkest}`,
  );
  assert.ok(
    backdropBake.paperLuma > 200,
    "the surrounding paper should still be pale, so the patch is the piece's own",
  );
  // ============================================================== the drawer
  // A chequer means "this has holes in it", so only material that really does
  // gets one. The two pictures below are genuine encoded bytes: a JPEG, which
  // cannot carry alpha, and a PNG that is half transparent.
  await page.getByRole("button", { name: "pics", exact: true }).click();
  await page.waitForTimeout(600);
  const backings = await page.evaluate(async () => {
    const slots = [...document.querySelectorAll(".collage-tray__slot")];
    // The backing is decided once a picture has loaded and been sampled.
    await Promise.all(
      slots
        .map((slot) => slot.querySelector("img"))
        .filter((image) => image && !image.complete)
        .map(
          (image) =>
            new Promise((done) => {
              image.addEventListener("load", done, { once: true });
              image.addEventListener("error", done, { once: true });
            }),
        ),
    );
    await new Promise((done) => setTimeout(done, 600));
    return [...document.querySelectorAll(".collage-tray__slot")].map((slot) => {
      const thumb = slot.querySelector(".collage-tray__thumb");
      const image = slot.querySelector("img");
      return {
        alt: image?.getAttribute("alt") ?? "",
        src: image?.getAttribute("src") ?? "",
        checker: thumb?.classList.contains("collage-tray__thumb--checker"),
      };
    });
  });
  console.log("thumbnail backings:", backings);
  const jpeg = backings.find((row) => row.src.includes("/photo/solid"));
  const holes = backings.find((row) => row.src.includes("/photo/holes"));
  assert.ok(jpeg, "the solid jpeg should be in the drawer");
  assert.ok(holes, "the see-through png should be in the drawer");
  assert.equal(
    jpeg.checker,
    false,
    "a jpeg cannot be transparent, so it should sit straight on the paper",
  );
  assert.equal(
    holes.checker,
    true,
    "a png with see-through pixels should get a chequer behind it",
  );
  // An svg picture drawn from the page's own markup is a cut-out by nature.
  await page.getByRole("button", { name: "icons", exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok(
    (await page.locator(".collage-tray__thumb--checker").count()) > 0,
    "icons should always be backed",
  );
  await page.getByRole("button", { name: "all", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${evidence}/00-drawer-backings.png` });

  // ======================================================== the studio chrome
  // The piece's tools float beside the piece; the bottom bar carries none.
  await page.locator(".collage-frame").click({ position: { x: 6, y: 6 } });
  await page.waitForTimeout(300);
  assert.equal(
    await page.locator(".collage-piece-actions").count(),
    0,
    "the piece strip should only exist while something is selected",
  );
  await selectByTab();
  await page.waitForSelector(".collage-piece-actions");
  const stripPlacement = await page.evaluate(() => {
    const strip = document
      .querySelector(".collage-piece-actions")
      .getBoundingClientRect();
    const piece = document
      .querySelector(".collage-piece--selected")
      .getBoundingClientRect();
    const stage = document
      .querySelector(".collage-frame-area__stage")
      .getBoundingClientRect();
    return {
      stripTop: strip.top,
      stripBottom: strip.bottom,
      stripLeft: strip.left,
      stripRight: strip.right,
      stripHeight: strip.height,
      pieceTop: piece.top,
      stageTop: stage.top,
      stageLeft: stage.left,
      stageRight: stage.right,
    };
  });
  console.log("piece strip placement:", stripPlacement);
  assert.ok(
    stripPlacement.stripBottom <= stripPlacement.pieceTop + 1,
    "the strip should sit above the piece's box",
  );
  // Counter-scaled: it is drawn at its own size, not the frame's zoom.
  assert.ok(
    stripPlacement.stripHeight > 20 && stripPlacement.stripHeight < 44,
    `the strip should be a constant on-screen size, got ${stripPlacement.stripHeight}px`,
  );
  assert.equal(
    await page
      .locator(".collage-piece-actions")
      .evaluate((node) => getComputedStyle(node).pointerEvents),
    "none",
    "the strip's own gaps must not intercept the frame's pointer",
  );
  const stripButtons = await page
    .locator(".collage-piece-actions button")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label"),
        title: node.getAttribute("title"),
        takesPointer: getComputedStyle(node).pointerEvents !== "none",
      })),
    );
  console.log("piece strip buttons:", stripButtons);
  for (const wanted of [
    "Send back one",
    "Bring forward one",
    "Flip across",
    "Flip down",
    "Crop",
    "Duplicate",
    "Remove",
  ]) {
    const hit = stripButtons.find((button) => button.label === wanted);
    assert.ok(hit, `the strip should offer "${wanted}"`);
    assert.ok(
      hit.title && /\(.+\)/.test(hit.title),
      `"${wanted}" should name its shortcut in the title, got "${hit.title}"`,
    );
    assert.ok(hit.takesPointer, `"${wanted}" should be clickable`);
  }
  for (const gone of ["Bring to front", "Send to back"]) {
    assert.ok(
      !stripButtons.some((button) => button.label === gone),
      `"${gone}" should stay on the keyboard, not take a button`,
    );
  }
  await page.screenshot({ path: `${evidence}/05-piece-strip.png` });

  // The strip stands aside while a piece is being dragged.
  const dragFrom = await page.locator(".collage-piece--selected").boundingBox();
  await page.mouse.move(
    dragFrom.x + dragFrom.width / 2,
    dragFrom.y + dragFrom.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragFrom.x + dragFrom.width / 2 + 60,
    dragFrom.y + dragFrom.height / 2 + 40,
    { steps: 8 },
  );
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator(".collage-piece-actions").count(),
    0,
    "the strip should hide while a piece is being dragged",
  );
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-piece-actions").count(),
    1,
    "the strip should come back once the drag ends",
  );

  // A piece at the very top of the frame keeps its strip on screen, below it.
  // It is nudged until it actually reaches the top rather than a fixed number
  // of times, so the case being tested is the one that runs.
  for (let step = 0; step < 120; step += 1) {
    const room = await page.evaluate(() => {
      const node = document.querySelector(".collage-piece--selected");
      return parseFloat((node.getAttribute("style").match(/top:\s*([-\d.]+)/) ?? [])[1]);
    });
    if (room <= 0) break;
    await page.keyboard.press("Shift+ArrowUp");
  }
  await page.waitForTimeout(600);
  const pieceTopInFrame = await page.evaluate(() => {
    const node = document.querySelector(".collage-piece--selected");
    return parseFloat((node.getAttribute("style").match(/top:\s*([-\d.]+)/) ?? [])[1]);
  });
  console.log("the piece's own top in frame units:", pieceTopInFrame);
  assert.ok(
    pieceTopInFrame <= 0,
    `the piece should have reached the frame's top, got ${pieceTopInFrame}`,
  );
  const atTop = await page.evaluate(() => {
    const strip = document
      .querySelector(".collage-piece-actions")
      .getBoundingClientRect();
    const piece = document
      .querySelector(".collage-piece--selected")
      .getBoundingClientRect();
    const stage = document
      .querySelector(".collage-frame-area__stage")
      .getBoundingClientRect();
    return {
      stripTop: strip.top,
      stripBottom: strip.bottom,
      pieceTop: piece.top,
      pieceBottom: piece.bottom,
      stageTop: stage.top,
      stageBottom: stage.bottom,
    };
  });
  console.log("strip for a piece at the top edge:", atTop);
  assert.ok(
    atTop.stripTop >= atTop.stageTop - 1,
    `the strip must stay inside the stage, got ${atTop.stripTop} against ${atTop.stageTop}`,
  );
  assert.ok(
    atTop.stripBottom <= atTop.stageBottom + 1,
    "the strip must stay inside the stage's bottom too",
  );
  assert.ok(
    atTop.stripTop >= atTop.pieceTop,
    "with no room above, the strip should drop below the piece",
  );
  await page.screenshot({ path: `${evidence}/06-strip-at-top-edge.png` });
  // Nudge it back into the frame so the later bake has all four pieces on it.
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Shift+ArrowDown");
  }
  await page.waitForTimeout(400);

  // The studio tools sit in the stage's top-left, beside the canvas.
  const toolLabels = await page
    .locator(".collage-tools button")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  console.log("studio tools:", toolLabels);
  assert.deepEqual(toolLabels, ["Undo", "Redo", "Keyboard shortcuts"]);

  // The paper popover holds the document settings.
  const paperReadout = (
    await page.locator(".collage-format .collage-studio__label").first().textContent()
  ).trim();
  console.log("paper readout:", paperReadout);
  assert.ok(
    /^postcard · 1500 × 1000 · \d+%$/.test(paperReadout),
    `the readout should name size and zoom, got "${paperReadout}"`,
  );
  assert.equal(
    await page.locator(".collage-paper-popover").count(),
    0,
    "the popover should start closed",
  );
  await page.getByRole("button", { name: "paper" }).click();
  await page.waitForTimeout(400);
  await page.waitForSelector(".collage-paper-popover");
  for (const size of ["postcard", "postcard tall", "square", "wide"]) {
    assert.equal(
      await page
        .locator(".collage-paper-popover")
        .getByRole("button", { name: size, exact: true })
        .count(),
      1,
      `the popover should offer the ${size} format`,
    );
  }
  await page.screenshot({ path: `${evidence}/07-paper-popover.png` });
  const paperBefore = await page
    .locator(".collage-frame")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await page
    .locator(".collage-paper-popover")
    .getByRole("button", { name: "Paper: kraft" })
    .click();
  await page.waitForTimeout(500);
  const paperAfter = await page
    .locator(".collage-frame")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  console.log("paper changed:", paperBefore, "->", paperAfter);
  assert.notEqual(paperAfter, paperBefore, "picking a tone should repaper");
  // A new collage is made on grained paper, and the grain can be taken off.
  const grainBox = page.locator(".collage-grain input");
  assert.equal(
    await grainBox.isChecked(),
    true,
    "a new collage should start on grained paper",
  );
  const framePaint = () =>
    page
      .locator(".collage-frame")
      .evaluate((node) => getComputedStyle(node).backgroundImage);
  assert.notEqual(
    await framePaint(),
    "none",
    "grained paper should carry the grain image",
  );
  await grainBox.uncheck();
  await page.waitForTimeout(400);
  assert.equal(
    await framePaint(),
    "none",
    "taking the grain off should leave the bare tone",
  );
  await grainBox.check();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-paper-popover").count(),
    0,
    "escape should close the popover",
  );

  // The bottom bar is status only.
  const barButtons = await page
    .locator(".collage-bar button")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent || "").trim()),
    );
  console.log("bottom bar buttons:", barButtons);
  assert.deepEqual(
    barButtons,
    ["export png", "done"],
    "the bottom bar should carry nothing but export and done",
  );
  assert.equal(
    await page.locator(".collage-bar .collage-glyph").count(),
    0,
    "no piece tools may remain in the bottom bar",
  );
  assert.equal(
    await page.locator(".collage-bar .collage-swatch").count(),
    0,
    "no paper swatches may remain in the bottom bar",
  );
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${evidence}/08-studio-1280.png` });
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.waitForTimeout(600);

  // ================================================== the source peek (hold I)
  const pieceCount = await page.locator(".collage-piece").count();
  assert.equal(
    await page.locator(".collage-peek").count(),
    0,
    "the tags must not be up before the key is held",
  );
  // The title field was the last thing typed into, and the peek is inert
  // while typing, so focus leaves it first.
  await page.locator(".collage-frame").click({ position: { x: 6, y: 6 } });
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(
      () => document.activeElement?.tagName.toUpperCase() === "INPUT",
    ),
    false,
    "focus should have left the title field",
  );
  // Put the pointer over one piece so it gets the fuller tag.
  const hoverTarget = (
    await page.locator(".collage-piece").first().boundingBox()
  );
  await page.mouse.move(
    hoverTarget.x + hoverTarget.width / 2,
    hoverTarget.y + hoverTarget.height / 2,
  );
  await page.waitForTimeout(300);
  await page.keyboard.down("i");
  await page.waitForTimeout(500);
  const tags = await page.locator(".collage-peek").count();
  const fuller = await page.locator(".collage-peek--full").count();
  console.log(`peek tags: ${tags} for ${pieceCount} pieces, ${fuller} fuller`);
  assert.equal(tags, pieceCount, "every piece should get a tag");
  assert.equal(fuller, 1, "only the hovered piece gets the fuller tag");
  // The piece's own tools would sit on top of a tag, so a peek puts them away.
  assert.equal(
    await page.locator(".collage-piece-actions").count(),
    0,
    "the piece strip should stand aside while the sources are being read",
  );
  assert.equal(
    await page.locator(".collage-piece-hover").count(),
    0,
    "the hover hint should stand aside during a peek too",
  );
  const peekText = (
    await page.locator(".collage-peek--full").textContent()
  ).trim();
  console.log("the fuller tag says:", peekText);
  assert.ok(
    peekText.includes("127.0.0.1"),
    `the tag should name the domain, got "${peekText}"`,
  );
  assert.ok(
    /first seen/.test(peekText),
    `the fuller tag should say when it was first seen, got "${peekText}"`,
  );
  // Tags must never take the pointer or change what is selected.
  const selectedDuringPeek = await page
    .locator(".collage-piece--selected")
    .count();
  assert.equal(
    await page.locator(".collage-peek").evaluateAll((nodes) =>
      nodes.every((node) => getComputedStyle(node).pointerEvents === "none"),
    ),
    true,
    "the tags must not intercept the pointer",
  );
  await page.screenshot({ path: `${evidence}/12-peek-held.png` });

  await page.keyboard.up("i");
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-peek").count(),
    0,
    "releasing the key should put the tags away",
  );
  if (selectedDuringPeek > 0) {
    assert.equal(
      await page.locator(".collage-piece-actions").count(),
      1,
      "the piece strip should come back once the peek ends",
    );
  }
  assert.equal(
    await page.locator(".collage-piece--selected").count(),
    selectedDuringPeek,
    "a peek must not change the selection",
  );

  // A hold that the window steals focus from must not stick.
  await page.keyboard.down("i");
  await page.waitForTimeout(400);
  assert.ok((await page.locator(".collage-peek").count()) > 0);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-peek").count(),
    0,
    "losing focus must put the tags away",
  );
  await page.keyboard.up("i");

  // The peek is pure view state: it changes nothing that is stored or baked.
  const beforePeekBake = (await storedCollages()).find(
    (row) => row.title === "one of each",
  );
  await page.keyboard.down("i");
  await page.waitForTimeout(600);
  await page.keyboard.up("i");
  await page.waitForTimeout(SETTLE_MS + 3000);
  const afterPeekBake = (await storedCollages()).find(
    (row) => row.title === "one of each",
  );
  assert.equal(
    afterPeekBake.updatedAt,
    beforePeekBake.updatedAt,
    "a peek must not count as a change to the collage",
  );
  assert.equal(
    afterPeekBake.previewBytes,
    beforePeekBake.previewBytes,
    "a peek must not change the baked picture",
  );

  // ================================================== the back of the card
  await backToHistory();
  const card = page
    .locator(".collage-card")
    .filter({ hasText: "one of each" })
    .first();
  await page.screenshot({ path: `${evidence}/13-card-front.png` });
  assert.equal(
    await card.locator(".collage-card__face--back[inert]").count(),
    1,
    "the back should be inert while the card is face up",
  );
  await card.getByRole("button", { name: "sources" }).click();
  await page.waitForTimeout(1500);
  assert.equal(
    await card.locator(".collage-card__leaf--over").count(),
    1,
    "clicking sources should turn the card over",
  );
  assert.equal(
    await card.locator(".collage-card__face--front[inert]").count(),
    1,
    "the front should be inert once the card is turned over",
  );
  const backLines = await card
    .locator(".collage-provenance__entry")
    .allTextContents();
  console.log("the back lists:", backLines);
  assert.ok(backLines.length > 0, "the back should list the source pages");
  for (const line of backLines) {
    assert.ok(
      /127\.0\.0\.1/.test(line) && /first seen/.test(line),
      `each line should name the domain and when it was seen, got "${line}"`,
    );
  }
  const backHrefs = await card
    .locator(".collage-provenance__link")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  console.log("the back's links:", backHrefs);
  assert.ok(backHrefs.length > 0, "web pages should be linked from the back");
  for (const href of backHrefs) {
    assert.ok(
      href.startsWith("http://") || href.startsWith("https://"),
      `a back link must be a web URL, got ${href}`,
    );
  }
  // The back's page titles come from the record's own provenance.
  for (const title of Object.values(PAGE_TITLES)) {
    if (backLines.some((line) => line.includes(title))) continue;
    console.log(`(no piece came from "${title}", which is fine)`);
  }
  await page.screenshot({ path: `${evidence}/14-card-back.png` });
  await card.getByRole("button", { name: "turn it back over" }).click();
  await page.waitForTimeout(1200);
  assert.equal(
    await card.locator(".collage-card__leaf--over").count(),
    0,
    "the button on the back should turn the card face up",
  );

  // ========================================= reaching a piece under a pile
  // Three pieces stacked on one spot, so a click has somewhere to dig.
  await backToHistory();
  await openStudio();
  for (let index = 0; index < 3; index += 1) {
    await placeFromTray("pics", index);
  }
  assert.equal(await page.locator(".collage-piece").count(), 3);
  const pileFrame = await page.locator(".collage-frame").boundingBox();
  const pileAt = {
    x: pileFrame.x + pileFrame.width * 0.5,
    y: pileFrame.y + pileFrame.height * 0.5,
  };
  // Drag each onto the same spot so all three overlap there.
  for (let index = 0; index < 3; index += 1) {
    const boxes = await page
      .locator(".collage-piece")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().toJSON()),
      );
    const from = boxes[index];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(pileAt.x, pileAt.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  /** The z of whatever is selected, and how many pieces sit under the pile. */
  const selectedZ = () =>
    page.evaluate(() => {
      const node = document.querySelector(".collage-piece--selected");
      return node ? parseInt(getComputedStyle(node).zIndex, 10) : null;
    });
  await page.locator(".collage-frame").click({ position: { x: 6, y: 6 } });
  await page.waitForTimeout(300);

  // Clicking the same spot walks down the pile and wraps back to the top.
  const walked = [];
  for (let click = 0; click < 4; click += 1) {
    await page.mouse.click(pileAt.x, pileAt.y);
    await page.waitForTimeout(350);
    walked.push(await selectedZ());
  }
  console.log("z of the selection on four clicks at one spot:", walked);
  assert.equal(walked[0], 3, "the first click should take the top piece");
  assert.equal(walked[1], 2, "clicking again should reach the middle piece");
  assert.equal(walked[2], 1, "a third click should reach the bottom piece");
  assert.equal(walked[3], 3, "a fourth click should wrap back to the top");

  // Digging never restacks anything.
  const zAfterDigging = await page
    .locator(".collage-piece")
    .evaluateAll((nodes) =>
      nodes.map((node) => parseInt(getComputedStyle(node).zIndex, 10)).sort(),
    );
  assert.deepEqual(
    zAfterDigging,
    [1, 2, 3],
    "selecting through a pile must not reorder it",
  );

  // A drag still moves the piece in hand rather than digging under it.
  const beforeDrag = await selectedZ();
  await page.mouse.move(pileAt.x, pileAt.y);
  await page.mouse.down();
  await page.mouse.move(pileAt.x + 70, pileAt.y + 50, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(
    await selectedZ(),
    beforeDrag,
    "a drag must move the selected piece, not select a deeper one",
  );
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(400);

  // The hover outline marks what a click would take. It is only a hint about
  // a piece not already in hand, so nothing is selected for this check.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".collage-piece--selected").count(), 0);
  await page.mouse.move(pileAt.x - 200, pileAt.y - 200);
  await page.waitForTimeout(300);
  await page.mouse.move(pileAt.x, pileAt.y, { steps: 6 });
  await page.waitForTimeout(400);
  const hover = await page.evaluate(() => {
    const outline = document.querySelector(".collage-piece-hover");
    if (!outline) return null;
    const style = outline.getAttribute("style") || "";
    const read = (name) =>
      parseFloat(
        (style.match(new RegExp(`(?:^|;)\\s*${name}:\\s*([-\\d.]+)`)) || [])[1],
      );
    const top = [...document.querySelectorAll(".collage-piece")]
      .map((node) => ({
        z: parseInt(getComputedStyle(node).zIndex, 10),
        left: parseFloat((node.getAttribute("style").match(/left:\s*([-\d.]+)/) ?? [])[1]),
      }))
      .sort((a, b) => b.z - a.z)[0];
    return { left: read("left"), top: read("top"), frontmostLeft: top.left };
  });
  console.log("hover outline:", hover);
  assert.ok(hover, "a hovered piece should show the faint outline");
  assert.ok(
    Math.abs(hover.left - hover.frontmostLeft) < 0.5,
    "the outline should mark the piece a click would actually take",
  );
  // It steps aside once that piece is the one in hand.
  await page.mouse.click(pileAt.x, pileAt.y);
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-piece-hover").count(),
    0,
    "the hint should go once that piece is selected",
  );

  // Right-click lists the whole pile, front to back, and picking selects.
  await page.mouse.click(pileAt.x, pileAt.y, { button: "right" });
  await page.waitForTimeout(500);
  await page.waitForSelector(".collage-here");
  const listed = await page
    .locator(".collage-here__row")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent || "").trim()),
    );
  console.log("pieces here:", listed);
  assert.equal(listed.length, 3, "the menu should list all three pieces");
  for (const row of listed) {
    assert.ok(
      row.includes("127.0.0.1"),
      `each row should name where it came from, got "${row}"`,
    );
  }
  assert.equal(
    await page.locator(".collage-here__thumb").count(),
    3,
    "each row should carry a thumbnail",
  );
  await page.screenshot({ path: `${evidence}/09-pieces-here.png` });
  // The last row is the bottom of the pile; picking it selects that piece.
  await page.locator(".collage-here__row").last().click();
  await page.waitForTimeout(450);
  assert.equal(
    await page.locator(".collage-here").count(),
    0,
    "picking should close the menu",
  );
  assert.equal(
    await selectedZ(),
    1,
    "picking the last row should select the bottom piece",
  );

  // Escape closes the menu, and bare frame opens nothing.
  await page.mouse.click(pileAt.x, pileAt.y, { button: "right" });
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".collage-here").count(), 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-here").count(),
    0,
    "escape should close the pieces-here menu",
  );
  await page.mouse.click(pileFrame.x + 8, pileFrame.y + 8, { button: "right" });
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".collage-here").count(),
    0,
    "right-clicking bare frame should open nothing",
  );

  // The comma and period keys step down and up the stack without restacking.
  await page.mouse.click(pileAt.x, pileAt.y);
  await page.waitForTimeout(350);
  const steppedFrom = await selectedZ();
  await page.keyboard.press(",");
  await page.waitForTimeout(300);
  const steppedDown = await selectedZ();
  await page.keyboard.press(".");
  await page.waitForTimeout(300);
  const steppedBack = await selectedZ();
  console.log("stack stepping:", steppedFrom, steppedDown, steppedBack);
  assert.notEqual(steppedDown, steppedFrom, ", should step to another piece");
  assert.equal(steppedBack, steppedFrom, ". should step back again");

  // The peek ties each tag to its piece with an outline.
  await page.keyboard.down("i");
  await page.waitForTimeout(600);
  const peekPairs = await page.evaluate(() => {
    const edges = [...document.querySelectorAll(".collage-peek-edge")];
    const tags = [...document.querySelectorAll(".collage-peek")];
    const boxes = tags.map((node) => node.getBoundingClientRect());
    let overlapping = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (
          a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom
        ) {
          overlapping += 1;
        }
      }
    }
    return {
      edges: edges.length,
      tags: tags.length,
      solid: edges.filter(
        (node) => getComputedStyle(node).borderTopStyle === "solid",
      ).length,
      dotted: edges.filter(
        (node) => getComputedStyle(node).borderTopStyle === "dotted",
      ).length,
      overlapping,
    };
  });
  console.log("peek over a pile:", peekPairs);
  assert.equal(peekPairs.edges, 3, "every piece should get an outline");
  assert.equal(peekPairs.tags, 3, "every piece should get a tag");
  assert.equal(
    peekPairs.solid,
    1,
    "only the hovered piece's outline should be solid",
  );
  assert.equal(peekPairs.dotted, 2, "the rest should stay dotted");
  assert.equal(
    peekPairs.overlapping,
    0,
    "no two tags may sit on top of each other",
  );
  await page.screenshot({ path: `${evidence}/09b-peek-over-a-pile.png` });
  await page.keyboard.up("i");
  await page.waitForTimeout(300);
  await backToHistory();

  // =========================================================== duplicating
  await backToHistory();
  const before = await storedCollages();
  const original = before.find((row) => row.title === "one of each");
  assert.ok(original, "the mixed collage should be in the drawer to copy");
  const toCopy = page
    .locator(".collage-card")
    .filter({ hasText: "one of each" })
    .first();
  await toCopy.getByRole("button", { name: "duplicate" }).click();
  await page.waitForTimeout(1500);

  const afterCopy = await storedCollages();
  const copy = afterCopy.find((row) => row.title === "one of each copy");
  console.log("the copy:", copy);
  assert.ok(copy, "duplicating should store a collage named as a copy");
  assert.equal(
    afterCopy.length,
    before.length + 1,
    "duplicating should add exactly one collage",
  );
  assert.notEqual(copy.id, original.id, "the copy is a separate collage");
  assert.equal(
    copy.pieces,
    original.pieces,
    "the copy should hold the same number of pieces",
  );
  assert.deepEqual(
    copy.firstPiece,
    original.firstPiece,
    "the copy should hold the same arrangement",
  );
  assert.equal(
    copy.drawn,
    original.drawn,
    "the copy should carry the original's picture",
  );
  // The copy is at the top of the list, so it is there to open straight away.
  const firstCardTitle = await page
    .locator(".collage-card__title")
    .first()
    .textContent();
  console.log("first card after duplicating:", firstCardTitle.trim());
  assert.equal(firstCardTitle.trim(), "one of each copy");
  await page.screenshot({ path: `${evidence}/18-duplicated.png` });

  // Editing the copy must not reach back into the collage it came from.
  await page
    .locator(".collage-card")
    .filter({ hasText: "one of each copy" })
    .first()
    .getByRole("button", { name: "keep editing" })
    .click();
  await page.waitForTimeout(2500);
  await selectByTab();
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  await page.locator(".collage-title-input").fill("the copy, moved");
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(4000);

  const afterEdit = await storedCollages();
  const editedCopy = afterEdit.find((row) => row.id === copy.id);
  const untouched = afterEdit.find((row) => row.id === original.id);
  console.log("after editing the copy:", { editedCopy, untouched });
  assert.equal(editedCopy.title, "the copy, moved");
  assert.ok(
    editedCopy.firstPiece.x > original.firstPiece.x,
    "the copy should have moved",
  );
  assert.equal(
    untouched.title,
    "one of each",
    "the original's title must be untouched",
  );
  assert.deepEqual(
    untouched.firstPiece,
    original.firstPiece,
    "the original's arrangement must be untouched",
  );
  assert.equal(
    untouched.updatedAt,
    original.updatedAt,
    "the original must not even have been rewritten",
  );
  await backToHistory();

  // ====================================== a collage whose picture never drew
  // A first-ever bake that fails stores the arrangement with no preview, and
  // the history draws a quiet face rather than breaking.
  missingPhotoGone = true;
  await openStudio();
  await page.getByRole("button", { name: "pics", exact: true }).click();
  await page.waitForTimeout(400);
  const imageSlots = page.locator(".collage-tray__slot");
  let placedMissing = false;
  for (let index = 0; index < (await imageSlots.count()); index += 1) {
    const alt = await imageSlots
      .nth(index)
      .locator("img")
      .first()
      .getAttribute("alt")
      .catch(() => null);
    if (alt === "Collected artwork third") {
      await imageSlots.nth(index).click();
      placedMissing = true;
      break;
    }
  }
  assert.ok(placedMissing, "the vanishing photo should be in the tray");
  await page.locator(".collage-title-input").fill("never drawn");
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(8000);
  const undrawn = (await storedCollages()).find(
    (row) => row.title === "never drawn",
  );
  console.log("a collage whose first bake failed:", undrawn);
  const undrawnStanding = await standing();
  console.log("standing with no preview at all:", undrawnStanding);
  assert.ok(undrawn, "the arrangement must be stored even with no picture");
  assert.equal(
    undrawn.drawn,
    false,
    "a first bake that failed stores the explicit no-preview variant",
  );
  assert.ok(
    undrawnStanding.includes("preview out of date"),
    `the status should name the preview problem, got "${undrawnStanding}"`,
  );
  await backToHistory();
  const undrawnCard = page
    .locator(".collage-card")
    .filter({ hasText: "never drawn" })
    .first();
  assert.equal(
    await undrawnCard.locator(".collage-card__thumb--undrawn").count(),
    1,
    "the history should draw a quiet no-preview face",
  );
  await page.screenshot({ path: `${evidence}/15-no-preview-card.png` });
  missingPhotoGone = false;

  // ============================================ the real export, when provided
  if (!exportPath) {
    console.log(
      "SKIPPED: the real-export section needs SCRAPS_EXPORT to point at a scraps export",
    );
  } else {
    console.log(`running the real-export section against ${exportPath}`);
    // The export is folded in through the extension's own IMPORT_EVENTS path,
    // so the records get the canonical keys, encounter grouping and identity a
    // collected scrap would have. An export carries what a scrap is and where
    // it came from, not who held it, so this browser's identity is supplied.
    const exported = JSON.parse(await readFile(exportPath, "utf8"));
    assert.ok(
      Array.isArray(exported.scraps),
      "the scraps export should carry a scraps list",
    );
    // Identity lives with the service worker, which is where the extension
    // generates it. The scraps above were collected under it, so the imported
    // records are held by the same participant rather than a stranger.
    const identity = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("playerIdentity");
      return {
        pid: stored.playerIdentity?.public ?? null,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    });
    assert.ok(identity.pid, "the browser should already hold a player identity");
    const events = exported.scraps.map((record, index) => {
      assert.ok(
        record && typeof record.id === "string" && record.kind,
        `scraps export record ${index} is not a scrap`,
      );
      const { id, ts, domain, pageUrl, ...data } = record;
      return {
        id,
        type: "element",
        ts,
        data,
        meta: {
          pid: identity.pid,
          sid: `sid_${"0".repeat(8)}-import`,
          url: pageUrl,
          vw: 1280,
          vh: 900,
          tz: identity.tz,
        },
        domain,
      };
    });
    const payload = gzipSync(
      Buffer.from(
        JSON.stringify({
          version: 1,
          exportedAt: Date.now(),
          events,
          identity: null,
        }),
      ),
    );
    const openedAt = Date.now();
    const result = await page.evaluate(
      async (bytes) =>
        await chrome.runtime.sendMessage({
          type: "IMPORT_EVENTS",
          data: bytes,
        }),
      Array.from(payload),
    );
    const exportLoadedMs = Date.now() - openedAt;
    assert.ok(result?.success, `the import failed: ${result?.error}`);
    const exportedCount = (result.imported ?? 0) + (result.alreadyHeld ?? 0);
    console.log(
      `the export carries ${exportedCount} scraps (${result.imported} new, ${result.alreadyHeld} already held)`,
    );
    assert.ok(
      exportedCount > 100,
      `expected a substantial export, got ${exportedCount} scraps`,
    );
    // The page picks the new collection up through its usual refresh path.
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "create", exact: true }).click();
    await page.waitForTimeout(600);
    await openStudio();
    const trayStart = Date.now();
    await page.waitForSelector(".collage-tray__slot", { timeout: 60_000 });
    const firstTrayPaintMs = Date.now() - trayStart;
    console.log(
      `export loaded in ${exportLoadedMs}ms; first tray paint ${firstTrayPaintMs}ms`,
    );
    assert.ok(
      firstTrayPaintMs < 5000,
      `the tray should paint quickly, took ${firstTrayPaintMs}ms`,
    );

    // The drawer must stay windowed even against five thousand scraps, at
    // every size, and it is measured with nothing placed yet.
    for (const size of ["small", "medium", "large"]) {
      await page.getByRole("button", { name: `Show scraps ${size}` }).click();
      await page.waitForTimeout(700);
      const mounted = await page.locator(".collage-tray__slot").count();
      console.log(`tray slots mounted at ${size}:`, mounted);
      assert.ok(
        mounted < 200,
        `the drawer is not windowed at ${size}: ${mounted} slots`,
      );
      assert.ok(mounted > 0, `the drawer should show something at ${size}`);
    }
    await page.getByRole("button", { name: "Show scraps medium" }).click();
    await page.waitForTimeout(700);

    // Thumbnails keep their own proportions rather than being letterboxed
    // into squares, and they are laid out as columns rather than a grid.
    const masonry = await page.evaluate(() => {
      const slots = [...document.querySelectorAll(".collage-tray__slot")];
      const rows = slots.map((slot) => {
        const box = slot.getBoundingClientRect();
        const image = slot.querySelector("img.scrap-collage__image");
        return {
          width: box.width,
          height: box.height,
          left: Math.round(box.left),
          // Only a picture takes its height from its own pixels; a small
          // thing sits in a fixed box instead, so it is not measured here.
          naturalWidth: image?.naturalWidth ?? 0,
          naturalHeight: image?.naturalHeight ?? 0,
        };
      });
      return {
        columns: new Set(rows.map((row) => row.left)).size,
        widths: new Set(rows.map((row) => Math.round(row.width))).size,
        heights: new Set(rows.map((row) => Math.round(row.height))).size,
        aspects: rows
          .filter((row) => row.naturalWidth > 0 && row.naturalHeight > 0)
          .map((row) => ({
            shown: row.height,
            wanted: (row.width * row.naturalHeight) / row.naturalWidth,
          })),
      };
    });
    console.log("drawer masonry:", {
      columns: masonry.columns,
      distinctWidths: masonry.widths,
      distinctHeights: masonry.heights,
      measured: masonry.aspects.length,
    });
    assert.equal(masonry.columns, 3, "the drawer should run three columns");
    assert.equal(
      masonry.widths,
      1,
      "every column should be the same width",
    );
    assert.ok(
      masonry.heights > 1,
      "thumbnails should vary in height rather than being squares",
    );
    assert.ok(masonry.aspects.length > 0, "some pictures should have loaded");
    for (const aspect of masonry.aspects) {
      assert.ok(
        Math.abs(aspect.shown - aspect.wanted) <= 1,
        `a thumbnail's height should match its aspect within 1px, got ${aspect.shown} against ${aspect.wanted}`,
      );
    }
    await page.screenshot({ path: `${evidence}/16-real-export-tray.png` });

    for (let index = 0; index < 30; index += 1) {
      await page.locator(".collage-tray__slot").nth(index % 12).click();
    }
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(".collage-piece").count(), 30);
    await page.locator(".collage-title-input").fill("thirty from the export");
    const bakeStart = Date.now();
    await page.keyboard.press("Meta+s");
    await waitForStored(
      "thirty pieces from the export to be drawn and stored",
      (rows) =>
        rows.some(
          (row) =>
            row.title === "thirty from the export" &&
            row.pieces === 30 &&
            row.drawn,
        ),
      240_000,
    );
    const big = (await storedCollages()).find(
      (row) => row.title === "thirty from the export",
    );
    console.log(
      `thirty from the export drew in ${Date.now() - bakeStart}ms:`,
      big,
    );
    assert.equal(big.pieces, 30, "all thirty pieces should have been stored");
    assert.ok(
      big.previewBytes > 10_000,
      `the thirty-piece bake should be a real PNG, got ${big.previewBytes} bytes`,
    );
    await page.screenshot({ path: `${evidence}/17-real-export-thirty.png` });
    await backToHistory();
  }

  // NOTE: Playwright dispatches key events straight into the page, bypassing
  // the browser's own accelerator handling, so key assertions here CANNOT
  // catch a binding the browser reserves for itself (Cmd+Shift+[ switching
  // tabs, Cmd+[ going back). Keeping studio bindings off reserved accelerators
  // is done by construction; `RESERVED_ACCELERATORS` in studioKeymap.ts and its
  // unit test are the guard.

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
  console.log(
    JSON.stringify({
      result: "passed",
      collages: (await storedCollages()).length,
      realExport: exportPath ? "run" : "skipped",
      evidence,
    }),
  );
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
