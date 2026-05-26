// ABOUTME: Verifies PartyServer abuse limits against a real Worker WebSocket endpoint.
// ABOUTME: Confirms normal Yjs and awareness traffic works while explicit abuse is closed.
import {
  WebSocket,
  Y,
  connectRoom,
  createStore,
  getHost,
  getNumberEnv,
  getPartyHttpUrl,
  getPartyWebSocketUrl,
  sleep,
  waitForSync,
} from "./shared.mjs";

const host = getHost();
const stamp = Date.now();
const normalRoom = `codex-server-limits-normal-${stamp}`;
const oversizedRoom = `codex-server-limits-oversized-${stamp}`;
const oversizedRequestRoom = `codex-server-limits-request-${stamp}`;
const rateRoom = `codex-server-limits-rate-${stamp}`;
const maxMessageBytes = getNumberEnv(
  "PARTYKIT_SMOKE_MAX_MESSAGE_BYTES",
  1024 * 1024 * 32
);
const maxRequestBytes = getNumberEnv(
  "PARTYKIT_SMOKE_MAX_REQUEST_BYTES",
  1024 * 1024 * 16
);
const messageRateLimit = getNumberEnv(
  "PARTYKIT_SMOKE_MESSAGE_RATE_LIMIT",
  1000
);
const normalTrafficLimit = Math.max(1, Math.floor((messageRateLimit - 1) / 2));
const normalTrafficMessages = Math.min(
  getNumberEnv("PARTYKIT_SMOKE_NORMAL_MESSAGES", 420),
  normalTrafficLimit
);

function waitForPosition(store, expectedX, label, timeoutMs = 20_000) {
  return new Promise((resolvePosition, reject) => {
    const started = Date.now();

    async function poll() {
      while (Date.now() - started < timeoutMs) {
        const position = store.play.canMove?.shared ?? null;
        if (position?.x === expectedX) {
          console.log(`${label}: observed x=${expectedX}`);
          resolvePosition(position);
          return;
        }
        await sleep(100);
      }

      reject(
        new Error(
          `${label} did not observe x=${expectedX}; last=${JSON.stringify(
            store.play.canMove?.shared ?? null
          )}`
        )
      );
    }

    poll();
  });
}

function waitForAwareness(
  provider,
  label,
  expectedSequence = undefined,
  timeoutMs = 20_000
) {
  return new Promise((resolveAwareness, reject) => {
    const started = Date.now();

    async function poll() {
      while (Date.now() - started < timeoutMs) {
        for (const state of provider.awareness.getStates().values()) {
          const smoke = state?.smoke;
          if (
            smoke?.ok === true &&
            (expectedSequence === undefined ||
              smoke.sequence === expectedSequence)
          ) {
            console.log(`${label}: observed awareness`);
            resolveAwareness(state.smoke);
            return;
          }
        }
        await sleep(100);
      }

      reject(new Error(`${label} did not observe awareness`));
    }

    poll();
  });
}

function watchDisconnect(provider, label) {
  let disconnected = false;
  const onStatus = (event) => {
    if (event.status === "disconnected") {
      disconnected = true;
    }
  };

  provider.on("status", onStatus);

  return () => {
    provider.off("status", onStatus);
    if (disconnected) {
      throw new Error(`${label} disconnected during normal traffic`);
    }
  };
}

function openRawRoom(room) {
  const url = getPartyWebSocketUrl(host, room);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  return ws;
}

function waitForOpen(ws, label, timeoutMs = 20_000) {
  return new Promise((resolveOpen, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolveOpen();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} did not open within ${timeoutMs}ms`));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolveOpen();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
    }

    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

function waitForClose(ws, label, timeoutMs = 20_000) {
  return new Promise((resolveClose, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      reject(new Error(`${label} closed before close listener was attached`));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} did not close within ${timeoutMs}ms`));
    }, timeoutMs);

    const onClose = (code, reasonBuffer) => {
      cleanup();
      resolveClose({ code, reason: reasonBuffer.toString() });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timer);
      ws.off("close", onClose);
      ws.off("error", onError);
    }

    ws.on("close", onClose);
    ws.on("error", onError);
  });
}

function assertClose(closeEvent, expectedCode, expectedReason, label) {
  if (
    closeEvent.code !== expectedCode ||
    closeEvent.reason !== expectedReason
  ) {
    throw new Error(
      `${label} closed with code=${closeEvent.code} reason=${closeEvent.reason}; ` +
        `expected code=${expectedCode} reason=${expectedReason}`
    );
  }
}

async function runNormalTrafficCase() {
  const firstDoc = new Y.Doc();
  const secondDoc = new Y.Doc();
  const firstStore = createStore(firstDoc);
  const secondStore = createStore(secondDoc);
  const firstProvider = connectRoom(host, normalRoom, firstDoc);
  const secondProvider = connectRoom(host, normalRoom, secondDoc);

  try {
    await Promise.all([
      waitForSync(firstProvider, "normal first"),
      waitForSync(secondProvider, "normal second"),
    ]);

    firstStore.play.canMove = {};
    firstStore.play.canMove.shared = { x: 1, y: 2 };
    await waitForPosition(secondStore, 1, "normal sync");

    firstProvider.awareness.setLocalStateField("smoke", { ok: true });
    await waitForAwareness(secondProvider, "normal awareness");

    const assertStayedConnected = watchDisconnect(
      firstProvider,
      "normal provider"
    );
    const finalAwarenessSequence =
      normalTrafficMessages % 2 === 0
        ? normalTrafficMessages - 2
        : normalTrafficMessages - 1;

    for (let i = 0; i < normalTrafficMessages; i += 1) {
      firstStore.play.canMove.shared = { x: i + 2, y: i + 3 };
      if (i % 2 === 0) {
        firstProvider.awareness.setLocalStateField("smoke", {
          ok: true,
          sequence: i,
        });
      }
    }

    await waitForPosition(
      secondStore,
      normalTrafficMessages + 1,
      "normal sustained sync"
    );
    await waitForAwareness(
      secondProvider,
      "normal sustained awareness",
      finalAwarenessSequence
    );
    assertStayedConnected();
  } finally {
    firstProvider.destroy();
    secondProvider.destroy();
  }
}

async function runOversizedMessageCase() {
  const ws = openRawRoom(oversizedRoom);
  await waitForOpen(ws, "oversized raw client");

  const closePromise = waitForClose(ws, "oversized raw client");
  ws.send(Buffer.alloc(maxMessageBytes + 1));
  const closeEvent = await closePromise;
  assertClose(closeEvent, 1009, "Message Too Large", "oversized raw client");
  console.log(
    `oversized raw client: closed code=${closeEvent.code} reason=${closeEvent.reason}`
  );
}

async function runOversizedRequestCase() {
  const response = await fetch(getPartyHttpUrl(host, oversizedRequestRoom), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(maxRequestBytes + 1),
  });
  const text = await response.text();

  if (response.status !== 413 || text !== "Payload Too Large") {
    throw new Error(
      `oversized request returned ${response.status} ${text}; expected 413 Payload Too Large`
    );
  }

  console.log(`oversized request: status=${response.status} body=${text}`);
}

async function runRateLimitCase() {
  const ws = openRawRoom(rateRoom);
  await waitForOpen(ws, "rate-limit raw client");

  const closePromise = waitForClose(ws, "rate-limit raw client");
  for (let i = 0; i <= messageRateLimit; i += 1) {
    ws.send(Uint8Array.from([3]));
  }

  const closeEvent = await closePromise;
  assertClose(
    closeEvent,
    1008,
    "Message Rate Limit Exceeded",
    "rate-limit raw client"
  );
  console.log(
    `rate-limit raw client: closed code=${closeEvent.code} reason=${closeEvent.reason}`
  );
}

console.log(`host=${host}`);
console.log(`normalRoom=${normalRoom}`);
console.log(`maxMessageBytes=${maxMessageBytes}`);
console.log(`maxRequestBytes=${maxRequestBytes}`);
console.log(`messageRateLimit=${messageRateLimit}`);
console.log(`normalTrafficMessages=${normalTrafficMessages}`);
await runNormalTrafficCase();
await runOversizedMessageCase();
await runOversizedRequestCase();
await runRateLimitCase();
console.log("server limits smoke passed");
