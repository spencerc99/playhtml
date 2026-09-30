// ABOUTME: Measures how often an idle presence room wakes with three connected clients.
// ABOUTME: Compares keepalive republishing against pings answered by the runtime.
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Usage, from the repo root:
//   node smoke-tests/partykit/presence-wakes-measure.mjs
// PRESENCE_BASE_REF=<git ref> loads the presence server from that revision
// instead and drives it the way clients did before liveness pings existed.
// PRESENCE_MEASURE_MS sets the idle window (default one minute).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baseRef = process.env.PRESENCE_BASE_REF;
const measureMs = Number(process.env.PRESENCE_MEASURE_MS ?? 60_000);
const CLIENT_INTERVAL_MS = 10_000;

const worker = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { PresenceServer } from "./partykit/presenceServer.ts";
      import { routePartykitRequest } from "partyserver";
      const wakes = { message: 0, alarm: 0, close: 0, request: 0 };
      export class Presence extends PresenceServer {
        async webSocketMessage(ws, message) {
          wakes.message += 1;
          return super.webSocketMessage(ws, message);
        }
        async webSocketClose(...args) {
          wakes.close += 1;
          return super.webSocketClose(...args);
        }
        async alarm() {
          wakes.alarm += 1;
          return super.alarm();
        }
        async onRequest() {
          return Response.json({ ...wakes });
        }
      }
      export default { fetch(request, env) {
        return routePartykitRequest(request, env);
      }};
    `,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:workers"],
  plugins: baseRef
    ? [
        {
          name: "presence-revision",
          setup(builder) {
            builder.onLoad(
              { filter: /partykit\/presence(Server|Policy|Message)\.ts$/ },
              (args) => ({
                contents: execFileSync(
                  "git",
                  ["show", `${baseRef}:${args.path.slice(root.length + 1)}`],
                  { cwd: root, encoding: "utf8" },
                ),
                loader: "ts",
              }),
            );
          },
        },
      ]
    : [],
});

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const mf = new Miniflare({
  modules: true,
  compatibilityDate: "2024-09-23",
  compatibilityFlags: ["nodejs_compat"],
  script: worker.outputFiles[0].text,
  durableObjects: {
    Presence: { className: "Presence", useSQLite: true, unsafePreventEviction: false },
  },
});
const url = "http://presence.test/parties/presence/idle-room";
const timers = [];
const sockets = [];
let pongs = 0;

function status() {
  return JSON.stringify({
    type: "presence-update",
    channel: "presence:status",
    value: { at: Date.now(), value: "reading" },
  });
}

async function connectClient(id) {
  const response = await mf.dispatchFetch(`${url}?_pk=${id}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket;
  ws.accept();
  ws.addEventListener("message", (event) => {
    if (event.data === "pong") pongs += 1;
  });
  ws.send(status());
  // What an idle client sends: a keepalive republish before liveness pings,
  // a ping answered by the runtime after.
  timers.push(
    setInterval(() => ws.send(baseRef ? status() : "ping"), CLIENT_INTERVAL_MS),
  );
  if (!baseRef) ws.send("ping");
  sockets.push(ws);
}

async function readWakes() {
  const response = await mf.dispatchFetch(url, { method: "POST", body: "{}" });
  const wakes = await response.json();
  return wakes;
}

try {
  for (const id of ["a", "b", "c"]) await connectClient(id);
  await sleep(1_000);
  const before = await readWakes();
  await sleep(measureMs);
  const after = await readWakes();
  const minutes = measureMs / 60_000;
  const counted = (key) => after[key] - before[key];
  const total = counted("message") + counted("alarm") + counted("close");
  console.log(
    JSON.stringify({
      server: baseRef ? `presence server at ${baseRef}` : "working tree",
      clients: 3,
      measureMs,
      wakes: {
        message: counted("message"),
        alarm: counted("alarm"),
        close: counted("close"),
      },
      wakesPerMinute: Number((total / minutes).toFixed(1)),
      pongsAnswered: pongs,
    }),
  );
} finally {
  for (const timer of timers) clearInterval(timer);
  for (const ws of sockets) ws.close(1000);
  await mf.dispose();
}
