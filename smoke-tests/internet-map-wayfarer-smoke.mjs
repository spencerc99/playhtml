// ABOUTME: Drives the internet map's walk mode and the extension's corner map widget in headless Chromium.
// ABOUTME: Runs against a synthetic map bundle and loopback servers only; no real browsing data, no network.

/**
 * Two flows, one browser:
 *
 *  1. The map page itself: enter walk mode, lead the character with the
 *     mouse, click-travel to another city, and arrive.
 *  2. The extension: with the flag on, visit two "sites" (loopback servers
 *     answering for any hostname), and check that the corner widget frames
 *     the hosted map, records the journey, and walks the character from the
 *     first site to the second.
 *
 * Set WAYFARER_SHOTS=<dir> to keep screenshots of each state.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(workspaceRoot, "extension/dist/chrome-mv3-dev");
const websiteDir = resolve(workspaceRoot, "extension/website");
const SITE_PORT = 18790;
const HOSTS_PORT = 18791;
const WORKER_PORT = 18787;
const siteOrigin = `http://127.0.0.1:${SITE_PORT}`;
const shots = process.env.WAYFARER_SHOTS ? resolve(process.env.WAYFARER_SHOTS) : null;
if (shots) mkdirSync(shots, { recursive: true });

const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: resolve(shots, `${name}.png`) });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeout = 30_000, diagnose = () => "") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      throw new Error(`timed out waiting for ${what}\n${await diagnose()}`);
    }
    await sleep(100);
  }
}

// ---------------------------------------------------------------- servers
const fixture = spawnSync("bun", ["run", "extension/website/scripts/internet-map-fixture.ts"], {
  cwd: workspaceRoot, stdio: "inherit",
});
assert.equal(fixture.status, 0, "the fixture bundle was written");

// Any hostname answers here, so github.com:18791 is a page we control.
const hosts = createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${host}${req.url}</title><main>${host}${req.url}</main>`);
});
const worker = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"inserted":0,"duplicates":0}');
});
const listen = (server, port) => new Promise((ok, fail) => {
  server.once("error", fail);
  server.listen(port, "127.0.0.1", () => { server.off("error", fail); ok(); });
});
await listen(hosts, HOSTS_PORT);
await listen(worker, WORKER_PORT);

const site = spawn("bunx", ["vite", "--port", String(SITE_PORT), "--strictPort", "--host", "127.0.0.1"], {
  cwd: websiteDir, stdio: ["ignore", "pipe", "pipe"],
});
site.stdout.on("data", () => {});
site.stderr.on("data", (d) => process.stderr.write(d));
await until(async () => {
  try {
    const r = await fetch(`${siteOrigin}/internet-map/data/fixture/map.json`);
    return r.ok;
  } catch { return false; }
}, "the website dev server", 60_000);

let context;
try {
  const launch = {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else launch.channel = "chromium";
  context = await chromium.launchPersistentContext("", launch);
  await context.routeWebSocket("**/*", (webSocket) => webSocket.close());
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const local = url.protocol === "chrome-extension:" || url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" || url.port === String(HOSTS_PORT);
    if (local) await route.continue(); else await route.abort("blockedbyclient");
  });

  // ------------------------------------------------------------ 1. walk mode
  const map = await context.newPage();
  await map.setViewportSize({ width: 1280, height: 800 });
  const mapErrors = [];
  map.on("pageerror", (e) => mapErrors.push(e.message));
  await map.goto(`${siteOrigin}/internet-map/?data=fixture&walk=1&q=github.com`, { waitUntil: "commit" });
  await map.waitForFunction(() => window.__wayfarer?.active, null, { timeout: 60_000 });
  await map.waitForTimeout(900);
  const status = () => map.evaluate(() => {
    const w = window.__wayfarer;
    return { ...w.currentStatus, edge: w.walker.edge, odometer: w.walker.odometer };
  });
  let s = await status();
  assert.equal(s.host, "github.com", "walk mode starts at the searched place");
  await shot(map, "map-1-enter");

  // lead the character with the cursor: it takes to a road and moves
  await map.mouse.move(640, 400);
  await map.mouse.move(420, 250, { steps: 10 });
  await map.waitForTimeout(1500);
  s = await status();
  assert.ok(s.odometer > 0, "the character walked when led");
  assert.ok(s.edge >= 0 || s.at.length > 0, "the character is on a road");
  await shot(map, "map-2-led");

  // click-travel to another city, by the route people take, and arrive
  const travelled = await map.evaluate(() => {
    const w = window.__wayfarer;
    return w.travel(w.c.labels.pages.indexOf("en.wikipedia.org/wiki/Internet"));
  });
  assert.equal(travelled, true, "a route to wikipedia exists");
  await map.waitForTimeout(1200);
  await shot(map, "map-3-travelling");
  await map.waitForFunction(() => {
    const st = window.__wayfarer.currentStatus;
    return st.state === "arrived" && st.host === "en.wikipedia.org";
  }, null, { timeout: 60_000 });
  await map.waitForTimeout(400);
  await shot(map, "map-4-arrived");
  s = await status();
  assert.ok(s.places >= 2, "the passport recorded the places passed");
  await map.keyboard.press("Escape");
  assert.equal(await map.evaluate(() => window.__wayfarer.active), false, "Escape leaves walk mode");
  assert.deepEqual(mapErrors, [], "the map page had no uncaught errors");
  await map.close();

  // ------------------------------------------------------------ 2. the widget
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  await sw.evaluate(() => chrome.storage.local.set({
    wwoFeatureOverrides: { MAP_WAYFARER: true },
    wwoWayfarerJourney: { stops: [], updatedAt: 0 },
  }));

  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 720 });
  const pageErrors = [];
  const consoleLog = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => consoleLog.push(`${m.type()}: ${m.text()}`));
  const diagnose = () => `frames: ${page.frames().map((x) => x.url()).join(" | ")}\n` +
    `console: ${consoleLog.slice(-20).join("\n")}`;

  const frames = () => ({
    shell: page.frames().find((f) => f.url().includes("wayfarer.html")),
    inner: page.frames().find((f) => f.url().includes("/internet-map/") && f.url().includes("widget=1")),
  });
  const innerStatus = (inner) => inner.evaluate(() => {
    const w = window.__wayfarer;
    return w ? { active: w.active, ...(w.currentStatus ?? {}), odometer: w.walker.odometer,
                 bakeMs: Number(document.getElementById("map")?.dataset.bakeMs) } : null;
  });

  await page.goto(`http://github.com:${HOSTS_PORT}/spencerc99/playhtml/issues/12`, { waitUntil: "domcontentloaded" });
  let f = await until(() => { const x = frames(); return x.shell && x.inner ? x : null; }, "the widget frames", 30_000, diagnose);
  let st = await until(async () => {
    const v = await innerStatus(f.inner).catch(() => null);
    return v && v.active && v.state === "arrived" ? v : null;
  }, "the widget to place the walker at github", 60_000);
  assert.equal(st.host, "github.com", "the first visit lands the walker at github.com");
  assert.equal(st.at, "github.com/spencerc99/playhtml", "an unknown path resolves to the nearest page under it");
  console.log(`widget bake: ${st.bakeMs}ms`);
  await shot(page, "widget-1-first-visit");

  const caption = () => f.shell.locator("#caption").innerText();
  assert.match(await caption(), /github\.com/, "the shell caption names the place");

  await page.goto(`http://news.ycombinator.com:${HOSTS_PORT}/item`, { waitUntil: "domcontentloaded" });
  f = await until(() => { const x = frames(); return x.shell && x.inner ? x : null; }, "the widget frames again", 30_000, diagnose);
  st = await until(async () => {
    const v = await innerStatus(f.inner).catch(() => null);
    return v && v.active && v.state === "walking" ? v : null;
  }, "the walker to set off for hacker news", 60_000);
  assert.equal(st.dest?.name, "a thread", "the walker is bound for the hacker news thread");
  await shot(page, "widget-2-walking");
  st = await until(async () => {
    const v = await innerStatus(f.inner).catch(() => null);
    return v && v.state === "arrived" && v.host === "news.ycombinator.com" ? v : null;
  }, "the walker to arrive at hacker news", 60_000);
  assert.ok(st.odometer > 0, "the walker walked there rather than appearing");
  assert.match(await caption(), /news\.ycombinator\.com/, "the caption follows the arrival");
  await page.waitForTimeout(300);
  await shot(page, "widget-3-arrived");

  const journey = await sw.evaluate(async () => (await chrome.storage.local.get("wwoWayfarerJourney")).wwoWayfarerJourney);
  assert.deepEqual(journey.stops.map((x) => x.url), [
    `http://github.com:${HOSTS_PORT}/spencerc99/playhtml/issues/12`,
    `http://news.ycombinator.com:${HOSTS_PORT}/item`,
  ], "the background recorded both stops, in order, without duplicates");

  // collapse from storage, as the shell's button does
  await sw.evaluate(() => chrome.storage.local.set({ wwoWayfarerWidget: { collapsed: true } }));
  await until(() => f.shell.locator("#map").isHidden(), "the map frame to hide when collapsed");
  await shot(page, "widget-4-collapsed");

  assert.deepEqual(pageErrors, [], "the host pages had no uncaught errors");
  console.log(JSON.stringify({ mapErrors, pageErrors, journeyStops: journey.stops.length, bakeMs: st.bakeMs }));
} finally {
  await context?.close().catch(() => {});
  site.kill("SIGTERM");
  await Promise.all([
    new Promise((r) => hosts.close(() => r())),
    new Promise((r) => worker.close(() => r())),
  ]);
}
