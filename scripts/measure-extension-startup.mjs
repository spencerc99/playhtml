// ABOUTME: Measures unpacked extension startup until every normal collector is ready.
// ABOUTME: Alternates builds in fresh Chrome profiles and validates lazy page UI on demand.

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
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
const expectedCollectors = ["cursor", "navigation", "viewport", "keyboard"];
const measuredMetrics = [
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "JSHeapUsedSize",
];

function parseArgs(argv) {
  const args = {
    chromePath: defaultChromePath,
    extensions: [],
    outDir: "/private/tmp/playhtml-extension-startup",
    runs: 10,
    timeoutMs: 30_000,
    validateUiLabel: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chrome-path") {
      args.chromePath = argv[++i];
    } else if (arg === "--extension") {
      const raw = argv[++i];
      const splitAt = raw.indexOf(":");
      if (splitAt === -1) throw new Error("--extension expects label:/absolute/path");
      args.extensions.push({
        label: raw.slice(0, splitAt),
        extensionPath: resolve(raw.slice(splitAt + 1)),
      });
    } else if (arg === "--out-dir") {
      args.outDir = resolve(argv[++i]);
    } else if (arg === "--runs") {
      args.runs = Number(argv[++i]);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg === "--validate-ui") {
      args.validateUiLabel = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.extensions.length !== 2) {
    throw new Error("Pass exactly two --extension label:/absolute/path arguments");
  }
  if (new Set(args.extensions.map(({ label }) => label)).size !== 2) {
    throw new Error("Extension labels must be unique");
  }
  for (const extension of args.extensions) {
    if (!existsSync(resolve(extension.extensionPath, "manifest.json"))) {
      throw new Error(`Missing extension manifest for ${extension.label}`);
    }
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be an integer of at least 1000");
  }
  if (
    args.validateUiLabel !== null &&
    !args.extensions.some(({ label }) => label === args.validateUiLabel)
  ) {
    throw new Error("--validate-ui must name one of the extension labels");
  }

  return args;
}

function pageHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Extension startup measurement</title>
  </head>
  <body>
    <main><h1>Extension startup measurement</h1></main>
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
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    res.end(pageHtml());
  });

  await new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectServer);
      resolveServer();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve local startup server port");
  }

  try {
    return await callback(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function metricsMap(response) {
  return Object.fromEntries(response.metrics.map(({ name, value }) => [name, value]));
}

function diffMetrics(before, after) {
  return Object.fromEntries(
    measuredMetrics.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)]),
  );
}

async function waitForExtensionWorker(context, timeoutMs) {
  const existing = context.serviceWorkers().find((worker) =>
    worker.url().startsWith("chrome-extension://"),
  );
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

async function seedExtensionStorage(worker) {
  await worker.evaluate(() => {
    return chrome.storage.local.set({
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
    });
  });
}

async function sendToMeasuredTab(worker, pageUrl, message) {
  return worker.evaluate(
    async ({ messageToSend, measuredUrl }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.startsWith(measuredUrl));
      if (tab?.id === undefined) return null;
      try {
        return await chrome.tabs.sendMessage(tab.id, messageToSend);
      } catch {
        return null;
      }
    },
    { measuredUrl: pageUrl, messageToSend: message },
  );
}

function collectorsAreReady(response) {
  if (!Array.isArray(response?.statuses)) return false;
  return expectedCollectors.every((type) =>
    response.statuses.some((status) => status.type === type && status.enabled === true),
  );
}

async function waitForCollectors(worker, pageUrl, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const response = await sendToMeasuredTab(worker, pageUrl, {
      type: "GET_COLLECTOR_STATUSES",
    });
    if (collectorsAreReady(response)) return response.statuses;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Collectors did not become ready within ${timeoutMs}ms`);
}

async function validateLazyUi({ client, page, pageUrl, requestedUrls, worker }) {
  if (requestedUrls.some((url) => url.endsWith("/content-page-ui.js"))) {
    throw new Error("Rare page UI loaded before an on-demand UI message");
  }

  const overlayResponse = await sendToMeasuredTab(worker, pageUrl, {
    type: "TOGGLE_HISTORICAL_OVERLAY",
  });
  if (overlayResponse?.success !== true || overlayResponse.visible !== true) {
    throw new Error("Historical overlay did not report as visible");
  }
  await page.locator("#playhtml-historical-overlay-root").waitFor({ state: "attached" });

  if (!requestedUrls.some((url) => url.endsWith("/content-page-ui.js"))) {
    throw new Error("Historical overlay did not request the lazy page UI script");
  }

  const closeResponse = await sendToMeasuredTab(worker, pageUrl, {
    type: "TOGGLE_HISTORICAL_OVERLAY",
  });
  if (closeResponse?.success !== true || closeResponse.visible !== false) {
    throw new Error("Historical overlay did not report as closed");
  }
  await page.locator("#playhtml-historical-overlay-root").waitFor({ state: "detached" });

  const toastResponse = await sendToMeasuredTab(worker, pageUrl, {
    type: "SHOW_MILESTONE",
    milestone: {
      type: "cursorDistance",
      displayValue: "1 mi",
      copy: "You moved one mile today.",
      ctaLabel: "See your trail",
      ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
      period: "today",
    },
  });
  if (toastResponse?.success !== true) {
    throw new Error("Milestone toast message failed");
  }
  await page.waitForFunction(() =>
    [...document.body.children].some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      return (
        element.style.position === "fixed" &&
        element.style.bottom === "20px" &&
        element.style.left === "20px"
      );
    }),
  );

  await client.send("Network.disable");
  return {
    historicalOverlay: "opened and closed",
    milestoneToast: "mounted",
    lazyScriptRequests: requestedUrls.filter((url) => url.endsWith("/content-page-ui.js")),
  };
}

async function runOne({
  chromePath,
  extension,
  outDir,
  pairIndex,
  pageUrl,
  position,
  timeoutMs,
  validateUi,
}) {
  const safeLabel = extension.label.replace(/[^a-z0-9_-]/gi, "_");
  const profilePath = resolve(
    outDir,
    `${safeLabel}-profile-${pairIndex}-${position}-${process.pid}`,
  );
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromePath,
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension.extensionPath}`,
      `--load-extension=${extension.extensionPath}`,
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  });

  try {
    const worker = await waitForExtensionWorker(context, timeoutMs);
    await seedExtensionStorage(worker);
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    const requestedUrls = [];
    client.on("Network.requestWillBeSent", ({ request }) => requestedUrls.push(request.url));
    await client.send("Network.enable");
    await client.send("Performance.enable");
    const before = metricsMap(await client.send("Performance.getMetrics"));

    const startedAt = performance.now();
    await page.goto(pageUrl, { waitUntil: "commit" });
    const statuses = await waitForCollectors(worker, pageUrl, timeoutMs);
    const readyMs = performance.now() - startedAt;
    const after = metricsMap(await client.send("Performance.getMetrics"));
    const metrics = diffMetrics(before, after);
    const lazyUiLoadedDuringStartup = requestedUrls.some((url) =>
      url.endsWith("/content-page-ui.js"),
    );
    const ui = validateUi
      ? await validateLazyUi({ client, page, pageUrl, requestedUrls, worker })
      : null;

    return {
      label: extension.label,
      pairIndex,
      position,
      readyMs,
      metrics,
      collectors: statuses.map(({ enabled, type }) => ({ type, enabled })),
      lazyUiLoadedDuringStartup,
      ui,
    };
  } finally {
    await context.close().catch(() => {});
    await rm(profilePath, { recursive: true, force: true }).catch(() => {});
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function distribution(values) {
  return {
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function summarize(results, extensions) {
  const fields = ["readyMs", ...measuredMetrics];
  const byLabel = Object.fromEntries(
    extensions.map(({ label }) => {
      const runs = results.filter((result) => result.label === label);
      return [
        label,
        Object.fromEntries(
          fields.map((field) => [
            field,
            distribution(
              runs.map((run) => field === "readyMs" ? run.readyMs : run.metrics[field]),
            ),
          ]),
        ),
      ];
    }),
  );

  const [baseline, candidate] = extensions;
  const pairedDifferences = Object.fromEntries(
    fields.map((field) => {
      const differences = [];
      for (const pairIndex of new Set(results.map((result) => result.pairIndex))) {
        const baseRun = results.find(
          (result) => result.pairIndex === pairIndex && result.label === baseline.label,
        );
        const candidateRun = results.find(
          (result) => result.pairIndex === pairIndex && result.label === candidate.label,
        );
        const baseValue = field === "readyMs" ? baseRun.readyMs : baseRun.metrics[field];
        const candidateValue =
          field === "readyMs" ? candidateRun.readyMs : candidateRun.metrics[field];
        differences.push(candidateValue - baseValue);
      }
      return [field, distribution(differences)];
    }),
  );

  return {
    byLabel,
    comparison: `${candidate.label} minus ${baseline.label}`,
    pairedDifferences,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outDir, { recursive: true });
  console.log(`Writing startup measurements to ${args.outDir}`);

  const results = await withServer(async (pageUrl) => {
    const allRuns = [];
    for (let pairIndex = 1; pairIndex <= args.runs; pairIndex++) {
      const order = pairIndex % 2 === 1 ? args.extensions : [...args.extensions].reverse();
      for (let position = 0; position < order.length; position++) {
        const extension = order[position];
        const validateUi =
          args.validateUiLabel === extension.label &&
          !allRuns.some((run) => run.ui !== null);
        console.log(
          `Measuring pair ${pairIndex}/${args.runs}, position ${position + 1}: ${extension.label}`,
        );
        allRuns.push(
          await runOne({
            chromePath: args.chromePath,
            extension,
            outDir: args.outDir,
            pairIndex,
            pageUrl,
            position: position + 1,
            timeoutMs: args.timeoutMs,
            validateUi,
          }),
        );
      }
    }
    return allRuns;
  });

  const output = {
    createdAt: new Date().toISOString(),
    repoRoot,
    chromePath: args.chromePath,
    runsPerBuild: args.runs,
    results,
    summary: summarize(results, args.extensions),
  };
  const outputPath = resolve(args.outDir, "startup-summary.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.summary, null, 2));
  console.log(`Startup summary: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
