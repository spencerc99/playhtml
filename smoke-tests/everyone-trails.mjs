// ABOUTME: Exercises the internal "everyone's trails" page overlay in Chromium with the built extension.
// ABOUTME: Opens it from the #wwo-trails hash against a loopback Worker and checks gating, trails, and hidden controls.

// Build first with `bun run build-extension`. A production build is required:
// development builds unlock every internal feature, which would hide the gate.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PORT = 18787;
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(workspace, "extension/dist/chrome-mv3");
const evidence = process.env.EVERYONE_TRAILS_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "wwo-everyone-trails-"));
const origin = `http://127.0.0.1:${PORT}`;
const PAGE_PATH = "/wiki/Trail_page";
const COLORS = ["#e04488", "#2d7d6f", "#3d5a98"];

let everyoneAvailable = false;
const recentRequests = [];

/** Three participants' cursor paths across the page, as /events/recent returns them. */
function fixtureEvents() {
  const now = Date.now() - 60 * 60 * 1000;
  const events = [];
  COLORS.forEach((color, person) => {
    for (let step = 0; step < 40; step += 1) {
      events.push({
        id: `fixture-${person}-${step}`,
        type: "cursor",
        ts: now + person * 60_000 + step * 250,
        data: {
          x: 0.1 + step * 0.02,
          y: 0.2 + person * 0.25 + Math.sin(step / 5) * 0.08,
          event: "move",
        },
        meta: {
          pid: `pk_fixture_${person}`,
          sid: `sid_fixture_${person}`,
          url: `${origin}${PAGE_PATH}`,
          vw: 1100,
          vh: 760,
          tz: "UTC",
          cursor_color: color,
        },
      });
    }
  });
  return events;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, origin);
  const cors = { "access-control-allow-origin": "*" };
  if (url.pathname === "/events/recent") {
    recentRequests.push(url.searchParams);
    const events =
      url.searchParams.get("type") === "cursor" ? fixtureEvents() : [];
    response.writeHead(200, { ...cors, "content-type": "application/json" });
    return response.end(JSON.stringify(events));
  }
  if (url.pathname.startsWith("/feature-access/")) {
    response.writeHead(200, { ...cors, "content-type": "application/json" });
    return response.end(
      JSON.stringify({
        features: {
          EVERYONE_TRAILS: { stage: "internal", available: everyoneAvailable },
        },
      }),
    );
  }
  if (url.pathname === PAGE_PATH) {
    response.writeHead(200, { "content-type": "text/html" });
    return response.end(`<!doctype html><html><head><title>Trail page</title>
      <style>body{font:20px Georgia,serif;margin:80px;background:#fff;color:#34312c}main{max-width:720px}</style>
      </head><body><main><h1>Trail page</h1>
      <p>An ordinary article. People who browsed here left cursor trails behind.</p>
      <p>${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(12)}</p>
      </main></body></html>`);
  }
  response.writeHead(204, cors);
  response.end();
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(PORT, "127.0.0.1", done);
});

const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : { channel: "chromium" }),
  headless: true,
  viewport: { width: 1100, height: 760 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--disable-background-networking",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  ],
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const isExtensionWorker = (sw) => sw.url().startsWith("chrome-extension://");
const worker =
  context.serviceWorkers().find(isExtensionWorker) ??
  (await context.waitForEvent("serviceworker", {
    predicate: isExtensionWorker,
  }));
await worker.evaluate(async () => {
  while (!globalThis.chrome?.storage?.local) {
    await new Promise((done) => setTimeout(done, 100));
  }
});

async function setAccess(available) {
  everyoneAvailable = available;
  await worker.evaluate(
    (available) =>
      chrome.storage.local.set({
        // Points shared-trail reads at the loopback Worker below.
        collection_worker_url: "http://127.0.0.1:18787",
        wwoFeatureAccess: {
          features: {
            EVERYONE_TRAILS: { stage: "internal", available },
          },
          checkedAt: Date.now(),
        },
      }),
    available,
  );
}

const host = (page) => page.locator("#playhtml-historical-overlay-root");

/** Counts screenshot pixels near any fixture participant color. */
async function trailPixelCount(page) {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ({ data, colors }) => {
      const rgb = colors.map((hex) =>
        [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
      );
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${data}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let count = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (
          rgb.some(
            ([r, g, b]) =>
              Math.abs(px[i] - r) +
                Math.abs(px[i + 1] - g) +
                Math.abs(px[i + 2] - b) <
              90,
          )
        ) {
          count += 1;
        }
      }
      return count;
    },
    { data: shot, colors: COLORS },
  );
}

try {
  // 1. Without the internal feature, the hash does nothing and no server read happens.
  await setAccess(false);
  const gated = await context.newPage();
  await gated.goto(`${origin}${PAGE_PATH}#wwo-trails=everyone`);
  await gated.waitForTimeout(3000);
  assert.equal(
    await host(gated).count(),
    0,
    "overlay must not open without the feature",
  );
  assert.equal(
    recentRequests.length,
    0,
    "no shared trails fetched without the feature",
  );
  await gated.close();
  console.log("ok gated: hash ignored without EVERYONE_TRAILS");

  // 2. With it, the hash opens everyone's trails over the page.
  await setAccess(true);
  const page = await context.newPage();
  await page.goto(`${origin}${PAGE_PATH}#wwo-trails=everyone`);
  await host(page).waitFor({ state: "attached" });
  await page.waitForFunction(
    () =>
      document
        .querySelector("#playhtml-historical-overlay-root")
        ?.getAttribute("data-wwo-trails-state") === "ready",
  );
  assert.equal(
    await host(page).getAttribute("data-wwo-trails-source"),
    "everyone",
  );
  assert.equal(
    await host(page).getAttribute("data-wwo-trails-count"),
    String(COLORS.length * 40),
  );
  const cursorRead = recentRequests.find(
    (params) => params.get("type") === "cursor",
  );
  assert.equal(cursorRead?.get("domain"), "127.0.0.1");
  assert.equal(cursorRead?.get("limit"), "5000");
  await page.waitForTimeout(4000);
  const everyonePixels = await trailPixelCount(page);
  assert.ok(
    everyonePixels > 500,
    `expected drawn trails, saw ${everyonePixels} colored pixels`,
  );
  if (evidence)
    await page.screenshot({
      path: resolve(evidence, "1-everyone-with-controls.png"),
    });
  console.log(`ok everyone: ${everyonePixels} trail pixels, controls shown`);

  // 3. Hiding the controls leaves only the trails.
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await page.waitForFunction(
    () =>
      document
        .querySelector("#playhtml-historical-overlay-root")
        ?.getAttribute("data-wwo-trails-ui") === "hidden",
  );
  if (evidence)
    await page.screenshot({
      path: resolve(evidence, "2-everyone-ui-hidden.png"),
    });
  console.log("ok hide ui: double-tap d");

  // 4. The hash can ask for hidden controls up front, and switching back to "mine" works.
  const clean = await context.newPage();
  await clean.goto(`${origin}${PAGE_PATH}#wwo-trails=everyone&wwo-ui=hidden`);
  await clean.waitForFunction(() => {
    const el = document.querySelector("#playhtml-historical-overlay-root");
    return (
      el?.getAttribute("data-wwo-trails-state") === "ready" &&
      el.getAttribute("data-wwo-trails-ui") === "hidden"
    );
  });
  await clean.keyboard.press("d");
  await clean.keyboard.press("d");
  // The overlay lives in a closed shadow root, so click "mine" by position:
  // the first button of the panel's last row, bottom-right of the viewport.
  await clean.waitForTimeout(500);
  await clean.mouse.click(1100 - 20 - 280 + 36, 760 - 20 - 15);
  await clean.waitForFunction(() => {
    const el = document.querySelector("#playhtml-historical-overlay-root");
    return (
      el?.getAttribute("data-wwo-trails-source") === "mine" &&
      el.getAttribute("data-wwo-trails-state") !== "loading"
    );
  });
  if (evidence)
    await clean.screenshot({
      path: resolve(evidence, "3-mine-after-switch.png"),
    });
  console.log(
    `ok switch: mine shows ${await host(clean).getAttribute("data-wwo-trails-count")} local events`,
  );

  console.log("everyone-trails smoke passed");
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
