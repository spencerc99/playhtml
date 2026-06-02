// ABOUTME: Verifies Firefox store submission runs without Chrome store inputs.
// ABOUTME: Covers the WXT process environment used by release automation.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterEach, expect, test } from "vitest";

const tempDirs = [];
const scriptPath = path.resolve("scripts/submitFirefox.sh");

afterEach(async () => {
  const removals = tempDirs
    .splice(0)
    .map((dir) => rm(dir, { recursive: true, force: true }));
  await Promise.all(removals);
});

async function makeFakeBunx() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "submit-firefox-"));
  tempDirs.push(dir);
  const outputPath = path.join(dir, "bunx-env.json");
  const bunxPath = path.join(dir, "bunx");
  const script = [
    "#!/bin/sh",
    "node -e 'const fs = require(\"fs\");",
    "const [outputPath, ...argv] = process.argv.slice(1);",
    "fs.writeFileSync(outputPath, JSON.stringify({ argv, env: process.env }));' \\",
    `  ${JSON.stringify(outputPath)} "$@"`,
    "",
  ].join("\n");

  await writeFile(bunxPath, script, { mode: 0o755 });
  return { binDir: dir, outputPath };
}

function runFirefoxSubmit(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(scriptPath, ["--firefox-zip", "firefox.zip"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("runs WXT Firefox submit without Chrome environment variables", async () => {
  const { binDir, outputPath } = await makeFakeBunx();
  const result = await runFirefoxSubmit({
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    CHROME_ZIP: "chrome.zip",
    CHROME_EXTENSION_ID: "chrome-extension-id",
    CHROME_CLIENT_ID: "chrome-client-id",
    CHROME_CLIENT_SECRET: "chrome-client-secret",
    CHROME_REFRESH_TOKEN: "chrome-refresh-token",
    CHROME_PUBLISH_TARGET: "default",
    CHROME_DEPLOY_PERCENTAGE: "100",
    CHROME_REVIEW_EXEMPTION: "true",
    CHROME_SKIP_SUBMIT_REVIEW: "true",
    FIREFOX_ZIP: "firefox.zip",
    FIREFOX_EXTENSION_ID: "firefox-extension-id",
  });

  expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  const captured = JSON.parse(await readFile(outputPath, "utf8"));

  expect(captured.argv).toEqual(["wxt", "submit", "--firefox-zip", "firefox.zip"]);
  expect(captured.env.FIREFOX_ZIP).toBe("firefox.zip");
  expect(captured.env.FIREFOX_EXTENSION_ID).toBe("firefox-extension-id");
  expect(captured.env).not.toHaveProperty("CHROME_ZIP");
  expect(captured.env).not.toHaveProperty("CHROME_EXTENSION_ID");
  expect(captured.env).not.toHaveProperty("CHROME_CLIENT_ID");
  expect(captured.env).not.toHaveProperty("CHROME_CLIENT_SECRET");
  expect(captured.env).not.toHaveProperty("CHROME_REFRESH_TOKEN");
  expect(captured.env).not.toHaveProperty("CHROME_PUBLISH_TARGET");
  expect(captured.env).not.toHaveProperty("CHROME_DEPLOY_PERCENTAGE");
  expect(captured.env).not.toHaveProperty("CHROME_REVIEW_EXEMPTION");
  expect(captured.env).not.toHaveProperty("CHROME_SKIP_SUBMIT_REVIEW");
});
