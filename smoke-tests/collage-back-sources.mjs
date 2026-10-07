// ABOUTME: Verifies the back of a collage in the built studio: sites with their pieces, in every format.
// ABOUTME: Imports exported collage files, turns each over, waits for its pieces, and checks the exported back.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { chromium } from "@playwright/test";

// Collage files exported from the studio ("save as a file"). They hold real
// browsing material, so they are passed in rather than kept in the repo.
const sources = (process.env.COLLAGE_FILES || "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
if (sources.length === 0) {
  throw new Error("Set COLLAGE_FILES to a comma-separated list of exported .collage.json files");
}
const extension = resolve(process.env.SCRAPS_EXTENSION_DIR || "extension/dist/chrome-mv3");
const evidence = resolve(process.env.COLLAGE_EVIDENCE_DIR || "/private/tmp/collage-back-evidence");
await mkdir(evidence, { recursive: true });

const FORMATS = {
  postcard: { width: 1500, height: 1000 },
  square: { width: 1200, height: 1200 },
  "postcard-tall": { width: 1000, height: 1500 },
  wide: { width: 1600, height: 900 },
};

const envelopes = await Promise.all(
  sources.map(async (path) => ({ name: basename(path, ".collage.json"), envelope: JSON.parse(await readFile(path, "utf8")) })),
);

/** One collage file per case: a source collage, or all of them merged, at a format and title. */
async function caseFile(index, { from, format, title }) {
  const chosen = from === "all" ? envelopes : [envelopes[from]];
  const base = structuredClone(chosen[0].envelope);
  base.collage.pieces = chosen.flatMap(({ envelope }, n) =>
    envelope.collage.pieces.map((piece) => ({ ...piece, id: `${piece.id}-${n}` })),
  );
  base.collage.format = format;
  base.collage.frame = FORMATS[format];
  base.collage.title = title;
  const path = resolve(evidence, `case-${index}.collage.json`);
  await writeFile(path, JSON.stringify(base));
  return path;
}

const CASES = [
  { from: 0, format: "postcard", title: "back check postcard" },
  { from: 0, format: "postcard-tall", title: "back check tall" },
  { from: envelopes.length > 1 ? 1 : 0, format: "square", title: "back check square" },
  {
    from: "all",
    format: "wide",
    title: "back check wide: everything from the week we started building the shed, plus a few buttons i liked",
  },
];

const profile = await mkdtemp(resolve(tmpdir(), "collage-back-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: "chromium",
  viewport: { width: 1600, height: 1200 },
  acceptDownloads: true,
  // Piece pictures and favicons load from the web as they do for a person, but
  // the extension's own server is unreachable, so the feature check cannot
  // switch the collage views back off and nothing is sent. This is done at the
  // resolver, not with request interception, which breaks cross-origin fetches.
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--host-resolver-rules=MAP playhtml-game-api.spencerc99.workers.dev ~NOTFOUND",
  ],
});
const results = [];
try {
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
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().startsWith("[collage back]")) console.log(message.text());
  });

  // The collage views appear once there is at least one scrap to make with.
  await page.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  await page.getByText("internet scraps").first().waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const request = indexedDB.open("collection_events_db");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((done, reject) => {
        const tx = db.transaction("events", "readwrite");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#4a9a8a"/></svg>`;
        tx.objectStore("events").put({
          id: "back-check-scrap",
          type: "element",
          ts: Date.now(),
          domain: "example.test",
          meta: { url: "https://example.test/page", pid: "fixture", sid: "fixture", vw: 1440, vh: 900, tz: "UTC" },
          data: {
            kind: "image",
            src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
            naturalWidth: 160,
            naturalHeight: 120,
            pageTitle: "Swatch",
          },
        });
        tx.oncomplete = done;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

  for (const [index, spec] of CASES.entries()) {
    const file = await caseFile(index, spec);
    // The collage list has an address of its own; a reload makes each case start fresh.
    await page.goto(`${extensionOrigin}/scraps.html#create`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page
      .getByRole("button", { name: "import a collage file" })
      .waitFor()
      .catch(async (error) => {
        await page.screenshot({ path: `${evidence}/failed-${index + 1}.png` });
        console.log(await page.locator("body").innerText());
        throw error;
      });
    await page.getByLabel("collage file to open").setInputFiles(file);
    await page.getByRole("button", { name: `Open ${spec.title}`, exact: true }).click();
    await page.locator(".collage-studio").waitFor();

    await page.getByRole("button", { name: "Turn the collage over" }).click();
    const back = page.locator(".collage-back");
    await back.locator(".collage-back__site").first().waitFor();
    // Every piece settles into a drawn picture or an outline; none stays pending.
    await page.waitForFunction(
      () => document.querySelectorAll(".collage-back .collage-back__piece--pending").length === 0,
      undefined,
      { timeout: 60_000 },
    );
    // Favicons settle too: each is a picture or the empty ring, none still loading.
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll(".collage-back span.collage-back__favicon")].every((mark) =>
            mark.classList.contains("collage-back__favicon--none"),
          ),
        undefined,
        { timeout: 20_000 },
      )
      .catch(() => console.log("favicons still loading after 20s"));
    await page.waitForTimeout(800);

    const facts = await page.evaluate(() => {
      const sheet = document.querySelector(".collage-back__writing");
      const bounds = sheet.getBoundingClientRect();
      const scale = bounds.width / sheet.offsetWidth;
      const pad = parseFloat(getComputedStyle(sheet).paddingBottom) * scale;
      const inside = bounds.bottom - pad + 1;
      const parts = [...sheet.querySelectorAll(".collage-back__site, .collage-back__rest, .collage-back__maker")];
      const overflowing = parts.filter((part) => part.getBoundingClientRect().bottom > inside).length;
      const pieceCount = (text) => Number(/(\d+) pieces? from/.exec(text)?.[1] ?? NaN);
      const shown = document.querySelectorAll(".collage-back__piece").length;
      const extra = [...document.querySelectorAll(".collage-back__extra")].reduce(
        (sum, node) => sum + Number(node.textContent.slice(1)),
        0,
      );
      const strip = [...document.querySelectorAll(".collage-back__also")].reduce(
        (sum, node) => sum + Number(node.lastElementChild.textContent),
        0,
      );
      return {
        detail: document.querySelector(".collage-back__detail")?.textContent ?? "",
        total: pieceCount(document.querySelector(".collage-back__detail")?.textContent ?? ""),
        sites: document.querySelectorAll(".collage-back__site").length,
        rest: document.querySelectorAll(".collage-back__also").length,
        drawn: document.querySelectorAll("img.collage-back__piece").length,
        favicons: document.querySelectorAll(".collage-back img.collage-back__favicon").length,
        rings: document.querySelectorAll(".collage-back .collage-back__favicon--none").length,
        missing: document.querySelectorAll(".collage-back__piece--missing").length,
        shown,
        extra,
        strip,
        overflowing,
        ellipses: document.querySelector(".collage-back").innerHTML.includes("ellipsis"),
      };
    });
    await back.screenshot({ path: `${evidence}/${index + 1}-${spec.format}-studio-back.png` });

    // The exported back must be drawn from the same markup.
    const downloads = [];
    page.on("download", (download) => downloads.push(download));
    await page.getByRole("button", { name: "export png", exact: true }).click();
    await page.waitForFunction(() => true);
    for (let tries = 0; tries < 120 && downloads.length < 2; tries += 1) await page.waitForTimeout(500);
    page.removeAllListeners("download");
    const exported = downloads.find((download) => download.suggestedFilename().endsWith("back.png"));
    assert.ok(exported, "the export wrote a back");
    const exportedPath = `${evidence}/${index + 1}-${spec.format}-exported-back.png`;
    await exported.saveAs(exportedPath);
    const dimensions = await page.evaluate(async (bytes) => {
      const image = new Image();
      image.src = `data:image/png;base64,${bytes}`;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, (await readFile(exportedPath)).toString("base64"));

    const result = { case: `${spec.format}: ${spec.title}`, ...facts, exported: dimensions };
    results.push(result);
    console.log(JSON.stringify(result));

    assert.ok(facts.sites > 0, "the back lists sites");
    assert.equal(facts.shown + facts.extra + facts.strip, facts.total, "every piece is shown, counted as +N, or counted in the strip");
    assert.equal(facts.overflowing, 0, "nothing runs past the back's margin");
    assert.equal(facts.ellipses, false, "nothing is cut off with an ellipsis");
    assert.equal(dimensions.width, FORMATS[spec.format].width * 2);
    assert.equal(dimensions.height, FORMATS[spec.format].height * 2);
  }
  // The back can list page titles instead; the choice is the collage's own and
  // survives a reload.
  const openBack = async (name) => {
    await page.goto(`${extensionOrigin}/scraps.html#create`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
    await page.locator(".collage-studio").waitFor();
    await page.getByRole("button", { name: "Turn the collage over" }).click();
    await page.locator(".collage-back .collage-back__site").first().waitFor();
  };
  const titledName = CASES[0].title;
  await openBack(titledName);
  const titlesChoice = page.getByRole("group", { name: "The back lists" }).getByRole("button", { name: "titles" });
  assert.equal(await page.getByRole("button", { name: "Show sources" }).count(), 0, "the switch takes the sources place while turned over");
  await titlesChoice.click();
  await page.locator(".collage-back .collage-back__page").first().waitFor();
  const titleFacts = await page.evaluate(() => ({
    titles: document.querySelectorAll(".collage-back .collage-back__page").length,
    pieces: document.querySelectorAll(".collage-back .collage-back__piece").length,
    first: document.querySelector(".collage-back .collage-back__page")?.textContent ?? "",
  }));
  console.log(JSON.stringify({ case: "titles", ...titleFacts }));
  assert.ok(titleFacts.titles > 0, "the back lists page titles");
  assert.equal(titleFacts.pieces, 0, "no pieces are drawn in titles mode");
  await page.locator(".collage-back").screenshot({ path: `${evidence}/5-titles-studio-back.png` });
  await page.locator(".collage-views").screenshot({ path: `${evidence}/5-titles-switch.png` });
  // Let the autosave store the choice, then come back to it fresh.
  await page.waitForTimeout(4000);
  await openBack(titledName);
  assert.equal(
    await page.getByRole("group", { name: "The back lists" }).getByRole("button", { name: "titles" }).getAttribute("aria-pressed"),
    "true",
    "the collage remembers that its back lists titles",
  );
  assert.ok((await page.locator(".collage-back .collage-back__page").count()) > 0, "titles show again after a reload");
  const titleDownloads = [];
  page.on("download", (download) => titleDownloads.push(download));
  await page.getByRole("button", { name: "export png", exact: true }).click();
  for (let tries = 0; tries < 120 && titleDownloads.length < 2; tries += 1) await page.waitForTimeout(500);
  page.removeAllListeners("download");
  const titledBack = titleDownloads.find((download) => download.suggestedFilename().endsWith("back.png"));
  assert.ok(titledBack, "a titles back exports");
  await titledBack.saveAs(`${evidence}/5-titles-exported-back.png`);

  assert.deepEqual(errors, [], "the page threw no errors");
  console.log(`collage back verified for ${results.length} cases; evidence in ${evidence}`);
} finally {
  await context.close();
}
