// ABOUTME: Exercises installation mode through the built extension's Settings in Chromium.
// ABOUTME: Verifies local cursor rendering, color changes, navigation, restart, and removal.

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
const profile = await mkdtemp(resolve(tmpdir(), "wwo-installation-"));
const errors = [];
const webSockets = [];
const externalRequests = [];
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><html><head><title>Installation cursor test</title>
    <style>body{font:20px system-ui;margin:80px;background:#f8f7f3;color:#34312c}
    main{max-width:640px}h1{font-size:36px}button,input,a{font:inherit;margin:16px 16px 16px 0}
    button{padding:12px 20px;cursor:pointer}input{padding:12px}a{display:block}</style>
    </head><body><main><h1>Installation cursor</h1><p>An ordinary web page with the extension installed.</p>
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
  // Block external traffic; this feature uses browser storage and DOM only.
  // No Worker API responses, extension APIs, identity, or storage are simulated.
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
        message.text().includes("installation cursor")
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

async function assertCursor(page) {
  await expect(page.locator("#wwo-installation-cursor")).toBeAttached();
  await page.bringToFront();
  await page.mouse.move(360, 350);
  await expect(page.locator("#wwo-installation-cursor")).toBeVisible();
  assert.equal(
    await page.locator("body").evaluate((el) => getComputedStyle(el).cursor),
    "none",
  );
  assert.equal(
    await page
      .locator("#wwo-installation-cursor")
      .evaluate((el) => el.style.transform),
    "translate(348px, 341.6px)",
  );
}

try {
  let { worker, settingsUrl } = await launch();
  const settings = await context.newPage();
  await settings.goto(settingsUrl);
  await expect(
    settings.getByRole("heading", { name: "Identity", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("checkbox", { name: "Installation mode" }),
  ).toHaveCount(0);
  const page = await context.newPage();
  await page.goto(`${origin}/first`);
  await page.mouse.move(360, 350);
  await expect(page.locator("#wwo-installation-cursor")).toHaveCount(0);

  await settings.bringToFront();
  await settings.keyboard.press("8");
  await expect(
    settings.getByRole("checkbox", { name: "Installation mode" }),
  ).toHaveCount(0);
  await settings.keyboard.press("Control+Shift+Digit8");
  const toggle = settings.getByRole("checkbox", { name: "Installation mode" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  if (evidence)
    await settings.screenshot({ path: resolve(evidence, "settings-off.png") });
  await toggle.check();
  await expect(toggle).toBeChecked();
  if (evidence)
    await settings.screenshot({ path: resolve(evidence, "settings-on.png") });
  await assertCursor(page);

  // Change color through the actual settings form and verify storage and DOM.
  await settings.bringToFront();
  await settings.locator('input[type="color"]').fill("#e04488");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () =>
      worker.evaluate(async () => {
        const { playerIdentity } =
          await chrome.storage.local.get("playerIdentity");
        return playerIdentity?.public?.playerStyle?.colorPalette?.[0];
      }),
    )
    .toBe("#e04488");
  // CDP inspects the real closed shadow tree without changing production code.
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  await expect
    .poll(async () => {
      const { nodes } = await session.send("DOM.getFlattenedDocument", {
        depth: -1,
        pierce: true,
      });
      return nodes.some(
        (node) =>
          node.nodeName === "path" && node.attributes?.includes("#e04488"),
      );
    })
    .toBe(true);
  await assertCursor(page);
  if (evidence)
    await page.screenshot({ path: resolve(evidence, "cursor-on.png") });
  await page.getByRole("button", { name: "Try a click" }).click();
  await expect(page.getByRole("button", { name: "Clicked" })).toBeVisible();
  await page.getByRole("textbox").fill("The cursor does not block typing.");
  await expect(page.getByRole("textbox")).toHaveValue(
    "The cursor does not block typing.",
  );
  await page.getByRole("link", { name: "Another page" }).click();
  await expect(page).toHaveURL(`${origin}/next`);
  await assertCursor(page);
  await page.goBack();
  await assertCursor(page);
  await page.reload();
  await assertCursor(page);

  await context.close();
  ({ worker, settingsUrl } = await launch());
  const restartedPage = await context.newPage();
  await restartedPage.goto(`${origin}/after-restart`);
  await assertCursor(restartedPage);
  const otherPage = await context.newPage();
  await otherPage.goto(`${origin}/another-tab`);
  await assertCursor(otherPage);
  const restartedSettings = await context.newPage();
  await restartedSettings.goto(settingsUrl);
  const persistedToggle = restartedSettings.getByRole("checkbox", {
    name: "Installation mode",
  });
  await expect(persistedToggle).toBeChecked();
  await persistedToggle.uncheck();
  for (const openPage of [restartedPage, otherPage]) {
    await expect(openPage.locator("#wwo-installation-cursor")).toHaveCount(0);
    assert.equal(
      await openPage
        .locator("html")
        .getAttribute("data-wwo-installation-cursor"),
      null,
    );
    assert.equal(
      await openPage
        .getByRole("button")
        .evaluate((el) => getComputedStyle(el).cursor),
      "pointer",
    );
    assert.equal(
      await openPage
        .getByRole("textbox")
        .evaluate((el) => getComputedStyle(el).cursor),
      "text",
    );
  }
  if (evidence)
    await restartedPage.screenshot({
      path: resolve(evidence, "cursor-off.png"),
    });
  await restartedPage.reload();
  await expect(restartedPage.locator("#wwo-installation-cursor")).toHaveCount(
    0,
  );
  await restartedSettings.reload();
  await expect(
    restartedSettings.getByRole("heading", { name: "Identity", exact: true }),
  ).toBeVisible();
  await expect(
    restartedSettings.getByRole("checkbox", { name: "Installation mode" }),
  ).toHaveCount(0);
  await restartedSettings.keyboard.press("Meta+Shift+Digit8");
  await expect(
    restartedSettings.getByRole("checkbox", { name: "Installation mode" }),
  ).toBeVisible();
  assert.deepEqual(errors, [], "no page or installation cursor errors");
  assert.deepEqual(
    webSockets,
    [],
    "installation mode never joins a presence room",
  );
  console.log(
    JSON.stringify(
      {
        result: "passed",
        browser: context.browser()?.version(),
        externalRequestsBlocked: externalRequests.length,
        webSockets: webSockets.length,
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
