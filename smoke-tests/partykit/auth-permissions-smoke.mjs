// ABOUTME: End-to-end smoke test for the auth/permissions system against a local dev server.
// ABOUTME: Serves a .well-known config, verifies handshake, gated writes, entry rules, backstop.
//
// Usage (two terminals or let this script manage wrangler itself):
//   SUPABASE_URL=http://127.0.0.1:9 SUPABASE_KEY=bad ADMIN_TOKEN=dev \
//     bunx wrangler dev --config partykit/wrangler.jsonc --port 1999 --var SUPABASE_LOAD_TIMEOUT_MS:200 &
//   PARTYKIT_HOST=localhost:1999 node smoke-tests/partykit/auth-permissions-smoke.mjs
//
// To exercise earned roles (visit accrual), launch wrangler with a compressed
// day bucket and tell the test about it:
//   ... --var AUTH_VISIT_DAY_MS:1500
//   SMOKE_VISIT_DAY_MS=1500 node smoke-tests/partykit/auth-permissions-smoke.mjs
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Y,
  connectRoom,
  waitForSync,
  sleep,
  getNumberEnv,
} from "./shared.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(repoRoot, "package.json"));
// @playhtml/common is ESM-only; import its built dist directly.
const {
  buildAuthChallengePayload,
  exportPublicKeyHex,
  signAuthPayload,
} = await import(
  resolve(repoRoot, "packages/common/dist/playhtml-common.es.js")
);

const PARTYKIT_HOST = process.env.PARTYKIT_HOST ?? "localhost:1999";
const WELL_KNOWN_PORT = getNumberEnv("WELL_KNOWN_PORT", 8123);
const SITE_DOMAIN = `localhost:${WELL_KNOWN_PORT}`;
// Unique room per run so reruns against a live dev server start clean.
const ROOM_PATH = `/perms-smoke-${Date.now()}`;
const ROOM_ID = encodeURIComponent(`${SITE_DOMAIN}-${ROOM_PATH}`);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function makeIdentity() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const pid = await exportPublicKeyHex(keyPair.publicKey);
  return { pid, privateKey: keyPair.privateKey };
}

/** Wraps a provider with auth-protocol helpers over custom messages. */
function attachAuthClient(provider, identity, label) {
  const client = {
    provider,
    identity,
    label,
    messages: [],
    waiters: [],
  };
  provider.on("custom-message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    client.messages.push(message);
    for (const waiter of [...client.waiters]) {
      if (waiter.matches(message)) {
        client.waiters.splice(client.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  client.waitFor = (type, predicate = () => true, timeoutMs = 10_000) =>
    new Promise((resolveWait, reject) => {
      const matches = (m) => m.type === type && predicate(m);
      const existing = client.messages.find(matches);
      if (existing) {
        resolveWait(existing);
        return;
      }
      const timer = setTimeout(() => {
        reject(
          new Error(
            `${label}: timed out waiting for "${type}" (saw: ${client.messages
              .map((m) => m.type)
              .join(", ")})`
          )
        );
      }, timeoutMs);
      client.waiters.push({ matches, resolve: resolveWait, timer });
    });
  // Like waitFor, but only matches messages arriving AFTER this call.
  client.waitForNext = (type, predicate = () => true, timeoutMs = 10_000) =>
    new Promise((resolveWait, reject) => {
      const matches = (m) => m.type === type && predicate(m);
      const timer = setTimeout(() => {
        reject(new Error(`${label}: timed out waiting for next "${type}"`));
      }, timeoutMs);
      client.waiters.push({ matches, resolve: resolveWait, timer });
    });
  client.send = (message) => provider.sendMessage(JSON.stringify(message));
  return client;
}

async function verifyClient(client, origin, { fresh = false } = {}) {
  let challenge;
  if (fresh) {
    // Re-verification: ask for a new challenge and answer only that one.
    const next = client.waitForNext("auth_challenge");
    client.send({ type: "auth_request" });
    challenge = await next;
  } else {
    challenge = await client.waitFor("auth_challenge");
  }
  const payload = buildAuthChallengePayload({
    nonce: challenge.nonce,
    roomId: challenge.roomId,
    origin,
    ts: challenge.ts,
  });
  const signature = await signAuthPayload(client.identity.privateKey, payload);
  const okPromise = client.waitForNext(
    "auth_ok",
    (m) => m.pid === client.identity.pid
  );
  client.send({
    type: "auth_response",
    pid: client.identity.pid,
    origin,
    signature,
  });
  return okPromise;
}

async function gatedWrite(client, tag, elementId, data) {
  const opId = crypto.randomUUID();
  client.send({ type: "gated_write", opId, tag, elementId, data });
  return client.waitFor("gated_write_result", (m) => m.opId === opId);
}

function readElement(doc, tag, elementId) {
  const play = doc.getMap("play");
  const tagMap = play.get(tag);
  if (!tagMap || typeof tagMap.get !== "function") return undefined;
  const value = tagMap.get(elementId);
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

async function main() {
  console.log(`Auth/permissions smoke: room=${ROOM_ID} host=${PARTYKIT_HOST}`);

  const admin = await makeIdentity();
  const visitor = await makeIdentity();
  const origin = `http://${SITE_DOMAIN}`;

  // --- 1. Serve the domain's .well-known/playhtml.json
  const wellKnown = {
    roles: {
      admin: [admin.pid],
      returning: { visits: 2 },
      regular: { visits: 3 },
    },
    elements: {
      "site-title": "write:admin",
      "guestbook": "create:verified, update:creator, delete:creator|admin",
      "village-guestbook":
        "create:returning, update:creator, delete:creator|regular|admin",
    },
  };
  const server = createServer((req, res) => {
    if (req.url === "/.well-known/playhtml.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(wellKnown));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(WELL_KNOWN_PORT, r));
  console.log(`Serving well-known config at ${origin}/.well-known/playhtml.json`);

  try {
    // --- 2. Connect admin + visitor clients
    const adminDoc = new Y.Doc();
    const adminProvider = connectRoom(PARTYKIT_HOST, ROOM_ID, adminDoc);
    const adminClient = attachAuthClient(adminProvider, admin, "admin");

    const visitorDoc = new Y.Doc();
    const visitorProvider = connectRoom(PARTYKIT_HOST, ROOM_ID, visitorDoc);
    const visitorClient = attachAuthClient(visitorProvider, visitor, "visitor");

    await waitForSync(adminProvider, "admin");
    await waitForSync(visitorProvider, "visitor");

    // --- 3. permissions_status announces enforcement
    console.log("\n[1] permissions_status");
    const status = await adminClient.waitFor("permissions_status");
    check("server announces enforcement", status.enforced === true);
    check(
      "rules arrive (elements map normalized)",
      Array.isArray(status.rules) &&
        status.rules.some((r) => r.match === "site-title"),
      JSON.stringify(status.rules)
    );

    // --- 4. unverified gated write is rejected
    console.log("\n[2] unverified gated write rejected");
    const unverifiedResult = await gatedWrite(
      visitorClient,
      "can-play",
      "site-title",
      { text: "hacked" }
    );
    check("rejected", unverifiedResult.ok === false, unverifiedResult.reason);

    // --- 5. handshake verifies both clients
    console.log("\n[3] challenge-response handshake");
    const adminOk = await verifyClient(adminClient, origin);
    check("admin verified", adminOk.pid === admin.pid);
    check("admin got session token", typeof adminOk.token === "string");
    const visitorOk = await verifyClient(visitorClient, origin);
    check("visitor verified", visitorOk.pid === visitor.pid);

    // --- 6. admin can write the gated title; visitor still can't
    console.log("\n[4] write-gated element");
    const adminWrite = await gatedWrite(adminClient, "can-play", "site-title", {
      text: "spencer's site",
    });
    check("admin write accepted", adminWrite.ok === true, adminWrite.reason);
    await sleep(1500);
    check(
      "title synced to visitor",
      readElement(visitorDoc, "can-play", "site-title")?.text ===
        "spencer's site"
    );
    const visitorWrite = await gatedWrite(
      visitorClient,
      "can-play",
      "site-title",
      { text: "visitor takeover" }
    );
    check("verified visitor still rejected (not admin)", visitorWrite.ok === false);

    // --- 7. entry-level rules on the guestbook
    console.log("\n[5] entry rules (create/update/delete + createdBy)");
    const created = await gatedWrite(visitorClient, "can-play", "guestbook", {
      note1: { text: "hello", createdBy: "pk_forged" },
    });
    check("verified visitor can create entry", created.ok === true, created.reason);
    await sleep(1500);
    const entry = readElement(visitorDoc, "can-play", "guestbook")?.note1;
    check(
      "createdBy stamped with verified pid (forgery ignored)",
      entry?.createdBy === visitor.pid,
      JSON.stringify(entry)
    );

    const updateOwn = await gatedWrite(visitorClient, "can-play", "guestbook", {
      note1: { text: "hello (edited)", createdBy: visitor.pid },
    });
    check("creator can update own entry", updateOwn.ok === true, updateOwn.reason);

    // A second verified identity must NOT be able to edit the visitor's entry.
    const intruderUpdate = await gatedWrite(adminClient, "can-play", "guestbook", {
      note1: { text: "vandalized", createdBy: visitor.pid },
    });
    check(
      "non-creator can't update entry (admin role only covers delete)",
      intruderUpdate.ok === false,
      intruderUpdate.reason
    );

    const adminDelete = await gatedWrite(adminClient, "can-play", "guestbook", {});
    check("admin can delete via delete:creator|admin", adminDelete.ok === true, adminDelete.reason);

    // --- 8. backstop: direct CRDT write to a gated key gets reverted
    console.log("\n[6] backstop reverts direct CRDT writes");
    const store = require("@syncedstore/core").syncedStore(
      { play: {} },
      visitorDoc
    );
    store.play["can-play"] ??= {};
    store.play["can-play"]["site-title"] = { text: "bypassed the library" };
    await sleep(2500);
    const titleAfter = readElement(visitorDoc, "can-play", "site-title");
    check(
      "gated value restored to authoritative",
      titleAfter?.text === "spencer's site",
      JSON.stringify(titleAfter)
    );

    // --- 9. non-gated elements are untouched by all of this
    console.log("\n[7] non-gated element unaffected");
    store.play["can-play"]["free-element"] = { count: 1 };
    await sleep(1500);
    check(
      "free element write propagates to admin",
      readElement(adminDoc, "can-play", "free-element")?.count === 1
    );

    // --- 10. session resume on reconnect
    console.log("\n[8] session-token resume");
    const adminDoc2 = new Y.Doc();
    const adminProvider2 = connectRoom(PARTYKIT_HOST, ROOM_ID, adminDoc2);
    const adminClient2 = attachAuthClient(adminProvider2, admin, "admin2");
    await waitForSync(adminProvider2, "admin2");
    await adminClient2.waitFor("auth_challenge");
    adminClient2.send({ type: "auth_resume", token: adminOk.token });
    const resumed = await adminClient2.waitFor("auth_ok");
    check("resume returns same pid without a signature", resumed.pid === admin.pid);

    const badResumeDoc = new Y.Doc();
    const badProvider = connectRoom(PARTYKIT_HOST, ROOM_ID, badResumeDoc);
    const badClient = attachAuthClient(badProvider, visitor, "bad-resume");
    await waitForSync(badProvider, "bad-resume");
    await badClient.waitFor("auth_challenge");
    badClient.send({ type: "auth_resume", token: "not-a-real-token" });
    const badResume = await badClient.waitFor("auth_error");
    check("bad token rejected", badResume.reason === "invalid_token");
    // Server should follow up with a fresh challenge after the bad token.
    const rechallengeCount = badClient.messages.filter(
      (m) => m.type === "auth_challenge"
    ).length;
    await sleep(1000);
    check(
      "fresh challenge issued after bad token",
      badClient.messages.filter((m) => m.type === "auth_challenge").length >
        rechallengeCount - 1
    );

    adminProvider.destroy();
    adminProvider2.destroy();
    badProvider.destroy();

    // --- 11. earned roles: standing accrues from server-counted visits
    const visitDayMs = Number(process.env.SMOKE_VISIT_DAY_MS || 0);
    if (visitDayMs > 0) {
      console.log("\n[9] earned roles (visit accrual)");
      // The visitor verified once above — day 1. A returning-gated create
      // must be rejected today.
      const dayOne = await gatedWrite(visitorClient, "can-play", "village-guestbook", {
        e1: { text: "first day hello" },
      });
      check("day-1 visitor can't sign (create:returning)", dayOne.ok === false, dayOne.reason);

      // Next "day": re-verify to record a second visit.
      await sleep(visitDayMs + 300);
      const day2 = await verifyClient(visitorClient, origin, { fresh: true });
      check("second visit counted", day2.stats?.visitDays === 2, JSON.stringify(day2.stats));

      const dayTwo = await gatedWrite(visitorClient, "can-play", "village-guestbook", {
        e1: { text: "back again!" },
      });
      check("day-2 visitor can sign", dayTwo.ok === true, dayTwo.reason);

      // Day 3: the visitor becomes a regular and can sweep up others' entries.
      await sleep(visitDayMs + 300);
      const day3 = await verifyClient(visitorClient, origin, { fresh: true });
      check("third visit counted", day3.stats?.visitDays === 3, JSON.stringify(day3.stats));

      // A stranger earns signing rights (2 visits) and adds an entry.
      const stranger = await makeIdentity();
      const strangerDoc = new Y.Doc();
      const strangerProvider = connectRoom(PARTYKIT_HOST, ROOM_ID, strangerDoc);
      const strangerClient = attachAuthClient(strangerProvider, stranger, "stranger");
      await waitForSync(strangerProvider, "stranger");
      await verifyClient(strangerClient, origin);
      await sleep(visitDayMs + 300);
      await verifyClient(strangerClient, origin, { fresh: true }); // day 2 -> can sign
      const strangerEntry = await gatedWrite(
        strangerClient,
        "can-play",
        "village-guestbook",
        {
          e1: { text: "back again!", createdBy: visitor.pid },
          s1: { text: "stranger was here" },
        }
      );
      check("returning stranger can add their entry", strangerEntry.ok === true, strangerEntry.reason);

      // The regular (visitor, 3 visits) sweeps up the stranger's entry.
      const sweep = await gatedWrite(visitorClient, "can-play", "village-guestbook", {
        e1: { text: "back again!", createdBy: visitor.pid },
      });
      check("regular can sweep up someone else's entry", sweep.ok === true, sweep.reason);

      // But a mere returning visitor (stranger, 2 visits) can't sweep others'.
      const failedSweep = await gatedWrite(strangerClient, "can-play", "village-guestbook", {});
      check(
        "returning visitor can't sweep others' entries",
        failedSweep.ok === false,
        failedSweep.reason
      );
      strangerProvider.destroy();
    } else {
      console.log(
        "\n[9] earned roles SKIPPED — set SMOKE_VISIT_DAY_MS and launch wrangler with --var AUTH_VISIT_DAY_MS:<ms>"
      );
    }

    visitorProvider.destroy();
  } finally {
    server.close();
  }

  console.log(
    failures === 0
      ? "\nAuth/permissions smoke: ALL CHECKS PASSED"
      : `\nAuth/permissions smoke: ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Auth/permissions smoke failed:", error);
  process.exit(1);
});
