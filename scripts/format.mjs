// ABOUTME: Formats an explicit list of supported repository source files.
// ABOUTME: Refuses directories, generated paths, and broad formatting requests.

import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import prettier from "prettier";
import formatterOptions from "../prettier.config.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 50;
const SUPPORTED_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".output",
  ".wxt",
  "assets",
  "coverage",
  "dist",
  "dist-ssr",
  "generated",
  "node_modules",
  "public",
  "site",
  "site-dist",
]);
const EXCLUDED_PATHS = new Set(["extension/publish"]);
const EXCLUDED_NAMES = new Set([
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "worker-configuration.d.ts",
  "yarn.lock",
]);

export function parseArgs(argv) {
  const [mode, ...paths] = argv;

  if (mode !== "--check" && mode !== "--write") {
    throw new Error(
      "Choose --check or --write, then pass explicit source-file paths.",
    );
  }
  if (paths.length === 0) {
    throw new Error("Pass at least one explicit source-file path.");
  }
  if (paths.length > MAX_FILES) {
    throw new Error(
      `Refusing ${paths.length} files. Format at most ${MAX_FILES} explicit files per command.`,
    );
  }
  if (paths.some((path) => path.startsWith("-"))) {
    throw new Error(
      "Formatter options are fixed. Pass source-file paths only.",
    );
  }

  return { mode, paths };
}

export function assertSupportedPath(relativePath) {
  const normalizedPath = relativePath.split(sep).join("/");
  const segments = normalizedPath.split("/");
  const name = segments.at(-1);

  if (normalizedPath === "" || normalizedPath === ".") {
    throw new Error(
      "Pass explicit source-file paths, not repository directories.",
    );
  }
  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.startsWith("/")
  ) {
    throw new Error(`Path is outside the repository: ${relativePath}`);
  }
  if (
    segments.some((segment) => EXCLUDED_SEGMENTS.has(segment)) ||
    [...EXCLUDED_PATHS].some(
      (path) =>
        normalizedPath === path || normalizedPath.startsWith(`${path}/`),
    )
  ) {
    throw new Error(
      `Generated or asset path is not supported: ${relativePath}`,
    );
  }
  if (
    EXCLUDED_NAMES.has(name) ||
    name.startsWith(".env") ||
    name.startsWith(".dev.vars") ||
    name.endsWith(".toml") ||
    name.includes(".generated.") ||
    name.includes(".min.")
  ) {
    throw new Error(`File is outside the formatter scope: ${relativePath}`);
  }
  if (!SUPPORTED_EXTENSIONS.has(extname(name))) {
    throw new Error(`Unsupported source-file type: ${relativePath}`);
  }
}

export async function resolveRequestedFiles(paths, repoRoot = REPO_ROOT) {
  const resolvedRoot = await realpath(repoRoot);

  return Promise.all(
    paths.map(async (requestedPath) => {
      const absolutePath = resolve(resolvedRoot, requestedPath);
      const relativePath = relative(resolvedRoot, absolutePath);
      assertSupportedPath(relativePath);

      const stats = await lstat(absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Pass a regular source file: ${requestedPath}`);
      }

      const resolvedPath = await realpath(absolutePath);
      const resolvedRelativePath = relative(resolvedRoot, resolvedPath);
      assertSupportedPath(resolvedRelativePath);

      return {
        absolutePath: resolvedPath,
        relativePath: resolvedRelativePath.split(sep).join("/"),
      };
    }),
  );
}

export async function formatFiles(mode, requestedFiles) {
  const changedFiles = [];

  for (const file of requestedFiles) {
    const source = await readFile(file.absolutePath, "utf8");
    const formatted = await prettier.format(source, {
      ...formatterOptions,
      filepath: file.absolutePath,
    });

    if (formatted === source) {
      continue;
    }

    changedFiles.push(file.relativePath);
    if (mode === "--write") {
      await writeFile(file.absolutePath, formatted);
    }
  }

  return changedFiles;
}

async function main() {
  const { mode, paths } = parseArgs(process.argv.slice(2));
  const requestedFiles = await resolveRequestedFiles(paths);
  const changedFiles = await formatFiles(mode, requestedFiles);

  if (mode === "--check" && changedFiles.length > 0) {
    throw new Error(`Formatting differs: ${changedFiles.join(", ")}`);
  }

  if (mode === "--write" && changedFiles.length > 0) {
    process.stdout.write(`Formatted ${changedFiles.join(", ")}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
