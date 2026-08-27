// ABOUTME: Loads the built browser extension in isolated headless Chromium.
// ABOUTME: Verifies the MV3 worker, content script, and popup without external traffic.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(
  workspaceRoot,
  "extension/dist/chrome-mv3-dev",
);
const workerPort = 18787;
const workerOrigin = `http://127.0.0.1:${workerPort}`;
const localWorkerRequests = [];
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/probe") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      "<!doctype html><title>Extension smoke</title><main>extension smoke</main>",
    );
    return;
  }

  localWorkerRequests.push({ method: request.method, url: request.url });
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"inserted":0,"duplicates":0}');
});

async function listen() {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(workerPort, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

async function closeServer() {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

await listen();
let context;

try {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });

  const blockedHttpRequests = [];
  const blockedWebSockets = [];
  await context.routeWebSocket("**/*", (webSocket) => {
    blockedWebSockets.push(webSocket.url());
    webSocket.close();
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol === "chrome-extension:" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost"
    ) {
      await route.continue();
      return;
    }
    blockedHttpRequests.push({ method: route.request().method(), url: url.href });
    await route.abort("blockedbyclient");
  });

  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${workerOrigin}/probe`, { waitUntil: "domcontentloaded" });

  const tabId = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0]?.id;
  }, page.url());
  assert.equal(typeof tabId, "number", "the extension worker found the probe tab");

  const contentReply = await worker.evaluate(
    async ({ targetTabId }) =>
      chrome.tabs.sendMessage(targetTabId, { type: "PING" }),
    { targetTabId: tabId },
  );
  assert.deepEqual(contentReply, {
    status: "pong",
    url: `${workerOrigin}/probe`,
  });

  const popup = await context.newPage();
  const popupErrors = [];
  popup.on("pageerror", (error) => popupErrors.push(error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded",
  });
  await popup.locator("body").waitFor({ state: "visible" });
  const popupText = (await popup.locator("body").innerText()).trim();
  await page.waitForTimeout(500);
  const unexpectedExternalHttpRequests = blockedHttpRequests.filter(
    ({ method, url }) => {
      const parsedUrl = new URL(url);
      return !(
        method === "GET" &&
        parsedUrl.hostname === "fonts.googleapis.com" &&
        parsedUrl.pathname === "/css2"
      );
    },
  );

  assert.ok(popupText.length > 0, "the popup rendered non-empty text");
  assert.deepEqual(pageErrors, [], "the probe page had no uncaught errors");
  assert.deepEqual(popupErrors, [], "the popup had no uncaught errors");
  assert.deepEqual(
    localWorkerRequests.filter(
      ({ method, url }) => method === "PUT" && url.startsWith("/participants/"),
    ).length,
    1,
    "the extension synced its generated participant color to the loopback worker",
  );
  assert.deepEqual(
    unexpectedExternalHttpRequests,
    [],
    "the extension only attempted its known external font stylesheets",
  );
  assert.deepEqual(blockedWebSockets, [], "the extension did not open WebSockets");

  console.log(
    JSON.stringify(
      {
        serviceWorker: worker.url(),
        contentScript: contentReply.status,
        popupTextLength: popupText.length,
        localWorkerRequests,
        blockedFontStylesheets: blockedHttpRequests.length,
        externalWebSockets: blockedWebSockets.length,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close().catch(() => {});
  await closeServer();
}
