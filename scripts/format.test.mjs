// ABOUTME: Tests the scoped formatter against real files and path boundaries.
// ABOUTME: Ensures broad, generated, and unsupported formatting requests fail.

import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSupportedPath,
  formatFiles,
  parseArgs,
  resolveRequestedFiles,
} from "./format.mjs";

test("requires a mode and explicit paths", () => {
  assert.throws(() => parseArgs([]), /Choose --check or --write/);
  assert.throws(() => parseArgs(["--check"]), /at least one/);
  assert.throws(
    () => parseArgs(["--check", "--ignore-unknown", "source.ts"]),
    /options are fixed/,
  );
});

test("refuses broad requests", () => {
  assert.throws(
    () => parseArgs(["--check", ...Array(51).fill("source.ts")]),
    /at most 50/,
  );
});

test("refuses unsupported and generated paths", () => {
  assert.throws(() => assertSupportedPath("."), /not repository directories/);
  assert.throws(() => assertSupportedPath("../source.ts"), /outside/);
  assert.throws(() => assertSupportedPath("partykit/wrangler.toml"), /scope/);
  assert.throws(() => assertSupportedPath("extension/.dev.vars"), /scope/);
  assert.throws(
    () => assertSupportedPath("extension/public/app.ts"),
    /Generated/,
  );
  assert.throws(
    () => assertSupportedPath("extension/src/assets/app.ts"),
    /Generated/,
  );
  assert.throws(
    () => assertSupportedPath("extension/src/icon.svg"),
    /Unsupported/,
  );
});

test("checks and writes a regular source file", async (context) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "playhtml-format-"));
  context.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(join(repoRoot, "src"));
  const sourcePath = join(repoRoot, "src", "example.ts");
  await writeFile(sourcePath, "const answer={value:42}\n");

  const requestedFiles = await resolveRequestedFiles(
    ["src/example.ts"],
    repoRoot,
  );
  assert.deepEqual(await formatFiles("--check", requestedFiles), [
    "src/example.ts",
  ]);
  assert.deepEqual(await formatFiles("--write", requestedFiles), [
    "src/example.ts",
  ]);
  assert.equal(
    await readFile(sourcePath, "utf8"),
    "const answer = { value: 42 };\n",
  );
  assert.deepEqual(await formatFiles("--check", requestedFiles), []);
});

test("refuses directories and symbolic links", async (context) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "playhtml-format-"));
  context.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(join(repoRoot, "src"));
  await writeFile(join(repoRoot, "src", "example.ts"), "export {};\n");
  await symlink("example.ts", join(repoRoot, "src", "linked.ts"));

  await assert.rejects(
    resolveRequestedFiles(["src"], repoRoot),
    /Unsupported source-file type/,
  );
  await assert.rejects(
    resolveRequestedFiles(["src/linked.ts"], repoRoot),
    /regular source file/,
  );
});
