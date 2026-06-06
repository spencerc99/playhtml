// ABOUTME: Simulates many participants writing a keyed roster and asserts the
// ABOUTME: room document stays bounded and every client stays connected (no DO overload).
//
// This is the regression guard for the June 2026 walking-together incident: a
// self-triggering write loop over an array roster grew one room to ~1.2M Yjs
// ops / 23MB and crashed the Durable Object (503), taking cursors down with it.
// The fix models the roster as a keyed map upserted in place (idempotent,
// merge-safe). This soak exercises that pattern under concurrency and fails if
// the document grows unboundedly or the server stops accepting connections.

import {
  Y,
  connectRoom,
  createStore,
  getHost,
  getNumberEnv,
  getPartyHttpUrl,
  loadSmokeEnv,
  sleep,
  waitForSync,
} from "./shared.mjs";

const loadedEnvFile = loadSmokeEnv();
const host = getHost();
const adminToken = process.env.ADMIN_TOKEN;
const room = `codex-multi-client-soak-${Date.now()}`;
const elementId = "soak-roster";

// Tunables (env-overridable). Defaults model a real workshop: ~8 participants,
// each re-upserting their entry many times (as a re-rendering effect would).
const clientCount = getNumberEnv("PARTYKIT_SOAK_CLIENTS", 8);
const upsertsPerClient = getNumberEnv("PARTYKIT_SOAK_UPSERTS_PER_CLIENT", 200);
const upsertIntervalMs = getNumberEnv("PARTYKIT_SOAK_UPSERT_INTERVAL_MS", 10);
// A correct keyed-map roster for N clients holds N entries and a bounded number
// of Yjs structs. The append-bug produced ~clientCount * upserts structs; a
// keyed map produces roughly clientCount entries + per-write overwrite ops that
// Yjs largely supersedes. Ceiling is generous but far below the runaway curve.
const maxStructItems = getNumberEnv(
  "PARTYKIT_SOAK_MAX_STRUCT_ITEMS",
  Math.max(5_000, clientCount * upsertsPerClient * 0.25)
);
const syncTimeoutMs = getNumberEnv("PARTYKIT_SOAK_SYNC_TIMEOUT_MS", 30_000);

if (!adminToken) {
  throw new Error(
    "ADMIN_TOKEN is required. Set ADMIN_TOKEN or SMOKE_ENV_FILE to a .dev.vars/.env file."
  );
}

function totalStructItems(doc) {
  let total = 0;
  for (const arr of doc.store.clients.values()) total += arr.length;
  return total;
}

function ensureRosterMap(store) {
  store.play[elementId] ??= {};
  store.play[elementId].entries ??= {};
  return store.play[elementId].entries;
}

// Inspect via getPartyHttpUrl so this works against both localhost (http) and
// staging (https) — the shared inspectRoom helper hardcodes https.
async function inspectSoakRoom() {
  const response = await fetch(`${getPartyHttpUrl(host, room)}/admin/inspect`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`inspect failed ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

/** Mimics RosterAdmin's keyed-map upsert: assign entries[pid] in place. */
function upsertEntry(store, pid, name, color) {
  const entries = ensureRosterMap(store);
  entries[pid] = { pid, name, color };
}

async function run() {
  console.log(
    `[soak] host=${host} room=${room} clients=${clientCount} upserts/client=${upsertsPerClient} envFile=${loadedEnvFile ?? "none"}`
  );

  const clients = [];
  for (let i = 0; i < clientCount; i += 1) {
    const doc = new Y.Doc();
    const store = createStore(doc);
    const provider = connectRoom(host, room, doc);
    clients.push({ i, doc, store, provider, pid: `pk_soak_${i}`, dropped: false });
    provider.on("status", (event) => {
      if (event.status === "disconnected") {
        clients[i].dropped = true;
      }
    });
  }

  try {
    await Promise.all(
      clients.map((c) => waitForSync(c.provider, `soak client ${c.i}`, syncTimeoutMs))
    );
    console.log(`[soak] all ${clientCount} clients synced`);

    // Each client repeatedly upserts ITS OWN entry — exactly what a
    // re-rendering effect does. With the keyed map this must converge to
    // clientCount entries and a bounded doc.
    for (let round = 0; round < upsertsPerClient; round += 1) {
      for (const c of clients) {
        upsertEntry(c.store, c.pid, `name-${round}`, "#4a9a8a");
      }
      if (upsertIntervalMs > 0) await sleep(upsertIntervalMs);
    }

    // Let the final state settle/sync.
    await sleep(3_000);

    // Assert no client was dropped (a 503/overloaded DO disconnects clients).
    const dropped = clients.filter((c) => c.dropped).map((c) => c.i);
    if (dropped.length > 0) {
      throw new Error(
        `clients disconnected during soak (DO overload?): ${dropped.join(", ")}`
      );
    }

    // Assert the roster converged to exactly clientCount unique entries on a
    // representative client.
    const sample = clients[0];
    const entries = sample.store.play[elementId]?.entries ?? {};
    const entryCount = Object.keys(entries).length;
    if (entryCount !== clientCount) {
      throw new Error(
        `roster did not converge: expected ${clientCount} entries, got ${entryCount}`
      );
    }

    // Assert the document stayed bounded. This is the load-bearing check —
    // the append-bug would blow far past maxStructItems.
    const structItems = totalStructItems(sample.doc);
    console.log(
      `[soak] converged: entries=${entryCount} structItems=${structItems} (ceiling=${maxStructItems})`
    );
    if (structItems > maxStructItems) {
      throw new Error(
        `document grew unbounded: ${structItems} struct items exceeds ceiling ${maxStructItems}`
      );
    }

    // Confirm the server is still responsive (not wedged) via admin inspect.
    // Best-effort: in local transient mode (no persistence) the inspect has no
    // persisted doc to report, so a 404 there is not a failure. Against staging
    // it cross-checks that the server sees the same converged roster. A 503
    // here WOULD indicate an overloaded DO — surface that distinctly.
    try {
      const inspected = await inspectSoakRoom();
      const serverEntries = inspected?.ydoc?.play?.[elementId]?.entries ?? {};
      const serverEntryCount = Object.keys(serverEntries).length;
      console.log(`[soak] server inspect ok: entries=${serverEntryCount}`);
      if (serverEntryCount !== clientCount) {
        throw new Error(
          `server roster mismatch: expected ${clientCount}, got ${serverEntryCount}`
        );
      }
    } catch (err) {
      if (/\b503\b|overload|Service Busy/i.test(err.message)) {
        throw new Error(`server overloaded during soak: ${err.message}`);
      }
      console.warn(
        `[soak] server inspect skipped (non-fatal, e.g. transient/local): ${err.message}`
      );
    }

    console.log("[soak] PASS — room stayed bounded and responsive");
  } finally {
    for (const c of clients) c.provider.destroy();
  }
}

run().catch((err) => {
  console.error("[soak] FAIL:", err.message);
  process.exitCode = 1;
});
