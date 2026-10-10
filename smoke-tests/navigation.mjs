// ABOUTME: Checks automatic navigation detection against real browser history.
// ABOUTME: Verifies committed URLs, cancelled navigation, and listener cleanup.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { transformWithEsbuild } from "vite";

const source = await readFile(
  new URL("../packages/playhtml/src/navigation.ts", import.meta.url),
  "utf8",
);
const { code } = await transformWithEsbuild(source, "navigation.ts", {
  loader: "ts",
});
const server = createServer((request, response) => {
  if (request.url === "/navigation.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end(code);
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><title>Navigation test</title>
    <script type="module">
      import { createNavigationController, attachNavigationListeners }
        from "/navigation.js";
      window.committedPaths = [];
      const controller = createNavigationController(async () => {
        window.committedPaths.push(location.pathname + location.search);
      });
      window.detachNavigation = attachNavigationListeners(controller);
      window.navigationReady = true;
    </script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/first`);
  await page.waitForFunction(() => window.navigationReady);

  async function expectPath(path) {
    await page.waitForFunction(
      (expected) => window.committedPaths.at(-1) === expected,
      path,
      { timeout: 3_000 },
    );
    assert.equal(new URL(page.url()).pathname, path.split("?")[0]);
  }

  await page.evaluate(() => history.pushState({}, "", "/second"));
  await expectPath("/second");
  await page.evaluate(() =>
    history.replaceState({}, "", "/replacement?view=all"),
  );
  await expectPath("/replacement?view=all");
  await page.evaluate(() => history.pushState({}, "", "/third"));
  await expectPath("/third");
  await page.goBack();
  await expectPath("/replacement?view=all");
  await page.goForward();
  await expectPath("/third");

  const beforeCancel = await page.evaluate(() => window.committedPaths.length);
  await page.evaluate(async () => {
    navigation.addEventListener("navigate", (event) => event.preventDefault(), {
      once: true,
    });
    const result = navigation.navigate("/cancelled");
    await Promise.allSettled([result.committed, result.finished]);
  });
  assert.equal(new URL(page.url()).pathname, "/third");
  assert.equal(
    await page.evaluate(() => window.committedPaths.length),
    beforeCancel,
  );

  await page.evaluate(() => {
    window.detachNavigation();
    history.pushState({}, "", "/detached");
  });
  await page.goBack();
  assert.equal(
    await page.evaluate(() => window.committedPaths.length),
    beforeCancel,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Navigation browser checks passed: push, replace, back, forward, cancellation, cleanup.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
