// ABOUTME: CLI entry point for the playhtml load testing suite.
// ABOUTME: Parses args, orchestrates virtual users, collects metrics, persists results.

import { randomUUID } from "crypto";
import { VirtualClient } from "./client.js";
import { MetricsCollector } from "./metrics.js";
import { saveRun, listRuns, getRun } from "./db.js";
import { scenarios, type ScenarioParams } from "./scenarios/index.js";
import {
  printSnapshotHeader,
  printSnapshot,
  printSummary,
  printComparison,
  printHistory,
} from "./report.js";

const PROD_HOST = "api.playhtml.fun";
const PROD_CONFIRM_FLAG = "--i-know-this-is-prod";

const TARGETS: Record<string, string> = {
  local: "localhost:1999",
  staging: "api-staging.playhtml.fun",
  prod: PROD_HOST,
};

/**
 * Resolves a target name (or a raw host) to the host clients connect to.
 * Production takes real traffic, so it only resolves with the confirm flag.
 */
function resolveHost(target: string, confirmProd: boolean): string {
  const host = TARGETS[target] ?? target;
  if (host === PROD_HOST && !confirmProd) {
    console.error(
      `Refusing to load-test production (${PROD_HOST}) without ${PROD_CONFIRM_FLAG}. ` +
        `Use --target staging, or add ${PROD_CONFIRM_FLAG} if you mean to load the live server.`
    );
    process.exit(1);
  }
  return host;
}

const TICK_MS = 100; // 10Hz tick rate
const SNAPSHOT_INTERVAL_MS = 5_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  return {
    scenario: get("--scenario"),
    config: get("--config"),
    compare: has("--compare") ? [args[args.indexOf("--compare") + 1], args[args.indexOf("--compare") + 2]] : null,
    history: has("--history"),
    maxUsers: get("--users") ? parseInt(get("--users")!, 10) : undefined,
    duration: get("--duration") ? parseInt(get("--duration")!, 10) : undefined,
    rampUp: get("--ramp-up") ? parseInt(get("--ramp-up")!, 10) : undefined,
    target: get("--target") ?? "local",
    room: get("--room"),
    confirmProd: has(PROD_CONFIRM_FLAG),
  };
}

async function runScenario(
  scenarioName: string,
  host: string,
  params: ScenarioParams & { room?: string }
): Promise<void> {
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioName}. Available: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  }

  const roomId = params.room ?? `load-test-${scenarioName}-${Date.now()}`;
  const runId = randomUUID().slice(0, 8);

  console.log(`\nRun ${runId} -- scenario: ${scenarioName}, target: ${params.target} (${host})`);
  console.log(`Room: ${roomId}`);
  console.log(`Users: 0 -> ${params.maxUsers} over ${params.rampUpSeconds}s, then hold for ${params.duration}s\n`);

  const clients: VirtualClient[] = [];
  const collector = new MetricsCollector();
  const allEvents: ReturnType<VirtualClient["getEvents"]> = [];

  const startMs = Date.now();
  const endMs = startMs + (params.rampUpSeconds + params.duration) * 1000;

  let tickIndex = 0;
  let lastSnapshot = startMs;

  printSnapshotHeader();

  const usersPerRampTick = params.maxUsers / (params.rampUpSeconds * (1000 / TICK_MS));

  while (Date.now() < endMs) {
    const elapsed = Date.now() - startMs;
    const targetUsers = elapsed < params.rampUpSeconds * 1000
      ? Math.min(Math.floor(usersPerRampTick * (elapsed / TICK_MS)), params.maxUsers)
      : params.maxUsers;

    // Spawn new clients as needed
    while (clients.length < targetUsers) {
      const client = new VirtualClient({
        roomId,
        host,
        clientId: `vuser-${clients.length}`,
      });
      client.connect();
      clients.push(client);
    }

    // Tick all connected clients
    for (const client of clients) {
      if (client.isConnected()) {
        scenario.tick(client, tickIndex, params);
      }
    }

    // Snapshot every SNAPSHOT_INTERVAL_MS
    if (Date.now() - lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
      for (const c of clients) allEvents.push(...c.getEvents());
      const snap = collector.snapshot(clients.length, allEvents, lastSnapshot, Date.now());
      printSnapshot(snap);
      allEvents.length = 0;
      lastSnapshot = Date.now();
    }

    tickIndex++;
    await Bun.sleep(TICK_MS);
  }

  // Final snapshot
  for (const c of clients) allEvents.push(...c.getEvents());
  if (allEvents.length > 0) {
    collector.snapshot(clients.length, allEvents, lastSnapshot, Date.now());
  }

  // Disconnect all
  for (const c of clients) c.disconnect();

  const summary = collector.summarize(startMs);
  printSummary(scenarioName, params.target, summary);

  saveRun(runId, scenarioName, params.target, params as unknown as Record<string, unknown>, summary);
  console.log(`\nRun saved as ${runId}`);
}

async function main() {
  const args = parseArgs();

  // --history
  if (args.history) {
    const runs = listRuns({ scenario: args.scenario, target: args.target, limit: 20 });
    printHistory(runs);
    return;
  }

  // --compare <id1> <id2>
  if (args.compare) {
    const [idA, idB] = args.compare;
    const runA = getRun(idA);
    const runB = getRun(idB);
    if (!runA) { console.error(`Run not found: ${idA}`); process.exit(1); }
    if (!runB) { console.error(`Run not found: ${idB}`); process.exit(1); }
    printComparison(runA, runB);
    return;
  }

  // --config <name>
  if (args.config) {
    const host = resolveHost(args.target, args.confirmProd);
    const configPath = new URL(`../configs/${args.config}.json`, import.meta.url).pathname;
    const config = JSON.parse(await Bun.file(configPath).text());
    for (const run of config.runs) {
      const scenario = scenarios[run.scenario];
      if (!scenario) { console.error(`Unknown scenario: ${run.scenario}`); continue; }
      const params: ScenarioParams = {
        ...scenario.defaults,
        maxUsers: run.maxUsers,
        duration: run.duration,
        rampUpSeconds: run.rampUpSeconds ?? scenario.defaults.rampUpSeconds,
        target: args.target,
      };
      await runScenario(run.scenario, host, params);
    }
    return;
  }

  // --scenario <name>
  if (args.scenario) {
    const host = resolveHost(args.target, args.confirmProd);
    const scenario = scenarios[args.scenario];
    if (!scenario) {
      console.error(`Unknown scenario: ${args.scenario}. Available: ${Object.keys(scenarios).join(", ")}`);
      process.exit(1);
    }
    const params: ScenarioParams & { room?: string } = {
      ...scenario.defaults,
      maxUsers: args.maxUsers ?? 50,
      duration: args.duration ?? 60,
      rampUpSeconds: args.rampUp ?? scenario.defaults.rampUpSeconds,
      target: args.target,
      room: args.room,
    };
    await runScenario(args.scenario, host, params);
    return;
  }

  console.log(`
Usage:
  bun tools/load-test/src/runner.ts --scenario <name> [--users N] [--duration S] [--target local|staging|prod]
  bun tools/load-test/src/runner.ts --config <name> [--target local|staging|prod]
  bun tools/load-test/src/runner.ts --compare <run-id-1> <run-id-2>
  bun tools/load-test/src/runner.ts --history [--scenario <name>] [--target local|staging|prod]

  --target prod loads the live server and also needs ${PROD_CONFIRM_FLAG}.

Scenarios: ${Object.keys(scenarios).join(", ")}
  `);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
