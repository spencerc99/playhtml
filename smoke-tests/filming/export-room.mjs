// ABOUTME: Downloads a read-only copy of a live playhtml room into a local snapshot file.
// ABOUTME: Speaks the Yjs sync protocol by hand and never sends an update, so production is untouched.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WebSocket, Y, getPartyWebSocketUrl } from "../partykit/shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../../package.json"));
const encoding = require("lib0/encoding");
const decoding = require("lib0/decoding");
const syncProtocol = require("y-protocols/sync");

const MESSAGE_SYNC = 0;

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "api.playhtml.fun" },
    // Room id as the server names it: "<site host>-<encoded path>".
    room: { type: "string", default: "playhtml.fun-/" },
    out: { type: "string", default: join(here, "snapshots", "homepage.json") },
    timeout: { type: "string", default: "30000" },
  },
});

const { host, room, out } = values;
const doc = new Y.Doc();
console.log(`Reading ${room} from ${host} (read-only)...`);

const ws = new WebSocket(
  `${getPartyWebSocketUrl(host, room)}?_pk=filming-export-${Date.now()}`,
);

const timer = setTimeout(() => {
  console.error("Timed out waiting for the room's state.");
  process.exit(1);
}, Number(values.timeout));

ws.on("open", () => {
  // Ask for everything: sync step 1 with an empty state vector. This is the
  // only message we send, and it carries no document changes.
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  ws.send(encoding.toUint8Array(encoder));
});

ws.on("message", (data, isBinary) => {
  if (!isBinary) return; // custom JSON notices
  const decoder = decoding.createDecoder(new Uint8Array(data));
  if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return; // awareness etc.
  // Ignore the server's own step 1 (answering it would send our state back).
  if (decoding.readVarUint(decoder) !== syncProtocol.messageYjsSyncStep2) {
    return;
  }
  Y.applyUpdate(doc, decoding.readVarUint8Array(decoder));
  finish();
});

ws.on("error", (error) => {
  console.error("WebSocket error:", error.message);
  process.exit(1);
});

function finish() {
  clearTimeout(timer);
  ws.close();
  const update = Y.encodeStateAsUpdate(doc);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        room: encodeURIComponent(room),
        host,
        exportedAt: new Date().toISOString(),
        document: Buffer.from(update).toString("base64"),
      },
      null,
      2,
    ),
  );
  console.log(
    `Saved ${(update.byteLength / 1024).toFixed(1)} KB (${doc.share.size} top-level keys) to ${out}`,
  );
  process.exit(0);
}
