// ABOUTME: Exercises the installation frame end to end in Chromium with the built extension.
// ABOUTME: Verifies the frame, live trace pixels, earlier traces, live sound, and the faster installation pace.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(workspace, "extension/dist/chrome-mv3");
const evidence = process.env.INSTALLATION_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "wwo-frame-"));
const CURSOR_COLOR = "#e04488";
const errors = [];
const webSockets = [];
const externalRequests = [];

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><html><head><title>Installation frame test</title>
    <style>body{font:20px system-ui;margin:80px;background:#fff;color:#34312c}
    main{max-width:640px}h1{font-size:36px}button,input,a{font:inherit;margin:16px 16px 16px 0}
    button{padding:12px 20px}input{padding:12px}a{display:block}</style>
    </head><body><main><h1>Installation frame</h1>
    <p>An ordinary web page with the extension installed.</p>
    <button onclick="this.textContent='Clicked'">Try a click</button>
    <input aria-label="Test text" placeholder="Try typing here">
    <a href="/next">Another page</a><p>${request.url === "/next" ? "Second page" : "First page"}</p>
    </main></body></html>`);
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let context;

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    // Local runs can point at another build with PLAYWRIGHT_CHROMIUM_PATH.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : { channel: "chromium" }),
    headless: true,
    viewport: { width: 1100, height: 760 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--autoplay-policy=no-user-gesture-required",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });
  // The frame renders and sounds from local state only; nothing may leave.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:" || url.hostname === "127.0.0.1") {
      return route.continue();
    }
    externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => {
    webSockets.push(socket.url());
    socket.close();
  });
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.text().includes("installation frame")
      ) {
        errors.push(message.text());
      }
    });
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  return {
    worker,
    settingsUrl: `chrome-extension://${extensionId}/options.html`,
  };
}

/** Draws with the real pointer, in steps a hand would make. */
async function traceCursor(page, { steps = 60, stepPx = 10, delayMs = 16 } = {}) {
  await page.bringToFront();
  await page.mouse.move(160, 240);
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      160 + step * stepPx,
      240 + Math.sin(step / 6) * 120,
    );
    await page.waitForTimeout(delayMs);
  }
}

/** Counts pixels close to the participant's cursor color in a real screenshot. */
async function coloredPixelCount(page) {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async (data) => {
    const response = await fetch(`data:image/png;base64,${data}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data: pixels } = context.getImageData(
      0,
      0,
      bitmap.width,
      bitmap.height,
    );
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      // #e04488 against a white page: red high, green low, blue mid-high.
      if (
        pixels[index] > 170 &&
        pixels[index + 1] < 140 &&
        pixels[index + 2] > 100 &&
        pixels[index + 2] < 220
      ) {
        count += 1;
      }
    }
    return count;
  }, shot);
}

/** Reads stored cursor events for the test domain through the real background store. */
async function storedCursorEvents(extensionPage) {
  const events = await extensionPage.evaluate(
    () =>
      new Promise((done) => {
        chrome.runtime.sendMessage(
          { type: "GET_RECENT_EVENTS", domain: "127.0.0.1" },
          (response) => done(response?.events ?? []),
        );
      }),
  );
  return events.filter((event) => event.type === "cursor");
}

/** Clicks a control inside the frame's closed shadow root, through CDP. */
async function clickInFrameShadow(page, label) {
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  const { nodes } = await session.send("DOM.getFlattenedDocument", {
    depth: -1,
    pierce: true,
  });
  const text = nodes.find(
    (node) => node.nodeType === 3 && node.nodeValue?.trim() === label,
  );
  assert.ok(text, `frame control "${label}" is in the shadow tree`);
  const { model } = await session.send("DOM.getBoxModel", {
    nodeId: text.parentId,
  });
  const [x1, y1, , , x2, y2] = model.content;
  await page.mouse.click((x1 + x2) / 2, (y1 + y2) / 2);
  await session.detach();
}

try {
  const { worker, settingsUrl } = await launch();
  // Cursor collection has to be on for a machine to feed the screens at all.
  await worker.evaluate(() =>
    chrome.storage.local.set({ collection_mode_cursor: "local" }),
  );

  const settings = await context.newPage();
  await settings.goto(settingsUrl);
  await expect(
    settings.getByRole("heading", { name: "Identity", exact: true }),
  ).toBeVisible();
  await settings.locator('input[type="color"]').fill(CURSOR_COLOR);
  await settings.getByRole("button", { name: "Save", exact: true }).click();

  const page = await context.newPage();
  await page.goto(`${origin}/first`);
  await traceCursor(page, { steps: 10 });
  await expect(page.locator("#wwo-installation-frame")).toHaveCount(0);

  // Turn on the one existing switch: installation mode brings the frame with it.
  await settings.bringToFront();
  await settings.keyboard.press("Control+Shift+Digit8");
  const toggle = settings.getByRole("checkbox", { name: "Installation mode" });
  await toggle.check();
  await expect(toggle).toBeChecked();

  const frame = page.locator("#wwo-installation-frame");
  await expect(frame).toBeAttached();
  const blankPixels = await coloredPixelCount(page);
  await traceCursor(page);
  await expect.poll(() => frame.getAttribute("data-wwo-trace")).not.toBe("0");
  const tracedPixels = await coloredPixelCount(page);
  assert.ok(
    tracedPixels > blankPixels + 500,
    `the live trace paints the page (${blankPixels} → ${tracedPixels} colored pixels)`,
  );
  if (evidence)
    await page.screenshot({ path: resolve(evidence, "frame-trace.png") });

  // Sound starts on the first gesture and reports itself on the host.
  await expect
    .poll(() => frame.getAttribute("data-wwo-sound"))
    .toMatch(/pending|playing/);
  await page.getByRole("button", { name: "Try a click" }).click();
  await expect(page.getByRole("button", { name: "Clicked" })).toBeVisible();
  await traceCursor(page, { steps: 12 });
  await expect.poll(() => frame.getAttribute("data-wwo-sound")).toBe("playing");

  // No switch in the frame: an operator silences a machine through the
  // preference, and the open page follows without a reload.
  await worker.evaluate(() =>
    chrome.storage.local.set({ wwoInstallationSound: false }),
  );
  await expect.poll(() => frame.getAttribute("data-wwo-sound")).toBe("off");
  await worker.evaluate(() =>
    chrome.storage.local.set({ wwoInstallationSound: true }),
  );
  await traceCursor(page, { steps: 12 });
  await expect.poll(() => frame.getAttribute("data-wwo-sound")).toBe("playing");

  // The info panel opens from the corner button a visitor would reach for.
  await clickInFrameShadow(page, "about this");
  if (evidence)
    await page.screenshot({ path: resolve(evidence, "frame-panel.png") });
  await clickInFrameShadow(page, "hide");

  // The page underneath keeps working: the frame never swallows input.
  await page.getByRole("textbox").fill("The frame does not block typing.");
  await expect(page.getByRole("textbox")).toHaveValue(
    "The frame does not block typing.",
  );

  // Earlier traces on this site come back after navigating.
  await page.getByRole("link", { name: "Another page" }).click();
  await expect(page).toHaveURL(`${origin}/next`);
  await expect(page.locator("#wwo-installation-frame")).toBeAttached();
  await expect
    .poll(
      () =>
        page.locator("#wwo-installation-frame").getAttribute("data-wwo-previous"),
      { timeout: 15000 },
    )
    .not.toBe("0");
  if (evidence)
    await page.screenshot({ path: resolve(evidence, "frame-previous.png") });

  // Installation pace: the same movement should land far more marks than the
  // pace ordinary browsing uses.
  const before = await storedCursorEvents(settings);
  const fastStart = Date.now();
  await traceCursor(page, { steps: 120 });
  await page.waitForTimeout(1500);
  const afterFast = await storedCursorEvents(settings);
  const fastCount = afterFast.length - before.length;
  const fastLatency = Math.min(
    ...afterFast
      .filter((event) => event.ts >= fastStart)
      .map((event) => event.ts - fastStart),
  );

  await settings.bringToFront();
  await toggle.uncheck();
  await expect(page.locator("#wwo-installation-frame")).toHaveCount(0);
  const beforeSlow = await storedCursorEvents(settings);
  await traceCursor(page, { steps: 120 });
  await page.waitForTimeout(1500);
  const slowCount = (await storedCursorEvents(settings)).length - beforeSlow.length;

  assert.ok(
    fastCount > slowCount * 1.8 && fastCount >= 12,
    `installation pace records more of the same movement (${fastCount} vs ${slowCount})`,
  );
  assert.ok(
    fastLatency < 4000,
    `marks reach the store while the movement is still happening (${fastLatency}ms)`,
  );

  assert.deepEqual(errors, [], "no page or installation frame errors");
  assert.deepEqual(webSockets, [], "the frame never joins a presence room");
  console.log(
    JSON.stringify(
      {
        result: "passed",
        browser: context.browser()?.version(),
        tracedPixels,
        fastCount,
        slowCount,
        fastLatency,
        externalRequestsBlocked: externalRequests.length,
        evidence,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await new Promise((done) => server.close(done));
  await rm(profile, { recursive: true, force: true });
}
