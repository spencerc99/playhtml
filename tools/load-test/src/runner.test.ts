// ABOUTME: Regression tests for the load-test CLI runner.
// ABOUTME: Exercises config loading and process exit behavior through real subprocesses.

import { afterAll, expect, test } from "bun:test";
import { unlink, writeFile } from "fs/promises";

const runnerPath = new URL("./runner.ts", import.meta.url).pathname;
const configDir = new URL("../configs/", import.meta.url).pathname;
const repoRoot = new URL("../../../", import.meta.url).pathname;
const createdConfigPaths = new Set<string>();

async function runRunner(args: string[]) {
  const proc = Bun.spawn([process.execPath, runnerPath, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

afterAll(async () => {
  await Promise.all(
    [...createdConfigPaths].map((path) =>
      unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      })
    )
  );
});

test("loads named configs from the load-test configs directory", async () => {
  const configName = `runner-smoke-${process.pid}-${Date.now()}`;
  const configPath = `${configDir}${configName}.json`;
  createdConfigPaths.add(configPath);
  await writeFile(configPath, JSON.stringify({ name: configName, runs: [] }), "utf8");

  const result = await runRunner(["--config", configName, "--target", "local"]);
  const output = `${result.stdout}\n${result.stderr}`;

  expect(result.exitCode).toBe(0);
  expect(output).not.toContain("ENOENT");
  expect(output).not.toContain("no such file or directory");
});

test("prints usage with the current runner path", async () => {
  const result = await runRunner([]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("bun tools/load-test/src/runner.ts --scenario");
  expect(result.stdout).not.toContain("bun load-test/src/runner.ts");
});

test("returns a nonzero exit status for uncaught runner failures", async () => {
  const result = await runRunner(["--config", `missing-${process.pid}-${Date.now()}`]);

  expect(result.exitCode).not.toBe(0);
});
