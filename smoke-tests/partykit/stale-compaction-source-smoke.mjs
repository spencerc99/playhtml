// ABOUTME: Recreates a stale live compaction source racing a newer persisted document.
// ABOUTME: Verifies automatic compaction does not overwrite newer Supabase room data.
import {
  Y,
  connectRoom,
  createStore,
  getHost,
  getNumberEnv,
  getPartyHttpUrl,
  inspectRoom as inspectPartyRoom,
  loadSmokeEnv,
  sleep,
  waitForSync,
} from "./shared.mjs";

const loadedEnvFile = loadSmokeEnv();
const host = getHost();
const adminToken = process.env.ADMIN_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const room = `codex-stale-compaction-source-${Date.now()}`;
const compactDelayMs = getNumberEnv(
  "PARTYKIT_EMPTY_ROOM_COMPACT_DELAY_MS",
  5 * 60 * 1000
);
const settleMs = getNumberEnv("PARTYKIT_STALE_COMPACTION_SETTLE_MS", 20_000);

if (!adminToken) {
  throw new Error(
    "ADMIN_TOKEN is required. Set ADMIN_TOKEN or SMOKE_ENV_FILE to a .dev.vars/.env file."
  );
}
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_KEY are required for direct documents-row setup."
  );
}

function encodeDoc(doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

function setWeekAttendance(store, label) {
  store.play["can-play"] = {
    "week-attendance": {
      attendees: [{ pid: `pid-${label}`, name: label, color: "#ffae00" }],
    },
  };
}

function buildCompactionBloat(store) {
  store.play.canMove = {};
  for (let i = 1; i <= 2_000; i += 1) {
    store.play.canMove[`temp-${i}`] = { x: i, y: i };
  }
  for (let i = 1; i <= 2_000; i += 1) {
    delete store.play.canMove[`temp-${i}`];
  }
}

function buildPersistedGoodDocument() {
  const doc = new Y.Doc();
  const store = createStore(doc);
  setWeekAttendance(store, "persisted-good");
  return encodeDoc(doc);
}

function getAttendanceLabel(playData) {
  return playData?.["can-play"]?.["week-attendance"]?.attendees?.[0]?.name;
}

async function adminJson(path, init = {}) {
  const response = await fetch(`${getPartyHttpUrl(host, room)}/admin/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${text}`);
  }
  return body;
}

async function inspectRoom() {
  return inspectPartyRoom({ host, room, adminToken });
}

async function writePersistedDocument(base64Document) {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(
    `${baseUrl}/rest/v1/documents?name=eq.${encodeURIComponent(room)}`,
    {
      method: "PATCH",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ document: base64Document }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `direct documents update failed ${response.status}: ${await response.text()}`
    );
  }
}

console.log(`host=${host}`);
console.log(`env=${loadedEnvFile ?? "process.env"}`);
console.log(`room=${room}`);

const liveDoc = new Y.Doc();
const liveStore = createStore(liveDoc);
const provider = connectRoom(host, room, liveDoc);

try {
  await waitForSync(provider, "initial");

  liveDoc.transact(() => {
    setWeekAttendance(liveStore, "stale-live-source");
    buildCompactionBloat(liveStore);
  });

  await adminJson("force-save-live", { method: "POST" });
  console.log("saved stale live source as the initial row");

  await writePersistedDocument(buildPersistedGoodDocument());
  console.log("replaced persisted row with newer database data");

  const comparison = await adminJson("live-compare");
  const directLabel = getAttendanceLabel(comparison.methods.direct.data);
  const liveLabel = getAttendanceLabel(comparison.methods.live.data);
  console.log(`before compaction: db=${directLabel}, live=${liveLabel}`);
  if (directLabel !== "persisted-good") {
    throw new Error(`expected DB label persisted-good, got ${directLabel}`);
  }
  if (liveLabel !== "stale-live-source") {
    throw new Error(`expected live label stale-live-source, got ${liveLabel}`);
  }

  const before = await inspectRoom();
  provider.destroy();
  console.log(
    `waiting ${compactDelayMs / 1000}s for empty-room compaction alarm`
  );
  await sleep(compactDelayMs + settleMs);

  const after = await inspectRoom();
  const afterLabel = getAttendanceLabel(after.ydoc.play);
  console.log(
    `after compaction window: db=${afterLabel}, resetEpoch=${after.resetEpoch}`
  );

  if (afterLabel !== "persisted-good") {
    throw new Error(
      `expected persisted data to survive compaction, got ${afterLabel}`
    );
  }
  if (after.resetEpoch !== before.resetEpoch) {
    throw new Error(
      `expected resetEpoch to remain ${before.resetEpoch}, got ${after.resetEpoch}`
    );
  }

  const freshDoc = new Y.Doc();
  const freshStore = createStore(freshDoc);
  const freshProvider = connectRoom(host, room, freshDoc);
  try {
    await waitForSync(freshProvider, "fresh");
    const freshLabel = getAttendanceLabel(freshStore.play);
    console.log(`fresh reconnect observed ${freshLabel}`);
    if (freshLabel !== "persisted-good") {
      throw new Error(`expected fresh client to observe persisted-good`);
    }
  } finally {
    freshProvider.destroy();
    freshDoc.destroy();
  }

  console.log("stale compaction source smoke passed");
} finally {
  provider.destroy();
  liveDoc.destroy();
}
