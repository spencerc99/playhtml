// ABOUTME: End-to-end check of searching scraps by meaning in the built extension, in isolated Chromium.
// ABOUTME: Collects real picture scraps from local pages, downloads the model through the scraps page, and searches.
//
// Needs the SigLIP model files on disk (MEANING_MODEL_DIR, laid out like the
// Hugging Face repo) and a self-signed certificate for huggingface.co
// (MEANING_TLS_DIR with key.pem and cert.pem): the test serves the model in
// place of huggingface.co, so the extension's real download path runs.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension =
  process.env.EXTENSION_DIR || resolve(workspace, "extension/dist/chrome-mv3");
const modelDir = process.env.MEANING_MODEL_DIR;
const siteDir = process.env.MEANING_SITE_DIR;
const evidence = process.env.MEANING_EVIDENCE_DIR || "/tmp/meaning-evidence";
assert.ok(modelDir && siteDir, "set MEANING_MODEL_DIR and MEANING_SITE_DIR");
await mkdir(evidence, { recursive: true });

const pictures = (await readdir(siteDir))
  .filter((name) => name.endsWith(".png"))
  .sort();
const perPage = 4;
/** Scraps are keyed by their picture's SHA-256, so keys name the files. */
const nameByKey = new Map();
for (const name of pictures) {
  const hash = createHash("sha256")
    .update(await readFile(join(siteDir, name)))
    .digest("hex");
  nameByKey.set(`image:sha256:${hash}`, name);
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://x");
  if (url.pathname.endsWith(".png")) {
    response.setHeader("content-type", "image/png");
    response.end(await readFile(join(siteDir, url.pathname.slice(1))));
    return;
  }
  const page = Number(url.pathname.slice(1)) || 0;
  const shown = pictures.slice(page * perPage, page * perPage + perPage);
  response.setHeader("content-type", "text/html");
  // Neutral titles and alt text, so only the pictures themselves can match.
  response.end(
    `<!doctype html><title>Catalog page ${page}</title><style>body{margin:30px;background:#faf9f6;font:16px sans-serif}div{display:flex;gap:20px;flex-wrap:wrap}img{width:260px;height:220px;object-fit:contain;background:#fff}</style><h1>Catalog page ${page}</h1><div>${shown
      .map((name) => `<img alt="item" src="/${name}">`)
      .join("")}</div>`,
  );
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

let modelBytesServed = 0;
const tlsDir = process.env.MEANING_TLS_DIR;
assert.ok(tlsDir, "set MEANING_TLS_DIR");
const modelServer = createTlsServer(
  {
    key: await readFile(join(tlsDir, "key.pem")),
    cert: await readFile(join(tlsDir, "cert.pem")),
  },
  async (request, response) => {
    const match = new URL(request.url, "https://x").pathname.match(
      /^\/Xenova\/siglip-base-patch16-224\/resolve\/[^/]+\/(.+)$/,
    );
    try {
      const body = await readFile(join(modelDir, match[1]));
      modelBytesServed += body.length;
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": body.length,
        "access-control-allow-origin": "*",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  },
);
await new Promise((ok) => modelServer.listen(0, "127.0.0.1", ok));
const modelPort = modelServer.address().port;
const profile = await mkdtemp(resolve(tmpdir(), "wwo-meaning-"));
const pageErrors = [];
async function launch() {
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : { channel: "chromium" }),
    headless: true,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--disable-background-networking",
      `--host-resolver-rules=MAP huggingface.co:443 127.0.0.1:${modelPort}`,
      "--ignore-certificate-errors",
      "--no-proxy-server",
    ],
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:" || url.hostname === "127.0.0.1")
      return route.continue();
    if (url.hostname === "huggingface.co") return route.continue();
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (process.env.MEANING_DEBUG || message.type() === "error")
        console.log(
          `[console ${message.type()}]`,
          message.text().slice(0, 400),
        );
    });
    page.on("worker", (worker) =>
      console.log("[worker started]", worker.url()),
    );
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  return {
    context,
    worker,
    extensionOrigin: `chrome-extension://${new URL(worker.url()).host}`,
  };
}

/** The scrap pictures the archive shows, as their file names, in order. */
async function shownPictures(page) {
  const keys = await page.evaluate(() =>
    [...document.querySelectorAll(".scraps-stage [data-scrap-key]")].map(
      (tile) => tile.getAttribute("data-scrap-key"),
    ),
  );
  return [...new Set(keys.map((key) => nameByKey.get(key) ?? key))];
}

let { context, worker, extensionOrigin } = await launch();
try {
  await worker.evaluate(async () =>
    chrome.storage.local.set({
      wwoFeatureAccess: {
        features: {
          SCRAPS: { stage: "beta", available: true },
          SCRAP_MEANING_SEARCH: { stage: "beta", available: true },
        },
        checkedAt: Date.now(),
      },
      wwoFeatureOverrides: { SCRAPS: true },
      collection_mode_cursor: "off",
      collection_mode_navigation: "off",
      collection_mode_viewport: "off",
      collection_mode_keyboard: "off",
    }),
  );

  // Collect the pictures the ordinary way: by looking at pages.
  const pageCount = Math.ceil(pictures.length / perPage);
  for (let index = 0; index < pageCount; index++) {
    const visit = await context.newPage();
    await visit.goto(`${origin}/${index}`, { waitUntil: "load" });
    await visit.waitForTimeout(4000);
    await visit.close();
  }
  await new Promise((ok) => setTimeout(ok, 2000));

  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  if (process.env.MEANING_DEBUG)
    await page.evaluate(() =>
      localStorage.setItem("scraps-meaning-debug", "1"),
    );
  await page
    .getByRole("button", { name: "archive", exact: true })
    .click({ timeout: 20000 });
  const offer = page.getByRole("button", {
    name: /search by what's in pictures/,
  });
  await expect(offer).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${evidence}/1-offer.png` });

  await offer.click();
  await expect(
    page.getByText(/downloads a picture-reading model/),
  ).toBeVisible();
  await page.screenshot({ path: `${evidence}/2-download-explained.png` });
  await page.getByRole("button", { name: "download", exact: true }).click();

  await expect(
    page.getByText(
      /downloading model|getting the model ready|reading pictures/,
    ),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `${evidence}/3-downloading.png` });
  const watch = setInterval(async () => {
    const line = await page
      .locator(".meaning-search")
      .textContent()
      .catch(() => "?");
    console.log("[status]", line, "served", modelBytesServed);
  }, 10000);
  await expect(
    page.getByText(
      /reading pictures|searching by what's in pictures too|could not load/,
    ),
  ).toBeVisible({ timeout: 300000 });
  clearInterval(watch);
  assert.equal(
    await page.getByText(/could not load/).count(),
    0,
    "model loads",
  );
  await page.screenshot({ path: `${evidence}/4-reading.png` });
  const started = Date.now();
  await expect(
    page.getByText("searching by what's in pictures too"),
  ).toBeVisible({ timeout: 600000 });
  console.log(
    `read ${pictures.length} pictures in ${((Date.now() - started) / 1000).toFixed(1)}s; model bytes served ${modelBytesServed}`,
  );

  const search = page.getByRole("textbox", { name: "Search scraps" });
  const results = {};
  for (const query of ["shoe", "screw", "eye", "flag", "mask"]) {
    await search.fill(query);
    await page.waitForTimeout(1500);
    results[query] = await shownPictures(page);
    console.log(query, results[query]);
    if (query === "shoe" || query === "eye" || query === "mask")
      await page.screenshot({ path: `${evidence}/5-search-${query}.png` });
  }
  const shoes = ["img-01.png", "img-02.png", "img-03.png"];
  assert.ok(
    results.shoe.length >= 2 &&
      results.shoe.every((name) => shoes.includes(name)),
    "shoe finds shoes and only shoes",
  );
  assert.ok(
    results.screw
      .slice(0, 3)
      .every((name) =>
        ["img-04.png", "img-05.png", "img-06.png"].includes(name),
      ),
    "screws first",
  );
  assert.equal(results.eye[0], "img-07.png", "eye finds the googly eyes first");
  assert.equal(results.flag[0], "img-09.png", "flag finds the flag first");
  assert.equal(results.mask.length, 0, "nothing matches mask");

  // Cold start: a reopened browser uses the kept model and vectors.
  await context.close();
  modelBytesServed = 0;
  ({ context, worker, extensionOrigin } = await launch());
  const again = await context.newPage();
  await again.goto(`${extensionOrigin}/scraps.html`, { waitUntil: "load" });
  await again
    .getByRole("button", { name: "archive", exact: true })
    .click({ timeout: 20000 });
  await expect(
    again.getByText("searching by what's in pictures too"),
  ).toBeVisible({ timeout: 120000 });
  await again.getByRole("textbox", { name: "Search scraps" }).fill("shoe");
  await again.waitForTimeout(1500);
  assert.deepEqual(
    await shownPictures(again),
    results.shoe,
    "shoe search works after restart",
  );
  console.log(
    `after restart, model bytes downloaded again: ${modelBytesServed}`,
  );
  assert.equal(modelBytesServed, 0, "the model is not downloaded twice");

  // Remove gives the space back and returns to the offer.
  await again.getByRole("button", { name: "remove" }).click();
  await expect(
    again.getByRole("button", { name: /search by what's in pictures/ }),
  ).toBeVisible();
  const cacheLeft = await again.evaluate(
    async () => (await caches.keys()).length,
  );
  assert.equal(cacheLeft, 0, "model files deleted");
  await again.screenshot({ path: `${evidence}/6-removed.png` });

  assert.deepEqual(pageErrors, [], "no page errors");
  console.log("PASS");
} finally {
  await context.close().catch(() => {});
  server.close();
  modelServer.close();
}
