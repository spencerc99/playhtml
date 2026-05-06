// ABOUTME: Verifies empty-room compaction creates a reset boundary on staging.
// ABOUTME: Exercises real WebSocket clients, delayed alarms, admin inspect, and reconnects.
import {
  Y,
  connectRoom,
  createStore,
  getHost,
  getNumberEnv,
  loadSmokeEnv,
  sleep,
  waitForRoomReset,
  waitForSync,
} from "./shared.mjs";

const loadedEnvFile = loadSmokeEnv();
const host = getHost();
const adminToken = process.env.ADMIN_TOKEN;
const room = `codex-empty-compaction-${Date.now()}`;
const elementId = "shared";
const compactDelayMs = getNumberEnv(
  "PARTYKIT_EMPTY_ROOM_COMPACT_DELAY_MS",
  5 * 60 * 1000
);
const shouldVerifyNoopAlarm =
  process.env.PARTYKIT_SKIP_COMPACTION_SETTLE_CHECK !== "1";

if (!adminToken) {
  throw new Error(
    "ADMIN_TOKEN is required. Set ADMIN_TOKEN or SMOKE_ENV_FILE to a .dev.vars/.env file."
  );
}

function connectSmokeRoom(doc, params = {}) {
  return connectRoom(host, room, doc, params);
}

async function inspectRoom() {
  const response = await fetch(
    `https://${host}/parties/main/${encodeURIComponent(room)}/admin/inspect`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`inspect returned non-JSON ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`inspect failed ${response.status}: ${text}`);
  }
  return body;
}

async function waitForCompaction(beforeResetEpoch, timeoutMs = 2 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const inspected = await inspectRoom();
    if (
      inspected.resetEpoch !== null &&
      inspected.resetEpoch !== beforeResetEpoch
    ) {
      return inspected;
    }
    console.log(
      `waiting for compaction: size=${inspected.documentSize}, resetEpoch=${inspected.resetEpoch}`
    );
    await sleep(10_000);
  }
  throw new Error("timed out waiting for empty-room compaction");
}

console.log(`host=${host}`);
console.log(`env=${loadedEnvFile ?? "process.env"}`);
console.log(`room=${room}`);

const doc = new Y.Doc();
const store = createStore(doc);
const provider = connectSmokeRoom(doc);
await waitForSync(provider, "initial");

doc.transact(() => {
  store.play.canMove = {};
  store.play.canMove[elementId] = { x: 0, y: 1 };
  for (let i = 1; i <= 2_000; i += 1) {
    store.play.canMove[`temp-${i}`] = { x: i, y: i };
  }
});

for (let i = 1; i <= 2_000; i += 1) {
  delete store.play.canMove[`temp-${i}`];
}
store.play.canMove[elementId].x = 2_000;

console.log("waiting for connected raw autosave");
await sleep(20_000);
const before = await inspectRoom();
console.log(
  `before disconnect: size=${before.documentSize}, resetEpoch=${before.resetEpoch}, x=${before.ydoc.play.canMove[elementId].x}`
);

provider.destroy();
console.log(`waiting ${compactDelayMs / 1000}s for empty-room compact alarm`);
await sleep(compactDelayMs + 20_000);

const after = await waitForCompaction(before.resetEpoch);
console.log(
  `after compaction: size=${after.documentSize}, resetEpoch=${after.resetEpoch}, x=${after.ydoc.play.canMove[elementId].x}`
);

if (after.connections !== 0) {
  throw new Error(
    `expected zero connections after compaction, got ${after.connections}`
  );
}
if (after.resetEpoch === null) {
  throw new Error("expected resetEpoch after compaction");
}
if (after.documentSize >= before.documentSize) {
  throw new Error(
    `expected compacted size below raw size: before=${before.documentSize}, after=${after.documentSize}`
  );
}

const staleProvider = connectSmokeRoom(doc);
const staleResetEpoch = await waitForRoomReset(staleProvider);
console.log(`stale reconnect received room-reset resetEpoch=${staleResetEpoch}`);
staleProvider.destroy();

const freshDoc = new Y.Doc();
const freshStore = createStore(freshDoc);
const freshProvider = connectSmokeRoom(freshDoc, {
  clientResetEpoch: String(after.resetEpoch),
});

try {
  await waitForSync(freshProvider, "fresh");
  const x = freshStore.play.canMove?.[elementId]?.x;
  console.log(`fresh reconnect observed x=${x}`);
  if (x !== 2_000) {
    throw new Error(`expected fresh reconnect to observe x=2000, got ${x}`);
  }
} finally {
  freshProvider.destroy();
}

if (shouldVerifyNoopAlarm) {
  console.log(
    `waiting ${compactDelayMs / 1000}s for post-reconnect no-op compact alarm`
  );
  await sleep(compactDelayMs + 20_000);

  const settled = await inspectRoom();
  console.log(
    `after no-op alarm window: size=${settled.documentSize}, resetEpoch=${settled.resetEpoch}`
  );

  if (settled.resetEpoch !== after.resetEpoch) {
    throw new Error(
      `expected resetEpoch to remain ${after.resetEpoch}, got ${settled.resetEpoch}`
    );
  }
  if (settled.documentSize !== after.documentSize) {
    throw new Error(
      `expected document size to remain ${after.documentSize}, got ${settled.documentSize}`
    );
  }
}

console.log("empty-room compaction smoke passed");
