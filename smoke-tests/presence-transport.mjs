// ABOUTME: Verifies built presence and document synchronization in real Chromium tabs.
// ABOUTME: Uses isolated rooms on a real backend and records observable lifecycle results.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.PARTYKIT_HOST;
if (!host)
  throw new Error("PARTYKIT_HOST must identify the real verification backend");
const evidence = process.env.PRESENCE_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const run = `presence-smoke-${Date.now()}`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const path = pathname.startsWith("/packages/playhtml/dist/")
      ? resolve(root, `.${pathname}`)
      : resolve(root, "smoke-tests/fixtures/presence-transport.html");
    if (!path.startsWith(root + "/")) throw new Error("Invalid path");
    const content = await readFile(path);
    response.writeHead(200, {
      "content-type":
        { ".js": "text/javascript", ".css": "text/css" }[extname(path)] ??
        "text/html",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
const disconnecting = new WeakSet();
const expectedDisconnectErrors = [];
async function context() {
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 800 },
  });
  await ctx.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.socketLog = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.socketLog.push({ socket: this, sent: [] });
      }
      send(data) {
        window.socketLog.find((entry) => entry.socket === this).sent.push(data);
        return super.send(data);
      }
    };
  });
  ctx.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (
        disconnecting.has(page) &&
        message.text() === "Issue connecting to yjs..."
      ) {
        expectedDisconnectErrors.push(message.text());
      } else {
        errors.push(message.text());
      }
    });
  });
  return ctx;
}
async function open(ctx, mode, pid, name, path = "/a", scope = "") {
  const page = await ctx.newPage();
  const params = new URLSearchParams({
    host,
    run: `${run}-${mode}-${scope}`,
    pid,
    name,
    color: pid === "alice" ? "#a4262c" : "#135da0",
    cursors: mode,
    scope,
  });
  await page.goto(`${origin}${path}?${params}`);
  await page.waitForFunction(() => window.ready, null, { timeout: 45000 });
  return page;
}
const ids = (page) =>
  page.evaluate(() =>
    app.users
      .getAll()
      .map((user) => user.pid)
      .sort(),
  );
async function expectIds(page, expected) {
  await expect
    .poll(() => ids(page), { timeout: 45000 })
    .toEqual([...expected].sort());
}
async function shot(page, name) {
  if (evidence)
    await page.screenshot({ path: resolve(evidence, `${name}.png`) });
}
try {
  for (const mode of ["off", "on"]) {
    const aliceContext = await context();
    const bobContext = await context();
    const alice = await open(aliceContext, mode, "alice", "Alice");
    const bob = await open(bobContext, mode, "bob", "Bob");
    await expectIds(alice, ["alice", "bob"]);
    await expectIds(bob, ["alice", "bob"]);
    const aliceTab = await open(aliceContext, mode, "alice", "Alice");
    await expectIds(bob, ["alice", "bob"]);
    await aliceTab.close();
    await expectIds(bob, ["alice", "bob"]);
    await alice.evaluate(() => {
      app.users.me.name = "Alicia";
    });
    await expect
      .poll(() =>
        bob.evaluate(
          () => app.users.getAll().find((user) => user.pid === "alice")?.name,
        ),
      )
      .toBe("Alicia");
    await expect(bob.locator("#counter")).not.toHaveClass(/playhtml-loading/, {
      timeout: 20000,
    });
    await bob.locator("#counter").click();
    await expect(alice.locator("#counter")).toHaveText("Shared count: 1");
    await expect
      .poll(() =>
        alice.evaluate(() =>
          elementPeers.some(([id, value]) => id === "bob" && value.active),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        alice.evaluate(
          () => app.presence.getPresences().get("bob")?.status?.text,
        ),
      )
      .toBe("Clicked the counter");
    if (mode === "on") {
      await bob.mouse.move(520, 340);
      await expect(alice.locator(".playhtml-cursor-other")).toHaveCount(1);
    }
    await shot(alice, `${mode}-shared-presence`);
    const before = await bob.evaluate(() =>
      socketLog
        .filter((entry) => entry.socket.url.includes("/presence/"))
        .map((entry) => ({
          url: entry.socket.url,
          joins: entry.sent.filter(
            (data) =>
              typeof data === "string" &&
              JSON.parse(data).type === "presence-join",
          ).length,
        })),
    );
    await bob.evaluate(() => {
      app.users.me.color = "#256c3c";
    });
    const after = await bob.evaluate(() =>
      socketLog
        .filter((entry) => entry.socket.url.includes("/presence/"))
        .map((entry) => ({
          url: entry.socket.url,
          joins: entry.sent.filter(
            (data) =>
              typeof data === "string" &&
              JSON.parse(data).type === "presence-join",
          ).length,
        })),
    );
    assert.equal(
      before.length,
      2,
      "one page presence socket plus one named socket",
    );
    after.forEach((entry, index) =>
      assert.equal(
        entry.joins - before[index].joins,
        1,
        "one identity broadcaster per socket",
      ),
    );
    await bob.evaluate(() =>
      named.presence.setMyPresence("status", { text: "Named room" }),
    );
    await expect
      .poll(() =>
        alice.evaluate(
          () => named.presence.getPresences().get("bob")?.status?.text,
        ),
      )
      .toBe("Named room");
    await alice.evaluate(async () => {
      history.pushState({}, "", "/b");
      await app.handleNavigation();
    });
    await expectIds(alice, ["alice"]);
    await expectIds(bob, ["bob"]);
    await expect(alice.locator("#counter")).toHaveText("Shared count: 0");
    await expect
      .poll(() =>
        alice.evaluate(
          () => named.presence.getPresences().get("bob")?.status?.text,
        ),
      )
      .toBe("Named room");
    await shot(alice, `${mode}-page-scoped`);
    await alice.evaluate(async () => {
      history.pushState({}, "", "/a");
      await app.handleNavigation();
    });
    await expectIds(alice, ["alice", "bob"]);
    await expect(alice.locator("#counter")).toHaveText("Shared count: 1");
    await alice.locator("#counter").click();
    await expect(bob.locator("#counter")).toHaveText("Shared count: 2");
    disconnecting.add(alice);
    await alice.evaluate(() => {
      window.droppedSockets = socketLog
        .filter(({ socket }) => socket.readyState === WebSocket.OPEN)
        .map(({ socket }) => socket);
      droppedSockets.forEach((socket) =>
        socket.close(1000, "presence verification"),
      );
    });
    await alice.waitForFunction(() =>
      droppedSockets.every((socket) => socket.readyState === WebSocket.CLOSED),
    );
    await aliceContext.setOffline(true);
    await alice.evaluate(() => {
      document.dispatchEvent(
        new CustomEvent("playhtml:configure-identity", {
          detail: {
            playerIdentity: {
              publicKey: "alicia",
              playerStyle: { colorPalette: ["#a4262c"] },
            },
          },
        }),
      );
      if (app.users.getAll().some((user) => user.pid === "alice"))
        throw new Error("Previous self identity became a remote peer");
    });
    await aliceContext.setOffline(false);
    await expectIds(bob, ["alicia", "bob"]);
    await expectIds(alice, ["alicia", "bob"]);
    await expect
      .poll(
        () =>
          alice.evaluate(
            () => app.presence.getPresences().get("bob")?.status?.text,
          ),
        { timeout: 15000 },
      )
      .toBe("Clicked the counter");
    await expect
      .poll(() =>
        bob.evaluate(
          () => app.presence.getPresences().get("alicia")?.status?.text,
        ),
      )
      .toBe("Clicked the counter");
    await expect
      .poll(() =>
        bob.evaluate(() =>
          elementPeers.some(([id, value]) => id === "alicia" && value.active),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        alice.evaluate(() =>
          elementPeers.some(([id, value]) => id === "alicia" && value.active),
        ),
      )
      .toBe(true);
    await bob.locator("#counter").click();
    await expect(alice.locator("#counter")).toHaveText("Shared count: 3");
    await shot(alice, `${mode}-reconnected`);
    await alice.evaluate(async () => {
      named.destroy();
      await resetApp();
    });
    await expect
      .poll(() =>
        alice.evaluate(
          () =>
            socketLog.filter(
              ({ socket }) => socket.readyState < WebSocket.CLOSING,
            ).length,
        ),
      )
      .toBe(0);
    await expectIds(bob, ["bob"]);
    results.push({
      cursors: mode,
      checks: [
        "identity updates",
        "multi-tab deduplication and tab close",
        "Yjs shared counter",
        "element awareness",
        "page presence",
        "named room isolation",
        "navigation round trip",
        "offline identity adoption",
        "reconnect and local presence replay",
        "one broadcaster per socket",
        "teardown",
      ],
    });
    await aliceContext.close();
    await bobContext.close();
  }
  const ac = await context();
  const bc = await context();
  const a = await open(ac, "on", "alice", "Alice", "/a", "domain");
  const b = await open(bc, "on", "bob", "Bob", "/b", "domain");
  await expectIds(a, ["alice", "bob"]);
  await expectIds(b, ["alice", "bob"]);
  await b.locator("#counter").click();
  await expect(a.locator("#counter")).toHaveText("Shared count: 0");
  assert.equal(
    await a.evaluate(() => app.presence.getPresences().get("bob")?.status),
    undefined,
  );
  await a.evaluate(async () => {
    history.pushState({}, "", "/b");
    await app.handleNavigation();
  });
  await expect(a.locator("#counter")).toHaveText("Shared count: 1");
  await expectIds(a, ["alice", "bob"]);
  results.push({
    scope: "shared cursor room",
    checks: [
      "cross-page identity discovery",
      "page data isolation",
      "page presence isolation",
      "retained cursor socket across navigation",
    ],
  });
  await shot(a, "domain-room");
  await ac.close();
  await bc.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { host, run, results, pageErrors: errors, expectedDisconnectErrors },
      null,
      2,
    ),
  );
} catch (error) {
  for (const ctx of browser.contexts())
    for (const page of ctx.pages()) {
      console.log(
        "failure state",
        await page
          .evaluate(() => ({
            users: window.app?.roomId ? window.app.users.getAll() : [],
            sockets: window.socketLog?.map(({ socket, sent }) => ({
              url: socket.url,
              state: socket.readyState,
              joins: sent.filter(
                (x) => typeof x === "string" && x.includes("presence-join"),
              ),
            })),
          }))
          .catch(() => null),
      );
    }
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
