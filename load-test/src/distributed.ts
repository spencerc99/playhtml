// ABOUTME: Distributed load test runner that splits users across parallel Bun subprocesses.
// ABOUTME: Each subprocess runs runner.ts with a fraction of the total user count, sharing a room.

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  return {
    workers: get("--workers") ? parseInt(get("--workers")!, 10) : 4,
    scenario: get("--scenario"),
    maxUsers: get("--users") ? parseInt(get("--users")!, 10) : 50,
    duration: get("--duration"),
    rampUp: get("--ramp-up"),
    target: get("--target") ?? "local",
    room: get("--room"),
  };
}

async function main() {
  const args = parseArgs();

  if (!args.scenario) {
    console.log(`
Usage:
  bun load-test/src/distributed.ts --scenario <name> --workers N [--users N] [--duration S] [--target local|prod]

Splits --users across --workers parallel processes, all sharing one PartyKit room.
    `);
    return;
  }

  const roomId = args.room ?? `load-test-distributed-${args.scenario}-${Date.now()}`;
  const usersPerWorker = Math.floor(args.maxUsers / args.workers);
  const remainder = args.maxUsers % args.workers;

  console.log(`\n--- Distributed load test ---`);
  console.log(`Scenario:  ${args.scenario}`);
  console.log(`Target:    ${args.target}`);
  console.log(`Room:      ${roomId}`);
  console.log(`Workers:   ${args.workers}`);
  console.log(`Users:     ${args.maxUsers} total (${usersPerWorker} per worker, ${remainder} extra in first worker)`);
  console.log(`---\n`);

  const runnerPath = new URL("./runner.ts", import.meta.url).pathname;
  const workerProcs: ReturnType<typeof Bun.spawn>[] = [];

  for (let i = 0; i < args.workers; i++) {
    const workerUsers = usersPerWorker + (i === 0 ? remainder : 0);
    if (workerUsers === 0) continue;

    const workerArgs = [
      "bun", runnerPath,
      "--scenario", args.scenario,
      "--users", String(workerUsers),
      "--target", args.target,
      "--room", roomId,
    ];
    if (args.duration) {
      workerArgs.push("--duration", args.duration);
    }
    if (args.rampUp) {
      workerArgs.push("--ramp-up", args.rampUp);
    }

    console.log(`[worker ${i}] Starting with ${workerUsers} users`);

    const proc = Bun.spawn(workerArgs, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    workerProcs.push(proc);
  }

  // Stream output from each worker, prefixed with worker index
  const streamWorker = async (proc: ReturnType<typeof Bun.spawn>, index: number) => {
    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    if (!stdout) return;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        console.log(`[worker ${index}] ${line}`);
      }
    }
    if (buffer) {
      console.log(`[worker ${index}] ${buffer}`);
    }
  };

  const streamPromises = workerProcs.map((proc, i) => streamWorker(proc, i));

  // Wait for all workers to finish
  const exitCodes = await Promise.all(workerProcs.map((proc) => proc.exited));
  await Promise.all(streamPromises);

  console.log(`\n--- All workers finished ---`);
  const failed = exitCodes.filter((code) => code !== 0);
  if (failed.length > 0) {
    console.log(`${failed.length} worker(s) exited with errors.`);
    process.exit(1);
  }
  console.log(`All ${workerProcs.length} workers completed successfully.`);
}

main().catch(console.error);
