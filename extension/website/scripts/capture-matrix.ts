// ABOUTME: Captures short mp4 clips of MovementCanvas variants in parallel.
// ABOUTME: Reads CELLS from capture-matrix.config.ts; outputs to captures/<run>/.

import { chromium, type Browser, type BrowserContext } from "playwright";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { CELLS, type CaptureCell } from "./capture-matrix.config";

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

interface CliArgs {
  baseUrl: string;
  workers: number;
  outDir: string;
  defaultDurationMs: number;
  filter: string | null;
  readyTimeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseUrl: process.env.CAPTURE_BASE_URL ?? "http://localhost:5173",
    workers: Math.max(1, Math.floor(os.cpus().length / 2)),
    outDir: join(ROOT, "captures", new Date().toISOString().replace(/[:.]/g, "-")),
    defaultDurationMs: 15000,
    filter: null,
    readyTimeoutMs: 30_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--base-url") args.baseUrl = next();
    else if (a === "--workers") args.workers = parseInt(next(), 10);
    else if (a === "--out") args.outDir = resolve(next());
    else if (a === "--duration") args.defaultDurationMs = parseInt(next(), 10);
    else if (a === "--filter") args.filter = next();
    else if (a === "--ready-timeout") args.readyTimeoutMs = parseInt(next(), 10);
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capture mp4s of MovementCanvas variants in parallel.

Usage:
  bun run capture [options]

Options:
  --base-url <url>     Dev server base URL (default: http://localhost:5173)
  --workers <n>        Parallel browser contexts (default: half of cpu count)
  --out <dir>          Output directory (default: captures/<timestamp>/)
  --duration <ms>      Per-clip duration when cell omits it (default: 15000)
  --filter <substr>    Only capture cells whose name includes <substr>
  --ready-timeout <ms> How long to wait for window.__movementReady (default: 30000)
  -h, --help           Show this help

Pre-flight:
  - Run \`bun dev\` in extension/website/ first.
  - ffmpeg must be on PATH (brew install ffmpeg).

Each cell's URL params come from scripts/capture-matrix.config.ts. Edit
that file to change which variants get captured.
`);
}

function checkFfmpeg() {
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    console.error(
      "[capture] ffmpeg not found on PATH. Install with: brew install ffmpeg",
    );
    process.exit(1);
  }
}

async function checkDevServer(baseUrl: string) {
  try {
    const r = await fetch(baseUrl, { method: "HEAD" }).catch(() =>
      fetch(baseUrl),
    );
    if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    console.error(
      `[capture] Dev server not reachable at ${baseUrl}. Start it with \`bun dev\` in extension/website/.`,
    );
    console.error(`           Underlying error: ${(err as Error).message}`);
    process.exit(1);
  }
}

function buildUrl(baseUrl: string, cell: CaptureCell): string {
  const u = new URL("/archive/", baseUrl);
  for (const [k, v] of Object.entries(cell.params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function captureCell(
  browser: Browser,
  cell: CaptureCell,
  args: CliArgs,
  index: number,
  total: number,
): Promise<void> {
  const url = buildUrl(args.baseUrl, cell);
  const duration = cell.durationMs ?? args.defaultDurationMs;
  const cellVideoDir = join(args.outDir, "_videos", cell.name);
  await mkdir(cellVideoDir, { recursive: true });

  const tag = `[${index + 1}/${total}] ${cell.name}`;
  console.log(`${tag} … starting (${url})`);
  const startedAt = Date.now();

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: cellVideoDir, size: { width: 1280, height: 800 } },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for MovementCanvas to expose readiness. Configurable ceiling so a
    // broken cell doesn't wedge the whole run.
    const readyStart = Date.now();
    const ready = await page
      .waitForFunction(
        () =>
          (window as unknown as { __movementReady?: boolean }).__movementReady ===
          true,
        null,
        { timeout: args.readyTimeoutMs },
      )
      .then(() => true)
      .catch(() => false);
    const readyMs = Date.now() - readyStart;
    if (ready) {
      console.log(`${tag} … ready in ${(readyMs / 1000).toFixed(1)}s, recording ${duration}ms`);
    } else {
      console.warn(
        `${tag} … readiness never fired (waited ${(readyMs / 1000).toFixed(1)}s); recording anyway`,
      );
    }

    await page.waitForTimeout(duration);
    const video = page.video();
    await context.close();
    context = null;

    if (!video) throw new Error("page.video() returned null");
    const webmPath = await video.path();

    // Move webm to a stable filename next to the eventual mp4.
    const stableWebm = join(args.outDir, `${cell.name}.webm`);
    await rename(webmPath, stableWebm);

    const mp4Path = join(args.outDir, `${cell.name}.mp4`);
    await execFileP("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      stableWebm,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      mp4Path,
    ]);
    await rm(stableWebm);
    await rm(cellVideoDir, { recursive: true, force: true });

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`${tag} … done (${elapsed}s) → ${mp4Path}`);
  } catch (err) {
    if (context) await context.close().catch(() => {});
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`${tag} … FAILED after ${elapsed}s: ${(err as Error).message}`);
    throw err;
  }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<{ failed: number }> {
  let cursor = 0;
  let failed = 0;
  const total = items.length;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      try {
        await worker(items[i], i);
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { failed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  checkFfmpeg();
  await checkDevServer(args.baseUrl);

  const cells = args.filter
    ? CELLS.filter((c) => c.name.includes(args.filter!))
    : CELLS;
  if (cells.length === 0) {
    console.error("[capture] no cells to run (empty config or filter mismatch)");
    process.exit(1);
  }

  await mkdir(args.outDir, { recursive: true });
  if (existsSync(join(args.outDir, "_videos"))) {
    await rm(join(args.outDir, "_videos"), { recursive: true, force: true });
  }

  console.log(
    `[capture] ${cells.length} cells, ${Math.min(args.workers, cells.length)} workers, → ${args.outDir}`,
  );

  const browser = await chromium.launch();
  const startedAt = Date.now();
  let result: { failed: number } = { failed: 0 };
  try {
    result = await runPool(cells, args.workers, (cell, i) =>
      captureCell(browser, cell, args, i, cells.length),
    );
  } finally {
    await browser.close();
  }

  // Drop a manifest for cross-referencing files back to params.
  const manifest = {
    capturedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    cells: cells.map((c) => ({
      name: c.name,
      params: c.params,
      durationMs: c.durationMs ?? args.defaultDurationMs,
      url: buildUrl(args.baseUrl, c),
    })),
  };
  await writeFile(
    join(args.outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await rm(join(args.outDir, "_videos"), { recursive: true, force: true });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.failed > 0) {
    console.error(
      `[capture] done in ${elapsed}s with ${result.failed} failure(s) → ${args.outDir}`,
    );
    process.exit(1);
  }
  console.log(`[capture] done in ${elapsed}s → ${args.outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
