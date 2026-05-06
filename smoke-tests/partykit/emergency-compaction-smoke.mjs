// ABOUTME: Verifies connected-room emergency compaction resets bloated active rooms.
// ABOUTME: Exercises real WebSocket sync, high-watermark compaction, reset close, and fresh reconnect.
import {
  Y,
  connectRoom,
  createStore,
  getHost,
  getNumberEnv,
  inspectRoom,
  loadSmokeEnv,
  waitForProviderStatus,
  waitForRoomReset,
  waitForSync,
} from "./shared.mjs";

const loadedEnvFile = loadSmokeEnv();
const host = getHost();
const adminToken = process.env.ADMIN_TOKEN;
const room = `codex-emergency-compaction-${Date.now()}`;
const elementId = "shared";
const targetRawBytes = getNumberEnv(
  "PARTYKIT_EMERGENCY_TARGET_RAW_BYTES",
  120_000
);
const batchSize = getNumberEnv("PARTYKIT_EMERGENCY_BATCH_SIZE", 2_000);
const resetTimeoutMs = getNumberEnv(
  "PARTYKIT_EMERGENCY_RESET_TIMEOUT_MS",
  3 * 60 * 1000
);

if (!adminToken) {
  throw new Error(
    "ADMIN_TOKEN is required. Set ADMIN_TOKEN or SMOKE_ENV_FILE to a .dev.vars/.env file."
  );
}

function encodedBase64Size(doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64").length;
}

function connectSmokeRoom(doc, params = {}) {
  return connectRoom(host, room, doc, params);
}

async function inspectSmokeRoom() {
  return inspectRoom({ host, room, adminToken });
}

function buildBloat({ doc, store }) {
  store.play.canMove = {};
  store.play.canMove[elementId] = { x: 0, y: 1 };

  let created = 0;
  let rawSize = encodedBase64Size(doc);

  while (rawSize < targetRawBytes) {
    doc.transact(() => {
      for (let i = 1; i <= batchSize; i += 1) {
        const id = created + i;
        store.play.canMove[`temp-${id}`] = { x: id, y: id };
      }
      for (let i = 1; i <= batchSize; i += 1) {
        const id = created + i;
        delete store.play.canMove[`temp-${id}`];
      }
    });
    created += batchSize;
    rawSize = encodedBase64Size(doc);
    console.log(`built local bloat: entries=${created}, rawSize=${rawSize}`);
  }

  store.play.canMove[elementId].x = created;
  return {
    created,
    rawSize: encodedBase64Size(doc),
  };
}

console.log(`host=${host}`);
console.log(`env=${loadedEnvFile ?? "process.env"}`);
console.log(`room=${room}`);
console.log(`targetRawBytes=${targetRawBytes}`);
const doc = new Y.Doc();
const store = createStore(doc);
const provider = connectSmokeRoom(doc);
await waitForSync(provider, "initial", 60_000);

const resetEpochPromise = waitForRoomReset(provider, resetTimeoutMs);
const disconnectedPromise = waitForProviderStatus(
  provider,
  "disconnected",
  resetTimeoutMs
);

const { created, rawSize } = buildBloat({ doc, store });
console.log(`sent bloated connected doc: entries=${created}, rawSize=${rawSize}`);

const resetEpoch = await resetEpochPromise;
console.log(`emergency compaction received room-reset resetEpoch=${resetEpoch}`);
await disconnectedPromise;
console.log("emergency compaction disconnected active client");
provider.destroy();

const compacted = await inspectSmokeRoom();
console.log(
  `after emergency compaction: size=${compacted.documentSize}, resetEpoch=${compacted.resetEpoch}, x=${compacted.ydoc.play.canMove[elementId].x}`
);

if (compacted.resetEpoch !== resetEpoch) {
  throw new Error(
    `expected inspect resetEpoch ${resetEpoch}, got ${compacted.resetEpoch}`
  );
}
if (compacted.documentSize >= rawSize) {
  throw new Error(
    `expected compacted size below raw size: before=${rawSize}, after=${compacted.documentSize}`
  );
}

const freshDoc = new Y.Doc();
const freshStore = createStore(freshDoc);
const freshProvider = connectSmokeRoom(freshDoc, {
  clientResetEpoch: String(resetEpoch),
});

try {
  await waitForSync(freshProvider, "fresh", 60_000);
  const x = freshStore.play.canMove?.[elementId]?.x;
  console.log(`fresh reconnect observed x=${x}`);
  if (x !== store.play.canMove[elementId].x) {
    throw new Error(
      `expected fresh reconnect to observe x=${store.play.canMove[elementId].x}, got ${x}`
    );
  }
} finally {
  freshProvider.destroy();
}

console.log("emergency compaction smoke passed");
