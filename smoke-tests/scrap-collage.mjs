// ABOUTME: Verifies the scrap collage create mode end to end in isolated Chromium.
// ABOUTME: Covers every scrap kind through the bake, autosave, the source peek, and the card's back.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
 * Each page carries one of every scrap kind: a photo, a styled button with an
 * inner icon, a standalone inline svg icon, and an element with a custom
 * cursor. The button's background is a gradient and its font-family is quoted,
 * so the bake's XML escaping is exercised with real captured styles.
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
<svg class="badge" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="4"/><path d="M14 24l7 7 13-14" fill="none" stroke="currentColor" stroke-width="4"/></svg>
<div class="cursorzone">hover me</div>
</body></html>`;
}

const PAGE_TITLES = {
  first: "Ceramics journal",
  second: "Objects worth keeping",
  third: "Studio references",
};

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
const extension = resolve(workspace, "extension/dist/chrome-mv3-dev");
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
    await visit.goto(`${origin}/${slug}`, { waitUntil: "load" });
    await visit.waitForTimeout(1500);
    await visit.hover(".cursorzone");
    await visit.mouse.move(300, 300);
    await visit.waitForTimeout(700);
    await visit.hover("button.fancy");
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
  for (const kind of ["image", "button", "svg-icon", "cursor"]) {
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
  for (const kind of ["pics", "btns", "icons", "curs"]) {
    await placeFromTray(kind, 0);
  }
  assert.equal(await page.locator(".collage-piece").count(), 4);

  // Spread the four pieces out so each occupies its own part of the frame.
  const spots = await page.evaluate(() =>
    [...document.querySelectorAll(".collage-piece")].map((node) =>
      node.getBoundingClientRect().toJSON(),
    ),
  );
  const frameBox = await page.locator(".collage-frame").boundingBox();
  const targets = [
    { x: 0.25, y: 0.28 },
    { x: 0.72, y: 0.28 },
    { x: 0.25, y: 0.72 },
    { x: 0.72, y: 0.72 },
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
    return {
      pieceCount: record.pieces.length,
      previewType: record.preview.image.type,
      previewBytes: record.preview.image.size,
      width: bitmap.width,
      height: bitmap.height,
      samples,
      bytes: [...new Uint8Array(await record.preview.image.arrayBuffer())],
    };
  });
  await writeFile(`${evidence}/11-baked-preview.png`, Buffer.from(baked.bytes));
  delete baked.bytes;
  console.log("baked:", JSON.stringify(baked, null, 2));
  assert.equal(baked.pieceCount, 4);
  assert.equal(baked.previewType, "image/png");
  assert.equal(baked.width, 3000);
  assert.equal(baked.height, 2000);
  for (const sample of baked.samples) {
    assert.ok(
      sample.painted > 0,
      `the baked ${sample.kind} drew nothing but frame background`,
    );
  }

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
    const openedAt = Date.now();
    await page.locator('input[type="file"]').setInputFiles(exportPath);
    // The chip names how many scraps came out of the file, so the wait is on
    // a real count rather than on the word, which the page may already carry.
    const exportChip = page.locator(".collage-chip", { hasText: /export · \d+/ });
    await exportChip.waitFor({ timeout: 120_000 });
    const exportLoadedMs = Date.now() - openedAt;
    const exportedCount = Number(
      (await exportChip.textContent()).match(/\d+/)[0],
    );
    console.log(`the export carries ${exportedCount} scraps`);
    assert.ok(
      exportedCount > 100,
      `expected a substantial export, got ${exportedCount} scraps`,
    );
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

    // The drawer must stay windowed even against five thousand scraps, so it
    // is measured with the whole export in it and nothing placed yet.
    const mounted = await page.locator(".collage-tray__slot").count();
    console.log("tray slots mounted against the real export:", mounted);
    assert.ok(mounted < 200, `the drawer is not windowed: ${mounted} slots`);
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
