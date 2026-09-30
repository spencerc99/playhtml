// ABOUTME: Runs write-behind persistence against local Wrangler and local Supabase.
// ABOUTME: Crashes the Worker mid-log, checks recovery, checkpoints, and database-edit precedence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Y,
  connectRoom,
  createStore,
  inspectRoom,
  sleep,
  waitForSync,
} from "./shared.mjs";

// Usage (from the repo root, with `bun run db:start` and `bun run db:local-env`
// done and partykit/.dev.vars holding ADMIN_TOKEN and PARTYKIT_BRIDGE_SECRET):
//   node smoke-tests/partykit/write-behind-smoke.mjs
// Measure database writes for a room under steady edits instead:
//   WRITE_BEHIND_SMOKE_MODE=measure node smoke-tests/partykit/write-behind-smoke.mjs
// WRITE_BEHIND_SMOKE_CONFIG points the measurement at another Wrangler config,
// such as a copy of the server from before write-behind.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wranglerPath = resolve(repoRoot, "node_modules/.bin/wrangler");
const port = process.env.PLAYHTML_PARTYKIT_SMOKE_PORT ?? "2031";
const host = `127.0.0.1:${port}`;
const mode = process.env.WRITE_BEHIND_SMOKE_MODE ?? "verify";
const wranglerConfig =
  process.env.WRITE_BEHIND_SMOKE_CONFIG ?? "partykit/wrangler.jsonc";
const checkpointIntervalMs = Number(
  process.env.WRITE_BEHIND_SMOKE_CHECKPOINT_MS ??
    (mode === "measure" ? 5 * 60_000 : 20_000)
);

function readEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}; see the usage note in this file.`);
  }
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const partyEnvPath = resolve(repoRoot, "partykit/.dev.vars");
const supabaseEnvPath = resolve(repoRoot, ".dev.vars.supabase");
const partyEnv = readEnvFile(partyEnvPath);
const supabaseEnv = readEnvFile(supabaseEnvPath);
const adminToken = partyEnv.ADMIN_TOKEN;
assert.ok(adminToken, "partykit/.dev.vars must set ADMIN_TOKEN");
assert.ok(
  /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(supabaseEnv.SUPABASE_URL),
  `this smoke only runs against a local Supabase, got ${supabaseEnv.SUPABASE_URL}`
);

const persistDir = mkdtempSync(join(tmpdir(), "write-behind-smoke-"));
let worker = null;
let serverOutput = [];

async function startWorker() {
  serverOutput = [];
  worker = spawn(
    wranglerPath,
    [
      "dev",
      "--config",
      wranglerConfig,
      "--ip",
      "127.0.0.1",
      "--port",
      port,
      // A distinct inspector port lets several smokes run side by side.
      "--inspector-port",
      String(Number(port) + 7000),
      "--persist-to",
      persistDir,
      "--env-file",
      partyEnvPath,
      "--env-file",
      supabaseEnvPath,
      "--var",
      `WRITE_BEHIND_CHECKPOINT_INTERVAL_MS:${checkpointIntervalMs}`,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so a crash can kill workerd along with Wrangler.
      detached: true,
    }
  );
  worker.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
  worker.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`Worker exited early\n${serverOutput.join("")}`);
    }
    if (serverOutput.join("").includes(`Ready on http://127.0.0.1:${port}`)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Worker did not start\n${serverOutput.join("")}`);
}

// SIGKILL to the whole group: no close handlers, no graceful checkpoint.
async function crashWorker() {
  const exited = once(worker, "exit");
  process.kill(-worker.pid, "SIGKILL");
  await exited;
  worker = null;
  await sleep(500);
}

async function stopWorker() {
  if (!worker) return;
  const exited = once(worker, "exit");
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {}
  const timeout = setTimeout(() => {
    try {
      process.kill(-worker.pid, "SIGKILL");
    } catch {}
  }, 5_000);
  await exited;
  clearTimeout(timeout);
  worker = null;
}

function countServerLines(text) {
  return serverOutput.join("").split(text).length - 1;
}

const restHeaders = {
  apikey: supabaseEnv.SUPABASE_KEY,
  Authorization: `Bearer ${supabaseEnv.SUPABASE_KEY}`,
  "content-type": "application/json",
};

async function readRow(room) {
  const response = await fetch(
    `${supabaseEnv.SUPABASE_URL}/rest/v1/documents?name=eq.${encodeURIComponent(
      room
    )}&select=version,document`,
    { headers: restHeaders }
  );
  assert.equal(response.status, 200, await response.clone().text());
  const rows = await response.json();
  return rows[0] ?? null;
}

async function replaceRowDocument(room, documentBase64) {
  const response = await fetch(
    `${supabaseEnv.SUPABASE_URL}/rest/v1/documents?name=eq.${encodeURIComponent(
      room
    )}`,
    {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ document: documentBase64 }),
    }
  );
  assert.equal(response.status, 204, await response.text());
}

function rowPlay(row) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(row.document, "base64")));
  return doc.getMap("play").toJSON();
}

async function openClient(room, label) {
  const doc = new Y.Doc();
  const store = createStore(doc);
  const provider = connectRoom(host, room, doc);
  await waitForSync(provider, label);
  return { doc, store, provider };
}

async function closeClient(client) {
  client.provider.disconnect();
  client.provider.destroy();
  client.doc.destroy();
  await sleep(200);
}

async function waitFor(label, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function verify() {
  const room = `write-behind-smoke-${Date.now()}`;
  console.log(`[write-behind] room=${room} checkpointMs=${checkpointIntervalMs}`);
  await startWorker();

  // 1. Edits in a busy room are logged, not written to the database.
  const first = await openClient(room, "first client");
  first.store.play.smoke = {};
  for (let index = 0; index < 10; index += 1) {
    first.store.play.smoke[`edit-${index}`] = index;
    await sleep(300);
  }
  await sleep(4_000); // past the 3 s autosave debounce
  assert.equal(await readRow(room), null, "no checkpoint expected yet");
  console.log("[write-behind] PASS busy room logged 10 edits with no database write");

  // 2. A crash keeps the logged edits.
  await crashWorker();
  await startWorker();
  const recovered = await openClient(room, "after crash");
  assert.deepEqual(
    recovered.doc.getMap("play").toJSON().smoke,
    Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`edit-${i}`, i]))
  );
  assert.equal(await readRow(room), null, "recovery came from the log");
  console.log("[write-behind] PASS crash recovery replayed the log");

  // 3. The checkpoint alarm writes an idle room's log to the database.
  const checkpointed = await waitFor(
    "checkpoint alarm",
    async () => {
      const row = await readRow(room);
      return row && rowPlay(row).smoke?.["edit-9"] === 9 ? row : null;
    },
    checkpointIntervalMs + 20_000
  );
  const inspected = await inspectRoom({ host, room, adminToken });
  assert.equal(inspected.writeBehind.logEntries, 0);
  assert.equal(inspected.writeBehind.baseVersion, checkpointed.version);
  console.log("[write-behind] PASS checkpoint alarm wrote the idle room");

  // 4. The last client leaving writes new edits right away.
  recovered.store.play.smoke["on-leave"] = true;
  await sleep(4_000);
  assert.equal(rowPlay(await readRow(room)).smoke["on-leave"], undefined);
  await closeClient(recovered);
  await closeClient(first);
  await waitFor("empty-room checkpoint", async () => {
    const row = await readRow(room);
    return rowPlay(row).smoke["on-leave"] === true;
  });
  console.log("[write-behind] PASS empty room checkpointed");

  // 5. A database edit made while the room is down wins over its log.
  const editor = await openClient(room, "before manual edit");
  editor.store.play.smoke["unsaved"] = "logged only";
  await sleep(4_000);
  await crashWorker();
  const manual = new Y.Doc();
  const manualStore = createStore(manual);
  manualStore.play.smoke = { manual: "wins" };
  await replaceRowDocument(
    room,
    Buffer.from(Y.encodeStateAsUpdate(manual)).toString("base64")
  );
  editor.provider.destroy();
  await startWorker();
  const afterEdit = await openClient(room, "after manual edit");
  assert.deepEqual(afterEdit.doc.getMap("play").toJSON().smoke, {
    manual: "wins",
  });
  const orphaned = await inspectRoom({ host, room, adminToken });
  assert.ok(orphaned.writeBehind.orphan, "the superseded log is kept");
  assert.ok(countServerLines("WRITE-BEHIND LOG ORPHANED") >= 1);
  await closeClient(afterEdit);
  console.log("[write-behind] PASS database edit won over the log");

  console.log("[write-behind] PASS all");
}

// Counts database writes for one room while a client edits in bursts, the way
// people click around a page: a few edits, then a pause longer than the
// autosave debounce.
async function measure() {
  const room = `write-behind-measure-${Date.now()}`;
  const durationMs = Number(process.env.WRITE_BEHIND_SMOKE_DURATION_MS ?? 60_000);
  const burstGapMs = Number(process.env.WRITE_BEHIND_SMOKE_BURST_GAP_MS ?? 4_000);
  await startWorker();
  const client = await openClient(room, "measure");
  client.store.play.measure = {};
  const versions = new Set();
  let edits = 0;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const row = await readRow(room);
      if (row) versions.add(row.version);
      await sleep(100);
    }
  })();

  const started = Date.now();
  while (Date.now() - started < durationMs) {
    for (let index = 0; index < 5; index += 1) {
      client.store.play.measure[`key-${edits % 50}`] = edits;
      edits += 1;
      await sleep(100);
    }
    await sleep(burstGapMs);
  }
  await sleep(4_000);
  polling = false;
  await poller;
  const fullSaves = countServerLines("[PartyServer] Autosave: room=");
  const minutes = durationMs / 60_000;
  console.log(
    `[write-behind] MEASURE config=${wranglerConfig} durationMs=${durationMs} edits=${edits} ` +
      `rowVersions=${versions.size} fullDocumentSaves=${fullSaves} ` +
      `fullDocumentSavesPerMinute=${(fullSaves / minutes).toFixed(1)}`
  );
  await closeClient(client);
}

try {
  if (mode === "measure") await measure();
  else await verify();
} catch (error) {
  console.error("[write-behind] FAIL", error);
  console.error(serverOutput.join("").split("\n").slice(-80).join("\n"));
  process.exitCode = 1;
} finally {
  await stopWorker();
  rmSync(persistDir, { recursive: true, force: true });
  process.exit();
}
