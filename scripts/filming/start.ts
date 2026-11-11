// ABOUTME: Starts a local copy of playhtml.fun for filming: snapshot-backed PartyKit server plus the site.
// ABOUTME: Nothing here talks to production; each start begins from the exported snapshot again.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    "server-port": { type: "string", default: "1998" },
    "site-port": { type: "string", default: "5199" },
    "db-port": { type: "string", default: "54398" },
  },
});

const repoRoot = resolve(import.meta.dir, "../..");
const snapshot = resolve(
  values.snapshot ?? join(import.meta.dir, "snapshots", "homepage.json"),
);
if (!existsSync(snapshot)) {
  console.error(
    `No snapshot at ${snapshot}.\nRun \`bun run film:export\` first (read-only copy of the live homepage).`,
  );
  process.exit(1);
}

const serverPort = values["server-port"]!;
const sitePort = values["site-port"]!;
const dbPort = values["db-port"]!;

// Fresh server state every run, so each take starts from the snapshot.
const scratch = mkdtempSync(join(tmpdir(), "playhtml-filming-"));
const envFile = join(scratch, "dev.vars");
writeFileSync(
  envFile,
  [
    `SUPABASE_URL=http://localhost:${dbPort}`,
    "SUPABASE_KEY=filming",
    "ADMIN_TOKEN=filming",
    "PARTYKIT_BRIDGE_SECRET=filming",
  ].join("\n"),
);

const children: ChildProcess[] = [];
function run(label: string, command: string, args: string[], env = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${label}] `;
  const forward = (stream: NodeJS.WritableStream) => (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) stream.write(prefix + line + "\n");
    }
  };
  child.stdout?.on("data", forward(process.stdout));
  child.stderr?.on("data", forward(process.stderr));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${prefix}exited with ${code}; stopping everything.`);
      shutdown(1);
    }
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("db", "bun", [join(import.meta.dir, "fake-db.ts")], {
  FILMING_DB_PORT: dbPort,
  FILMING_SNAPSHOT: snapshot,
});
run("server", "bunx", [
  "wrangler",
  "dev",
  "--config",
  "partykit/wrangler.jsonc",
  "--port",
  serverPort,
  "--env-file",
  envFile,
  "--persist-to",
  join(scratch, "wrangler-state"),
]);
run("site", "bunx", [
  "vite",
  "--config",
  "scripts/filming/vite.config.mts",
  "--port",
  sitePort,
  "--strictPort",
]);

const url = `http://localhost:${sitePort}/?playhtmlHost=localhost:${serverPort}`;
setTimeout(() => {
  console.log(`
  ──────────────────────────────────────────────
  Filming copy of playhtml.fun is up:
    ${url}

  Add simulated people (in another terminal):
    bun run film:bots -- --count 5

  Ctrl+C stops everything. The next start begins
  from the snapshot again.
  ──────────────────────────────────────────────
`);
}, 4000);
