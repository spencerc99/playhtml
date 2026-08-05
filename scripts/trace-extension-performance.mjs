// ABOUTME: Runs a deterministic Chrome trace against an unpacked extension build.
// ABOUTME: Prints renderer performance metrics and writes trace JSON for comparison.

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwrightChromePath = resolve(
  homedir(),
  "Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const chromePathCandidates = [
  playwrightChromePath,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const defaultChromePath =
  chromePathCandidates.find((candidate) => existsSync(candidate)) ?? chromium.executablePath();
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const args = {
    chromePath: defaultChromePath,
    runs: 1,
    outDir: "/private/tmp/playhtml-extension-traces",
    labels: [],
    mouseSteps: 240,
    scrollSteps: 28,
    timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chrome-path") {
      args.chromePath = argv[++i];
    } else if (arg === "--runs") {
      args.runs = Number(argv[++i]);
    } else if (arg === "--out-dir") {
      args.outDir = argv[++i];
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg === "--mouse-steps") {
      args.mouseSteps = Number(argv[++i]);
    } else if (arg === "--scroll-steps") {
      args.scrollSteps = Number(argv[++i]);
    } else if (arg === "--extension") {
      const raw = argv[++i];
      const splitAt = raw.indexOf(":");
      if (splitAt === -1) {
        throw new Error("--extension expects label:/absolute/path");
      }
      args.labels.push({
        label: raw.slice(0, splitAt),
        extensionPath: resolve(raw.slice(splitAt + 1)),
      });
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.labels.length === 0) {
    throw new Error("Pass at least one --extension label:/absolute/path");
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be an integer of at least 1000");
  }
  if (!Number.isInteger(args.mouseSteps) || args.mouseSteps < 1) {
    throw new Error("--mouse-steps must be a positive integer");
  }
  if (!Number.isInteger(args.scrollSteps) || args.scrollSteps < 1) {
    throw new Error("--scroll-steps must be a positive integer");
  }

  return args;
}

function pageHtml() {
  const blocks = Array.from({ length: 60 }, (_, index) => {
    return `<p>Trace row ${
      index + 1
    }: this paragraph gives the page enough height for scroll collection and enough text for layout work.</p>`;
  }).join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>we were online performance trace</title>
    <style>
      body {
        margin: 0;
        font: 16px system-ui, sans-serif;
        min-height: 6000px;
        background: #f7f5f0;
      }
      header {
        position: sticky;
        top: 0;
        padding: 24px;
        background: white;
        border-bottom: 1px solid #ddd;
      }
      #hover-target {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 360px;
        height: 180px;
        margin: 16px 0;
        border: 1px solid #648f88;
        background: #e3f0ec;
        cursor: pointer;
      }
      input {
        display: block;
        width: 360px;
        padding: 12px;
        margin-top: 12px;
        font: inherit;
      }
      main {
        padding: 24px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Extension performance trace</h1>
      <button id="hover-target">Stable pointer target</button>
      <input id="typing-target" value="" placeholder="Typing target">
    </header>
    <main>${blocks}</main>
  </body>
</html>`;
}

async function withServer(callback) {
  const server = createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(pageHtml());
  });

  await new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", resolveServer);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve local trace server port");
  }

  try {
    return await callback(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function readTraceStream(client, stream) {
  let result = "";
  while (true) {
    const chunk = await client.send("IO.read", { handle: stream });
    result += chunk.data ?? "";
    if (chunk.eof) break;
  }
  await client.send("IO.close", { handle: stream });
  return result;
}

async function collectTrace(client) {
  const done = new Promise((resolveDone) => {
    client.once("Tracing.tracingComplete", resolveDone);
  });
  await client.send("Tracing.end");
  const event = await done;
  return readTraceStream(client, event.stream);
}

function metricsMap(metricsResponse) {
  return Object.fromEntries(
    metricsResponse.metrics.map((metric) => [metric.name, metric.value]),
  );
}

function diffMetrics(before, after) {
  const names = [
    "TaskDuration",
    "ScriptDuration",
    "LayoutDuration",
    "RecalcStyleDuration",
    "JSHeapUsedSize",
  ];
  return Object.fromEntries(
    names.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)]),
  );
}

function traceSummary(traceText) {
  const parsed = JSON.parse(traceText);
  const mainThreadIds = new Set();

  for (const event of parsed.traceEvents ?? []) {
    if (
      event.ph === "M" &&
      event.name === "thread_name" &&
      event.args?.name === "CrRendererMain"
    ) {
      mainThreadIds.add(`${event.pid}:${event.tid}`);
    }
  }

  const totals = new Map();
  for (const event of parsed.traceEvents ?? []) {
    if (event.ph !== "X" || typeof event.dur !== "number") continue;
    if (!mainThreadIds.has(`${event.pid}:${event.tid}`)) continue;
    totals.set(event.name, (totals.get(event.name) ?? 0) + event.dur / 1000);
  }

  const top = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, durationMs]) => ({ name, durationMs }));

  return {
    rendererMainThreadCount: mainThreadIds.size,
    topRendererEvents: top,
  };
}

async function setExtensionStorage(context, page, url) {
  let worker = context.serviceWorkers().find((candidate) =>
    candidate.url().startsWith("chrome-extension://"),
  );
  if (!worker) {
    const workerReady = context.waitForEvent("serviceworker", {
      timeout: 10_000,
    });
    await page.goto(`${url}?warmup=1`, { waitUntil: "domcontentloaded" });
    worker = await workerReady;
  }

  await worker.evaluate(() => {
    return new Promise((resolveStorage) => {
      chrome.storage.local.set(
        {
          onboarding_complete: true,
          playerIdentity: {
            publicKey: "pk_" + "1".repeat(130),
            privateKey: {},
            playerStyle: {
              colorPalette: ["#4a9a8a"],
              animationStyle: "gentle",
              interactionPatterns: [],
            },
            createdAt: Date.now(),
            discoveredSites: [],
          },
          collection_mode_cursor: "local",
          collection_mode_navigation: "local",
          collection_mode_viewport: "local",
          collection_mode_keyboard: "local",
          collection_keyboard_privacy_level: 0,
          collection_keyboard_filter_substrings: [],
        },
        resolveStorage,
      );
    });
  });
}

async function prepareScenarioPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(750);
}

async function runScenario(page, { mouseSteps, scrollSteps }, logPhase = () => {}) {
  const target = page.locator("#hover-target");
  const box = await target.boundingBox();
  if (!box) throw new Error("Trace target did not render");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.waitForTimeout(500);
  logPhase("hover complete");

  await page.locator("#typing-target").click();
  await page.keyboard.type("grounded performance trace input", { delay: 15 });
  logPhase("typing complete");

  for (let i = 0; i < mouseSteps; i++) {
    await page.mouse.move(
      centerX - 120 + (i % 24) * 10,
      centerY - 60 + (i % 12) * 10,
    );
    if (i % 12 === 0) await page.waitForTimeout(12);
  }
  logPhase("mouse path complete");

  for (let i = 0; i < scrollSteps; i++) {
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(35);
  }
  logPhase("scroll complete");

  await page.waitForTimeout(3_000);
  logPhase("settle complete");
}

async function runOne({
  chromePath,
  extensionPath,
  label,
  mouseSteps,
  outDir,
  runIndex,
  scrollSteps,
  timeoutMs,
  url,
}) {
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, "_");
  const userDataDir = resolve(outDir, `${safeLabel}-profile-${runIndex}-${process.pid}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  });
  const startedAt = Date.now();
  const logPhase = (phase) => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`Tracing ${label} run ${runIndex}: ${phase} (${elapsedMs}ms)`);
  };
  logPhase("browser launched");

  let timeoutId;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      context.close().catch(() => {});
      reject(
        new Error(`${label} run ${runIndex} timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([runTraceScenario(), timeout]);
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      await context.close().catch(() => {});
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  async function runTraceScenario() {
    const page = await context.newPage();
    logPhase("page opened");
    await setExtensionStorage(context, page, url);
    logPhase("extension storage ready");
    await prepareScenarioPage(page, url);
    logPhase("scenario page ready");
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    logPhase("performance metrics enabled");

    const before = metricsMap(await client.send("Performance.getMetrics"));
    await client.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "v8.execute",
        "blink.user_timing",
      ].join(","),
    });
    logPhase("trace started");

    await runScenario(page, { mouseSteps, scrollSteps }, logPhase);
    logPhase("scenario complete");

    const after = metricsMap(await client.send("Performance.getMetrics"));
    const traceText = await collectTrace(client);
    logPhase("trace collected");
    const tracePath = resolve(outDir, `${safeLabel}-run-${runIndex}.trace.json`);
    await writeFile(tracePath, traceText);
    logPhase("trace written");

    return {
      label,
      runIndex,
      tracePath,
      metrics: diffMetrics(before, after),
      trace: traceSummary(traceText),
    };
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(results) {
  const byLabel = new Map();
  for (const result of results) {
    if (!byLabel.has(result.label)) byLabel.set(result.label, []);
    byLabel.get(result.label).push(result);
  }

  return [...byLabel.entries()].map(([label, items]) => ({
    label,
    runs: items.length,
    meanMetrics: Object.fromEntries(
      Object.keys(items[0].metrics).map((metric) => [
        metric,
        mean(items.map((item) => item.metrics[metric])),
      ]),
    ),
    traces: items.map((item) => item.tracePath),
    topRendererEvents: items[0].trace.topRendererEvents,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outDir, { recursive: true });

  const results = await withServer(async (url) => {
    const all = [];
    for (const extension of args.labels) {
      for (let runIndex = 1; runIndex <= args.runs; runIndex++) {
        console.log(`Tracing ${extension.label} run ${runIndex}/${args.runs}`);
        all.push(await runOne({
          chromePath: args.chromePath,
          extensionPath: extension.extensionPath,
          label: extension.label,
          mouseSteps: args.mouseSteps,
          outDir: args.outDir,
          runIndex,
          scrollSteps: args.scrollSteps,
          timeoutMs: args.timeoutMs,
          url,
        }));
      }
    }
    return all;
  });

  const summary = {
    createdAt: new Date().toISOString(),
    repoRoot,
    runs: results,
    summary: summarize(results),
  };

  const summaryPath = resolve(args.outDir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary.summary, null, 2));
  console.log(`Trace summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
