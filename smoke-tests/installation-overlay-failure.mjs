// ABOUTME: Verifies that a failed historical-overlay asset load restores collection.
// ABOUTME: Runs a built Chrome extension with the overlay asset removed as a fault injection.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(workspace, "extension/dist/chrome-mv3");
const directory = await mkdtemp(join(tmpdir(), "wwo-overlay-failure-"));
const extensionPath = join(directory, "extension");
const profile = join(directory, "profile");
await cp(source, extensionPath, { recursive: true });
await rm(join(extensionPath, "historical-overlay.js"));

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    "<!doctype html><html><body><h1>Overlay failure test</h1></body></html>",
  );
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1100, height: 760 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() =>
    chrome.storage.local.set({ collection_mode_cursor: "local" }),
  );
  const extensionId = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Failed to toggle overlay")
    ) {
      errors.push(message.text());
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);

  const cursorCount = async () => {
    const response = await settings.evaluate(
      () =>
        new Promise((done) => {
          chrome.runtime.sendMessage(
            { type: "GET_RECENT_EVENTS", domain: "127.0.0.1" },
            done,
          );
        }),
    );
    return response.events.filter((event) => event.type === "cursor").length;
  };

  await page.keyboard.press("Control+Shift+H");
  await expect.poll(() => errors.length).toBe(1);
  await expect(page.locator("#playhtml-historical-overlay-root")).toHaveCount(
    0,
  );

  const before = await cursorCount();
  await page.bringToFront();
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.move(100 + step * 18, 200 + (step % 6) * 20);
    await page.waitForTimeout(50);
  }
  await expect.poll(cursorCount, { timeout: 10_000 }).toBeGreaterThan(before);
  console.log(
    JSON.stringify({
      result: "passed",
      failureLogged: errors.length,
      cursorEventsAfterFailure: (await cursorCount()) - before,
    }),
  );
} finally {
  await context?.close();
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
}
