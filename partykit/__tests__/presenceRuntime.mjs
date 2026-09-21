// ABOUTME: Exercises presence persistence against real hibernating Workers WebSockets.
// ABOUTME: Measures native attachment writes and verifies batching, rejection, and recovery.
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
      export class Presence extends PresenceServer {
        incarnation = crypto.randomUUID();
        async onRequest(request) {
          const action = await request.json();
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
    const errored = await inspect({
      messages: [cursor(92), cursor(93)],
      error: true,
    });
    assert.equal(errored.diagnostics.length, 2);
    assert.match(
      errored.diagnostics[0][0],
      /WebSocket error: room=test connection=sender/,
    );
    assert.equal(errored.diagnostics[0][1], "Error: fixture failure");
    assert.match(
      errored.diagnostics[1][0],
      /code=1011 reason="fixture failure"/,
    );
    await sleep(40);
    assert.equal(
      (await inspect()).writes - errorStart.writes,
      1,
      "error discards the pending trailing attachment write",
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
      }),
    );
  } finally {
    for (const ws of sockets) ws.close(1000);
    await mf.dispose();
  }
});
