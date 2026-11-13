// ABOUTME: Starts a local copy of playhtml.fun for filming: snapshot-backed PartyKit server plus the site.
// ABOUTME: Nothing here talks to production; each start begins from the exported snapshot again.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { startFakeDb } from "./fake-db.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const { values } = parseArgs({
  options: {
    snapshot: {
      type: "string",
      default: join(here, "snapshots", "homepage.json"),
    },
    "server-port": { type: "string", default: "1998" },
    "site-port": { type: "string", default: "5199" },
    "db-port": { type: "string", default: "54398" },
  },
});

const snapshot = resolve(values.snapshot);
if (!existsSync(snapshot)) {
  console.error(
    `No snapshot at ${snapshot}.\nRun \`bun run film:export\` first (read-only copy of the live homepage).`,
  );
  process.exit(1);
}
const serverPort = values["server-port"];
const sitePort = Number(values["site-port"]);
const dbPort = values["db-port"];

// Fresh server state every run, so each take starts from the snapshot.
const scratch = mkdtempSync(join(tmpdir(), "playhtml-filming-"));
const envFile = join(scratch, "dev.vars");
writeFileSync(
  envFile,
  [
    `SUPABASE_URL=http://127.0.0.1:${dbPort}`,
    "SUPABASE_KEY=filming",
    "ADMIN_TOKEN=filming",
    "PARTYKIT_BRIDGE_SECRET=filming",
  ].join("\n"),
);

let shuttingDown = false;
let site;
let worker;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  worker?.kill("SIGTERM");
  await site?.close();
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await startFakeDb({
  port: dbPort,
  snapshotPath: snapshot,
  log: (line) => console.log(`[db] ${line}`),
});

// Only the throwaway values above: a real Supabase URL or key in the shell
// must never reach this server.
const workerEnv = { ...process.env };
for (const name of [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "ADMIN_TOKEN",
  "PARTYKIT_BRIDGE_SECRET",
]) {
  delete workerEnv[name];
}

worker = spawn(
  resolve(repoRoot, "node_modules/.bin/wrangler"),
  [
    "dev",
    "--config",
    "partykit/wrangler.jsonc",
    "--port",
    serverPort,
    "--env-file",
    envFile,
    "--persist-to",
    join(scratch, "wrangler-state"),
  ],
  { cwd: repoRoot, env: workerEnv, stdio: ["ignore", "pipe", "pipe"] },
);
for (const stream of [worker.stdout, worker.stderr]) {
  stream.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) process.stdout.write(`[server] ${line}\n`);
    }
  });
}
worker.on("exit", (code) => {
  if (shuttingDown) return;
  console.error(`[server] exited with ${code}; stopping.`);
  shutdown(1);
});

site = await createServer({
  configFile: join(here, "vite.config.mjs"),
  server: { port: sitePort, strictPort: true },
});
await site.listen();

const url = `http://localhost:${sitePort}/?playhtmlHost=localhost:${serverPort}`;
console.log(`
  Filming copy of playhtml.fun:
    ${url}

  Simulated people (another terminal):
    bun run film:bots -- --count 5

  Ctrl+C stops everything. The next start begins from the snapshot again.
`);
