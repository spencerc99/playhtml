// ABOUTME: Exercises presence persistence against real hibernating Workers WebSockets.
// ABOUTME: Measures attachment writes and wakes; verifies batching, recovery, pings, and sweeps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const worker = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { PresenceServer } from "./partykit/presenceServer.ts";
      import { routePartykitRequest } from "partyserver";
      const writes = new Map();
      const nativeSerialize = WebSocket.prototype.serializeAttachment;
      WebSocket.prototype.serializeAttachment = function(value) {
        const result = nativeSerialize.call(this, value);
        const id = value.__pk.id;
        writes.set(id, (writes.get(id) ?? 0) + 1);
        return result;
      };
      // Counts the Durable Object invocations that wake the room.
      const wakes = { message: 0, alarm: 0 };
      export class Presence extends PresenceServer {
        incarnation = crypto.randomUUID();
        async webSocketMessage(ws, message) {
          wakes.message += 1;
          return super.webSocketMessage(ws, message);
        }
        async alarm() {
          wakes.alarm += 1;
          return super.alarm();
        }
        async onRequest(request) {
          const action = await request.json();
          if (action.sweep) await this.onAlarm();
          const connection = this.getConnection(action.id);
          if (action.messages) {
            for (const message of action.messages) {
              this.onMessage(connection, JSON.stringify(message));
            }
          }
          if (action.syncObserver) {
            this.onConnect(this.getConnection("observer"), {});
          }
          const diagnostics = [];
          if (action.error) {
            const error = console.error;
            const warn = console.warn;
            console.error = (...values) => diagnostics.push(values.map(String));
            console.warn = (...values) => diagnostics.push(values.map(String));
            try { this.onError(connection, new Error("fixture failure")); }
            finally { console.error = error; console.warn = warn; }
          }
          if (action.close) this.onClose(connection, 1000, "", true);
          return Response.json({
            diagnostics,
            wakes: { ...wakes },
            alarm: await this.ctx.storage.getAlarm(),
            incarnation: this.incarnation,
            writes: writes.get(action.id) ?? 0,
            state: connection?.state,
            attachment: connection
              ? WebSocket.prototype.deserializeAttachment.call(connection).__user
              : null,
          });
        }
      }
      export default { fetch(request, env) {
        return routePartykitRequest(request, env);
      }};
    `,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:workers"],
  plugins: process.env.PRESENCE_BASE_REF
    ? [
        {
          name: "presence-revision",
          setup(builder) {
            builder.onLoad(
              { filter: /partykit\/presence(Server|Policy|Message)\.ts$/ },
              (args) => ({
                contents: execFileSync(
                  "git",
                  [
                    "show",
                    `${process.env.PRESENCE_BASE_REF}:${args.path.slice(root.length)}`,
                  ],
                  { cwd: root, encoding: "utf8" },
                ),
                loader: "ts",
              }),
            );
          },
        },
      ]
    : [],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cursor = (x) => ({
  type: "presence-update",
  channel: "cursor",
  value: { cursor: { x, y: x, pointer: "mouse" } },
});

test("native presence attachment writes are batched and recoverable", async () => {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2024-09-23",
    compatibilityFlags: ["nodejs_compat"],
    script: worker.outputFiles[0].text,
    durableObjects: {
      Presence: {
        className: "Presence",
        useSQLite: true,
        unsafePreventEviction: false,
      },
    },
  });
  const sockets = [];
  const messages = [];
  const url = "http://presence.test/parties/presence/test";
  async function connect(id) {
    const response = await mf.dispatchFetch(`${url}?_pk=${id}`, {
      headers: { Upgrade: "websocket" },
    });
    assert.equal(response.status, 101);
    const ws = response.webSocket;
    ws.accept();
    ws.addEventListener("message", (event) =>
      messages.push(JSON.parse(event.data)),
    );
    sockets.push(ws);
    return ws;
  }
  async function inspect(action = {}) {
    const response = await mf.dispatchFetch(url, {
      method: "POST",
      body: JSON.stringify({ id: "sender", ...action }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  try {
    const sender = await connect("sender");
    await connect("observer");
    await sleep(30);
    const before = await inspect();
    await inspect({
      messages: Array.from({ length: 90 }, (_, x) => cursor(x)),
    });
    await sleep(40);
    const after = await inspect();
    assert.equal(
      after.writes - before.writes,
      2,
      "one immediate write and one trailing write for the 90-message burst",
    );
    assert.deepEqual(
      after.state.__playhtmlPresenceChannels.cursor,
      cursor(89).value,
    );
    assert.deepEqual(after.attachment, after.state);

    await sleep(1000);
    const keepaliveStart = messages.length;
    sender.send(JSON.stringify(cursor(89)));
    await sleep(40);
    assert.equal((await inspect()).writes, after.writes);
    assert(
      messages
        .slice(keepaliveStart)
        .some((message) => message.updates?.sender?.cursor?.cursor?.x === 89),
    );

    sender.send(
      JSON.stringify({
        type: "presence-update",
        channel: "status",
        value: "a".repeat(9000),
      }),
    );
    await sleep(40);
    const valid = await inspect();
    const rejectionStart = messages.length;
    sender.send(
      JSON.stringify({
        type: "presence-update",
        channel: "other",
        value: "b".repeat(9000),
      }),
    );
    await sleep(40);
    const rejected = await inspect();
    assert.deepEqual(rejected.state, valid.state);
    assert.deepEqual(rejected.attachment, valid.attachment);
    assert(
      messages
        .slice(rejectionStart)
        .some(
          (message) =>
            message.type === "presence-error" &&
            message.message.includes("16,384"),
        ),
    );
    assert(
      !messages
        .slice(rejectionStart)
        .some((message) => message.updates?.sender?.other),
    );

    sender.send(JSON.stringify({ type: "presence-clear", channel: "status" }));
    await sleep(40);
    const cleared = await inspect();
    assert.deepEqual(cleared.state.__playhtmlPresenceChannels, {
      cursor: cursor(89).value,
    });

    const priorIncarnation = cleared.incarnation;
    await sleep(12_000);
    const recovered = await inspect();
    assert.notEqual(
      recovered.incarnation,
      priorIncarnation,
      "the local runtime must actually hibernate before the recovery assertion",
    );
    assert.deepEqual(recovered.attachment, cleared.attachment);
    const syncStart = messages.length;
    await connect("late");
    await sleep(40);
    assert(
      messages
        .slice(syncStart)
        .some(
          (message) =>
            message.type === "presence-sync" &&
            message.peers.sender?.cursor?.cursor?.x === 89,
        ),
    );

    const joinStart = await inspect();
    const joinMessagesStart = messages.length;
    await inspect({ messages: [cursor(90), cursor(91)], syncObserver: true });
    await sleep(40);
    const joined = await inspect();
    assert.equal(joined.writes - joinStart.writes, 2);
    assert(
      messages
        .slice(joinMessagesStart)
        .some(
          (message) =>
            message.type === "presence-sync" &&
            message.peers.sender?.cursor?.cursor?.x === 91,
        ),
    );
    await sleep(40);
    assert.equal(
      (await inspect()).writes,
      joined.writes,
      "synchronous join flush cancels the pending timer",
    );

    const errorStart = await inspect();
    const senderRemovals = () =>
      messages.filter((message) => message.removes?.sender).length;
    const removalsBeforeError = senderRemovals();
    const errored = await inspect({
      messages: [cursor(92), cursor(93)],
      error: true,
    });
    assert.equal(errored.diagnostics.length, 1);
    assert.match(
      errored.diagnostics[0][0],
      /WebSocket error: room=test connection=sender/,
    );
    assert.equal(errored.diagnostics[0][1], "Error: fixture failure");
    await sleep(40);
    assert.equal(
      (await inspect()).writes - errorStart.writes,
      1,
      "error discards the pending trailing attachment write",
    );
    const removalsAfterError = senderRemovals();
    assert(removalsAfterError > removalsBeforeError, "error removes the sender");
    await inspect({ close: true });
    await sleep(40);
    assert.equal(
      senderRemovals(),
      removalsAfterError,
      "a close after an error does not remove the sender again",
    );

    const closeStart = await inspect();
    await inspect({ messages: [cursor(94), cursor(95)], close: true });
    await sleep(40);
    const closed = await inspect();
    assert.equal(
      closed.writes - closeStart.writes,
      1,
      "close discards the pending trailing attachment write",
    );
    assert(
      messages.some((message) => message.removes?.sender?.includes("cursor")),
    );
    // A reconnect reuses the connection id while the old socket is still open.
    const staleClose = new Promise((resolve) => {
      const onClose = (event) => resolve(event.code);
      connect("dup").then((ws) => {
        ws.addEventListener("close", onClose);
        ws.send(JSON.stringify(cursor(5)));
      });
    });
    await sleep(40);
    const replacement = await connect("dup");
    assert.equal(
      await Promise.race([staleClose, sleep(2000).then(() => "still open")]),
      4000,
      "the older socket is replaced",
    );
    replacement.send(JSON.stringify(cursor(7)));
    await sleep(40);
    const afterReplacement = messages.length;
    // The replaced socket's close handshake completes after the new socket is live.
    await sleep(200);
    assert(
      !messages
        .slice(afterReplacement)
        .some((message) => message.removes?.dup),
      "a late close from the replaced socket keeps the new socket's presence",
    );
    const dupSyncStart = messages.length;
    await connect("dup-observer");
    await sleep(40);
    assert(
      messages
        .slice(dupSyncStart)
        .some(
          (message) =>
            message.type === "presence-sync" &&
            message.peers.dup?.cursor?.cursor?.x === 7,
        ),
    );

    console.log(
      JSON.stringify({
        burstMessages: 90,
        burstAttachmentWrites: 2,
        unchangedKeepaliveWrites: 0,
        aggregateOverflowRejected: true,
        hibernationRecovered: true,
        joinFlushedBeforeSync: true,
        errorDiscardedPendingWrite: true,
        closeDiscardedPendingWrite: true,
        errorCloseRemovedOnce: true,
        replacedSocketKeptPresence: true,
      }),
    );
  } finally {
    for (const ws of sockets) ws.close(1000);
    await mf.dispose();
  }
});

test("pings are answered without waking the room and the sweep refreshes pinging peers", async () => {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2024-09-23",
    compatibilityFlags: ["nodejs_compat"],
    script: worker.outputFiles[0].text,
    durableObjects: {
      Presence: {
        className: "Presence",
        useSQLite: true,
        unsafePreventEviction: false,
      },
    },
  });
  const sockets = [];
  const received = [];
  const url = "http://presence.test/parties/presence/liveness";
  async function connect(id) {
    const response = await mf.dispatchFetch(`${url}?_pk=${id}`, {
      headers: { Upgrade: "websocket" },
    });
    assert.equal(response.status, 101);
    const ws = response.webSocket;
    ws.accept();
    ws.addEventListener("message", (event) =>
      received.push({ to: id, data: event.data }),
    );
    sockets.push(ws);
    return ws;
  }
  async function inspect(action = {}) {
    const response = await mf.dispatchFetch(url, {
      method: "POST",
      body: JSON.stringify({ id: "pinger", ...action }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const pongsTo = (id) =>
    received.filter((message) => message.to === id && message.data === "pong")
      .length;
  const changesSince = (start) =>
    received
      .slice(start)
      .filter((message) => message.data !== "pong")
      .map((message) => JSON.parse(message.data))
      .filter((message) => message.type === "presence-changes");

  try {
    const pinger = await connect("pinger");
    const legacy = await connect("legacy");
    await connect("viewer");
    const staleAt = Date.now() - 10_000;
    for (const ws of [pinger, legacy]) {
      ws.send(
        JSON.stringify({
          type: "presence-update",
          channel: "presence:status",
          value: { at: staleAt, value: "here" },
        }),
      );
      ws.send(
        JSON.stringify({
          type: "presence-update",
          channel: "cursor",
          value: { cursor: { x: 1, y: 1, pointer: "mouse" }, at: staleAt },
        }),
      );
    }
    pinger.send("ping");
    await sleep(100);
    const beforeIdle = await inspect();
    assert.ok(beforeIdle.alarm, "a room with several sockets schedules a sweep");

    // Let the room hibernate, then ping while it sleeps.
    await sleep(12_000);
    const pongsBefore = pongsTo("pinger");
    for (let index = 0; index < 5; index += 1) {
      pinger.send("ping");
      await sleep(100);
    }
    assert.equal(pongsTo("pinger") - pongsBefore, 5, "every ping is answered");
    const afterPings = await inspect();
    assert.notEqual(
      afterPings.incarnation,
      beforeIdle.incarnation,
      "the room hibernated while idle",
    );
    assert.equal(
      afterPings.wakes.message,
      beforeIdle.wakes.message,
      "answering pings never ran the room's message handler",
    );

    // The sweep refreshes the pinging peer's presence stamp only: the legacy
    // peer refreshes its own, and cursor stamps are left to fade.
    const sweepStart = received.length;
    const sweptAt = Date.now();
    await inspect({ sweep: true });
    await sleep(100);
    const changes = changesSince(sweepStart);
    const refreshed = changes.flatMap((message) =>
      Object.entries(message.updates).flatMap(([peer, channels]) =>
        Object.keys(channels).map((channel) => `${peer}/${channel}`),
      ),
    );
    assert.deepEqual([...new Set(refreshed)].sort(), ["pinger/presence:status"]);
    const refreshedStatus = changes.find(
      (message) => message.updates.pinger,
    ).updates.pinger["presence:status"];
    assert.equal(refreshedStatus.value, "here");
    assert.ok(refreshedStatus.at >= sweptAt, "the stamp is refreshed");

    // A client joining after the sweep sees the pinging peer's fresh stamp.
    const syncStart = received.length;
    await connect("late");
    await sleep(100);
    const sync = received
      .slice(syncStart)
      .map((message) => JSON.parse(message.data))
      .find((message) => message.type === "presence-sync");
    assert.ok(sync.peers.pinger["presence:status"].at >= sweptAt);
    assert.equal(sync.peers.legacy["presence:status"].at, staleAt);

    console.log(
      JSON.stringify({
        pingsAnsweredWhileHibernated: 5,
        messageHandlerRunsForPings: 0,
        sweepRefreshed: [...new Set(refreshed)],
      }),
    );
  } finally {
    for (const ws of sockets) ws.close(1000);
    await mf.dispose();
  }
});
