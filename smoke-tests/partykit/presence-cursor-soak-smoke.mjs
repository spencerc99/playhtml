// ABOUTME: Soaks the generic presence transport with cursor-rate traffic.
// ABOUTME: Verifies many clients can exchange volatile cursor updates without drops.

import {
  WebSocket,
  getHost,
  getNumberEnv,
  getPresenceWebSocketUrl,
  sleep,
} from "./shared.mjs";

const host = getHost();
const room = `codex-presence-cursor-soak-${Date.now()}`;
const clientCount = getNumberEnv("PARTYKIT_PRESENCE_SOAK_CLIENTS", 20);
const cursorHz = getNumberEnv("PARTYKIT_PRESENCE_SOAK_CURSOR_HZ", 60);
const durationMs = getNumberEnv("PARTYKIT_PRESENCE_SOAK_DURATION_MS", 20_000);
const settleMs = getNumberEnv("PARTYKIT_PRESENCE_SOAK_SETTLE_MS", 1_000);
const connectTimeoutMs = getNumberEnv(
  "PARTYKIT_PRESENCE_SOAK_CONNECT_TIMEOUT_MS",
  20_000
);

function waitForOpen(ws, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} did not open within ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);

    function cleanup() {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
    }

    function onOpen() {
      cleanup();
      resolve();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordServerMessage(client, data) {
  client.received += 1;

  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (error) {
    client.protocolErrors.push(`invalid json: ${error.message}`);
    return;
  }

  if (!isRecord(message)) return;
  if (message.type === "presence-error") {
    client.protocolErrors.push(message.message ?? "presence-error");
    return;
  }
  if (message.type !== "presence-changes" || !isRecord(message.updates)) {
    return;
  }

  for (const channels of Object.values(message.updates)) {
    if (!isRecord(channels)) continue;
    const cursor = channels.cursor;
    if (!isRecord(cursor)) continue;
    const { clientIndex, seq } = cursor;
    if (
      typeof clientIndex !== "number" ||
      typeof seq !== "number" ||
      clientIndex === client.index
    ) {
      continue;
    }
    const previousSeq = client.peerUpdates.get(clientIndex) ?? -1;
    if (seq > previousSeq) {
      client.peerUpdates.set(clientIndex, seq);
    }
  }
}

async function runClient(client) {
  const intervalMs = 1000 / cursorHz;
  await sleep((client.index * intervalMs) / clientCount);
  const startedAt = Date.now();
  let tick = 0;

  while (Date.now() - startedAt < durationMs) {
    send(client.ws, {
      type: "presence-update",
      channel: "cursor",
      value: {
        cursor: {
          x: client.index * 10 + tick,
          y: client.index * 5 + tick,
          pointer: "mouse",
        },
        page: "/presence-soak",
        zone: null,
        at: Date.now(),
        clientIndex: client.index,
        seq: tick,
      },
    });
    client.sent += 1;
    tick += 1;
    await sleep(intervalMs);
  }
}

async function run() {
  const url = getPresenceWebSocketUrl(host, room);
  console.log(
    `[presence-soak] host=${host} room=${room} clients=${clientCount} hz=${cursorHz} durationMs=${durationMs}`
  );

  const clients = [];
  for (let i = 0; i < clientCount; i += 1) {
    const ws = new WebSocket(url);
    const client = {
      index: i,
      ws,
      sent: 0,
      received: 0,
      peerUpdates: new Map(),
      closes: [],
      errors: [],
      protocolErrors: [],
    };
    ws.on("message", (data) => {
      recordServerMessage(client, data);
    });
    ws.on("close", (code, reason) => {
      client.closes.push({ code, reason: reason.toString() });
    });
    ws.on("error", (error) => {
      client.errors.push(error.message);
    });
    clients.push(client);
  }

  try {
    await Promise.all(
      clients.map((client) => waitForOpen(client.ws, `client ${client.index}`))
    );

    for (const client of clients) {
      send(client.ws, {
        type: "presence-join",
        identity: {
          publicKey: `pk_presence_soak_${client.index}`,
          playerStyle: {
            colorPalette: [`hsl(${client.index * 20}, 70%, 60%)`],
          },
        },
        page: "/presence-soak",
      });
    }

    await Promise.all(clients.map(runClient));
    await sleep(settleMs);

    const closed = clients.filter((client) => client.closes.length > 0);
    const errored = clients.filter(
      (client) =>
        client.errors.length > 0 || client.protocolErrors.length > 0
    );
    const silent = clients.filter((client) => client.received === 0);
    const missingPeerUpdates = clients.filter(
      (client) => client.peerUpdates.size < clientCount - 1
    );

    const sent = clients.reduce((total, client) => total + client.sent, 0);
    const received = clients.reduce(
      (total, client) => total + client.received,
      0
    );
    console.log(
      `[presence-soak] sent=${sent} received=${received} receivedRange=${Math.min(
        ...clients.map((client) => client.received)
      )}-${Math.max(
        ...clients.map((client) => client.received)
      )} observedPeerRange=${Math.min(
        ...clients.map((client) => client.peerUpdates.size)
      )}-${Math.max(...clients.map((client) => client.peerUpdates.size))}`
    );

    if (closed.length > 0) {
      throw new Error(
        `clients closed during soak: ${closed
          .map((client) => `${client.index}:${JSON.stringify(client.closes)}`)
          .join(", ")}`
      );
    }
    if (errored.length > 0) {
      throw new Error(
        `clients errored during soak: ${errored
          .map(
            (client) =>
              `${client.index}:${[
                ...client.errors,
                ...client.protocolErrors,
              ].join("|")}`
          )
          .join(", ")}`
      );
    }
    if (silent.length > 0) {
      throw new Error(
        `clients received no presence messages: ${silent
          .map((client) => client.index)
          .join(", ")}`
      );
    }
    if (missingPeerUpdates.length > 0) {
      throw new Error(
        `clients missed peer cursor updates: ${missingPeerUpdates
          .map(
            (client) =>
              `${client.index}:${client.peerUpdates.size}/${clientCount - 1}`
          )
          .join(", ")}`
      );
    }

    console.log("[presence-soak] PASS - presence cursor traffic stayed connected");
  } finally {
    for (const client of clients) {
      client.ws.close();
    }
  }
}

run().catch((error) => {
  console.error("[presence-soak] FAIL:", error.message);
  process.exitCode = 1;
});
