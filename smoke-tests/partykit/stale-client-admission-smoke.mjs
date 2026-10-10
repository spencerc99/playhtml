// ABOUTME: Verifies stale-epoch clients are held open instead of looping on reconnect.
// ABOUTME: Uses real Yjs sockets, an admin hard reset, and a legacy client with no params.
import {
  Y,
  connectRoom,
  createStore,
  getHost,
  getPartyHttpUrl,
  inspectRoom as inspectPartyRoom,
  loadSmokeEnv,
  sleep,
  waitForRoomReset,
  waitForSync,
} from "./shared.mjs";

const loadedEnvFile = loadSmokeEnv();
const host = getHost();
const adminToken = process.env.ADMIN_TOKEN;
const room = `codex-stale-admission-${Date.now()}`;
const elementId = "shared";
const observeMs = 15_000;

if (!adminToken) {
  throw new Error(
    "ADMIN_TOKEN is required. Set ADMIN_TOKEN or SMOKE_ENV_FILE to a .dev.vars/.env file."
  );
}
// This smoke hard-resets its room, so it only runs against a local server
// unless explicitly pointed elsewhere.
if (
  !/^(localhost|127\.0\.0\.1):/.test(host) &&
  process.env.ALLOW_REMOTE_HARD_RESET !== "1"
) {
  throw new Error(
    `Refusing to hard-reset a room on ${host}. Set PARTYKIT_HOST to a local server or ALLOW_REMOTE_HARD_RESET=1.`
  );
}

async function inspectRoom() {
  return inspectPartyRoom({ host, room, adminToken });
}

async function hardReset() {
  const response = await fetch(`${getPartyHttpUrl(host, room)}/admin/hard-reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`hard-reset failed ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function collectCustomMessages(provider) {
  const messages = [];
  provider.on("custom-message", (data) => messages.push(JSON.parse(data)));
  return messages;
}

async function waitFor(label, check, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      // Inspect answers 404 until the room's first autosave lands.
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(
    `timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`
  );
}

console.log(`host=${host}`);
console.log(`env=${loadedEnvFile ?? "process.env"}`);
console.log(`room=${room}`);

// A long-lived tab: it has document history and never learns the reset epoch,
// like builds that lost their room-reset handler after a reconnect.
const staleDoc = new Y.Doc();
const staleStore = createStore(staleDoc);
const staleProvider = connectRoom(host, room, staleDoc);
await waitForSync(staleProvider, "stale-tab initial");
staleStore.play.canMove = { [elementId]: { x: 1, y: 1 } };

await waitFor("initial autosave", async () => {
  const inspected = await inspectRoom();
  return inspected.ydoc?.play?.canMove?.[elementId]?.x === 1;
});

let staleConnects = 0;
staleProvider.on("status", (event) => {
  if (event.status === "connected") staleConnects += 1;
});
const staleReset = waitForRoomReset(staleProvider);

const reset = await hardReset();
console.log(`hard reset resetEpoch=${reset.resetEpoch}`);
await staleReset;
console.log("stale tab received room-reset");

console.log(`observing stale tab reconnects for ${observeMs / 1000}s`);
await sleep(observeMs);
console.log(`stale tab connected ${staleConnects} time(s) after the reset`);
if (staleConnects > 2) {
  throw new Error(
    `expected the held stale tab to stop reconnecting, saw ${staleConnects} connects in ${observeMs}ms`
  );
}

staleStore.play.canMove[elementId].x = 999;
await sleep(5_000);

const afterStaleWrite = await inspectRoom();
const serverX = afterStaleWrite.ydoc?.play?.canMove?.[elementId]?.x;
console.log(`server x after held stale write=${serverX}, connections=${afterStaleWrite.connections}`);
if (serverX !== 1) {
  throw new Error(`expected the held stale write to be ignored, server has x=${serverX}`);
}
if (afterStaleWrite.connections !== 0) {
  throw new Error(
    `expected held sockets to be excluded from connections, got ${afterStaleWrite.connections}`
  );
}

// A fresh page load from a build that sends no params at all.
const legacyDoc = new Y.Doc();
const legacyStore = createStore(legacyDoc);
const legacyProvider = connectRoom(host, room, legacyDoc);
const legacyMessages = collectCustomMessages(legacyProvider);

try {
  await waitForSync(legacyProvider, "legacy fresh load");
  const legacyX = legacyStore.play.canMove?.[elementId]?.x;
  console.log(`legacy fresh load observed x=${legacyX}`);
  if (legacyX !== 1) {
    throw new Error(`expected the legacy client to observe x=1, got ${legacyX}`);
  }

  await waitFor("reset-epoch notice", () =>
    legacyMessages.some(
      (message) =>
        message.type === "reset-epoch" && message.resetEpoch === reset.resetEpoch
    )
  );
  console.log("legacy fresh load received the reset-epoch notice");
  if (legacyMessages.some((message) => message.type === "room-reset")) {
    throw new Error("expected the fresh legacy client not to be told to reset");
  }

  legacyStore.play.canMove[elementId].x = 5;
  await waitFor("legacy write to persist", async () => {
    const inspected = await inspectRoom();
    return inspected.ydoc?.play?.canMove?.[elementId]?.x === 5;
  });
  const settled = await inspectRoom();
  console.log(`legacy write persisted, connections=${settled.connections}`);
  if (settled.connections !== 1) {
    throw new Error(`expected exactly the legacy client connected, got ${settled.connections}`);
  }
} finally {
  legacyProvider.destroy();
  staleProvider.destroy();
}

console.log("stale client admission smoke passed");
