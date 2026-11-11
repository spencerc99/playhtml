// ABOUTME: Downloads a read-only copy of a live playhtml room into a local snapshot file.
// ABOUTME: Speaks the Yjs sync protocol by hand and never sends an update, so production is untouched.

import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const MESSAGE_SYNC = 0;

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "api.playhtml.fun" },
    // Room id as the server names it: "<site host>-<encoded path>".
    room: { type: "string", default: "playhtml.fun-%2F" },
    out: { type: "string" },
    timeout: { type: "string", default: "30000" },
  },
});

const host = values.host!;
const room = values.room!;
const out = values.out ?? join(import.meta.dir, "snapshots", "homepage.json");

const doc = new Y.Doc();
const protocol = /^(localhost|127\.0\.0\.1)/.test(host) ? "ws" : "wss";
const url = `${protocol}://${host}/parties/main/${room}?_pk=filming-export-${Date.now()}`;
console.log(`Reading ${room} from ${host} (read-only)...`);

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

const timer = setTimeout(() => {
  console.error("Timed out waiting for the room's state.");
  process.exit(1);
}, Number(values.timeout));

ws.addEventListener("open", () => {
  // Ask for everything: sync step 1 with an empty state vector. This is the
  // only message we send. It carries no document changes.
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  ws.send(encoding.toUint8Array(encoder));
});

ws.addEventListener("message", (event) => {
  if (typeof event.data === "string") return; // custom JSON notices
  const decoder = decoding.createDecoder(new Uint8Array(event.data));
  if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return; // awareness etc.
  const syncType = decoding.readVarUint(decoder);
  // Ignore the server's own step 1 (answering it would send our state back).
  if (syncType !== syncProtocol.messageYjsSyncStep2) return;
  Y.applyUpdate(doc, decoding.readVarUint8Array(decoder));
  finish();
});

ws.addEventListener("error", (event) => {
  console.error("WebSocket error", event);
  process.exit(1);
});

function finish() {
  clearTimeout(timer);
  ws.close();
  const update = Y.encodeStateAsUpdate(doc);
  const keys = Array.from(doc.share.keys());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        room,
        host,
        exportedAt: new Date().toISOString(),
        document: Buffer.from(update).toString("base64"),
      },
      null,
      2,
    ),
  );
  console.log(
    `Saved ${(update.byteLength / 1024).toFixed(1)} KB (${keys.length} top-level keys) to ${out}`,
  );
  process.exit(0);
}
