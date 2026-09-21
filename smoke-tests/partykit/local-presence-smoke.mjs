// ABOUTME: Starts the local presence-only Worker without persistence secrets.
// ABOUTME: Verifies its real WebSocket endpoint returns an initial presence sync.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wranglerPath = resolve(repoRoot, "node_modules/.bin/wrangler");
const port = process.env.PLAYHTML_PARTYKIT_SMOKE_PORT ?? "1998";
const serverOutput = [];
const workerEnv = { ...process.env };
for (const name of [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "ADMIN_TOKEN",
  "PARTYKIT_BRIDGE_SECRET",
]) {
  delete workerEnv[name];
}

const worker = spawn(
  wranglerPath,
  [
    "dev",
    "--config",
    "partykit/wrangler.presence.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: repoRoot,
    env: workerEnv,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

worker.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
worker.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

async function waitForWorker() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(
        `presence Worker exited with code ${worker.exitCode}\n${serverOutput.join("")}`,
      );
    }
    if (serverOutput.join("").includes(`Ready on http://127.0.0.1:${port}`)) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`presence Worker did not start\n${serverOutput.join("")}`);
}

async function readInitialSync() {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/parties/presence/local-presence-smoke`,
  );
  try {
    return await new Promise((resolveMessage, rejectMessage) => {
      const timeout = setTimeout(() => {
        rejectMessage(new Error("presence endpoint did not send an initial sync"));
      }, 10_000);
      socket.once("message", (data) => {
        clearTimeout(timeout);
        try {
          resolveMessage(JSON.parse(data.toString()));
        } catch (error) {
          rejectMessage(error);
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        rejectMessage(error);
      });
      socket.once("close", () => {
        clearTimeout(timeout);
        rejectMessage(new Error("presence endpoint closed before initial sync"));
      });
    });
  } finally {
    socket.close();
  }
}

async function stopWorker() {
  if (worker.exitCode !== null) return;
  worker.kill("SIGTERM");
  const timeout = setTimeout(() => worker.kill("SIGKILL"), 5_000);
  await once(worker, "exit");
  clearTimeout(timeout);
}

try {
  await waitForWorker();
  const message = await readInitialSync();
  assert.deepEqual(message, { type: "presence-sync", peers: {} });
  console.log(
    `[presence-local] PASS - ws://127.0.0.1:${port}/parties/presence/local-presence-smoke`,
  );
} catch (error) {
  console.error("[presence-local] FAIL", error);
  console.error(serverOutput.join(""));
  process.exitCode = 1;
} finally {
  await stopWorker();
}
