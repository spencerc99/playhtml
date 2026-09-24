// ABOUTME: Compares trail renderers across frame pacing, browser CPU, memory, and visual parity.
// ABOUTME: Runs matched workloads in hardware-accelerated Chrome and writes reviewable results.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { chromium } from "playwright";
import { createServer } from "vite";

const outputDirectory = process.argv[2] ?? "/private/tmp/playhtml-trail-renderer-performance";
const root = fileURLToPath(new URL("..", import.meta.url));
const durationMs = Number(process.env.TRAIL_BENCHMARK_DURATION_MS ?? 2500);
const repeats = Number(process.env.TRAIL_BENCHMARK_REPEATS ?? 3);
const pixelRatio = Number(process.env.TRAIL_BENCHMARK_PIXEL_RATIO ?? 1);
const targetFps = Number(process.env.TRAIL_BENCHMARK_TARGET_FPS ?? 0);
const headless = process.env.TRAIL_BENCHMARK_HEADFUL !== "1";
const requestedRenderers = process.env.TRAIL_BENCHMARK_RENDERERS?.split(",");
const requestedWorkloads = process.env.TRAIL_BENCHMARK_WORKLOADS?.split(",");
const renderers = ["svg", "svg-css", "canvas", "canvas-layered"].filter(
  (renderer) => !requestedRenderers || requestedRenderers.includes(renderer),
);
const workloads = [
  { id: "active-moving-camera", trails: 50, points: 500, activeCount: 50, moveCamera: true },
  { id: "active-static-camera", trails: 50, points: 500, activeCount: 50, moveCamera: false },
  { id: "settled-moving-camera", trails: 50, points: 500, activeCount: 2, moveCamera: true },
  { id: "settled-static-camera", trails: 50, points: 500, activeCount: 2, moveCamera: false },
].filter((workload) => !requestedWorkloads || requestedWorkloads.includes(workload.id));

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function metricMap(result) {
  return new Map(result.metrics.map(({ name, value }) => [name, value]));
}

function diffMetrics(before, after) {
  const names = [
    "TaskDuration",
    "ScriptDuration",
    "LayoutDuration",
    "RecalcStyleDuration",
    "JSHeapUsedSize",
    "Nodes",
  ];
  return Object.fromEntries(
    names.map((name) => [name, (after.get(name) ?? 0) - (before.get(name) ?? 0)]),
  );
}

function diffProcessCpu(before, after) {
  const beforeById = new Map(before.processInfo.map((process) => [process.id, process]));
  const byType = {};
  for (const process of after.processInfo) {
    const previous = beforeById.get(process.id);
    if (!previous) continue;
    const cpuMs = Math.max(0, (process.cpuTime - previous.cpuTime) * 1000);
    byType[process.type] = (byType[process.type] ?? 0) + cpuMs;
  }
  return {
    totalCpuMs: Object.values(byType).reduce((total, value) => total + value, 0),
    byType,
  };
}

function traceSummary(events) {
  const threadNames = new Map();
  for (const event of events) {
    if (event.ph === "M" && event.name === "thread_name") {
      threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? "unknown");
    }
  }
  const eventsNamed = (name) => events.filter((event) => event.name === name);
  const cpuMs = (matchingEvents) => matchingEvents
    .filter((event) => event.tdur !== undefined)
    .reduce((total, event) => total + event.tdur / 1000, 0);
  const wallMs = (matchingEvents) => matchingEvents
    .filter((event) => event.dur !== undefined)
    .reduce((total, event) => total + event.dur / 1000, 0);
  const mainTasks = eventsNamed("RunTask").filter(
    (event) => threadNames.get(`${event.pid}:${event.tid}`) === "CrRendererMain",
  );
  const rasterTasks = eventsNamed("RasterTask");
  const paints = eventsNamed("Paint").filter(
    (event) => threadNames.get(`${event.pid}:${event.tid}`) === "CrRendererMain",
  );
  const commits = eventsNamed("LayerTreeHost::DoCommit");
  return {
    mainTaskCpuMs: cpuMs(mainTasks),
    mainTaskWallMs: wallMs(mainTasks),
    mainLongTasks: mainTasks.filter((event) => (event.dur ?? 0) >= 50_000).length,
    rasterTaskCpuMs: cpuMs(rasterTasks),
    rasterTaskCount: rasterTasks.length,
    paintCpuMs: cpuMs(paints),
    paintCount: paints.length,
    commitCpuMs: cpuMs(commits),
    commitCount: commits.length,
  };
}

function frameSummary(measurement) {
  const refreshIntervalMs = percentile(measurement.callbackTimes, 0.5);
  const missedFrameEquivalent = measurement.callbackTimes.reduce(
    (total, interval) => total + Math.max(0, Math.round(interval / refreshIntervalMs) - 1),
    0,
  );
  return {
    wallMs: measurement.wallMs,
    renderedFrames: measurement.drawTimes.length,
    framesPerSecond: (measurement.drawTimes.length * 1000) / measurement.wallMs,
    refreshIntervalMs,
    missedFrameEquivalent,
    p50FrameIntervalMs: percentile(measurement.frameTimes, 0.5),
    p95FrameIntervalMs: percentile(measurement.frameTimes, 0.95),
    maxFrameIntervalMs: Math.max(0, ...measurement.frameTimes),
    meanDrawMs: mean(measurement.drawTimes),
    p95DrawMs: percentile(measurement.drawTimes, 0.95),
    maxDrawMs: Math.max(0, ...measurement.drawTimes),
    p95TimerDelayMs: percentile(measurement.timerDelays, 0.95),
    maxTimerDelayMs: Math.max(0, ...measurement.timerDelays),
  };
}

async function comparePng(referencePath, candidatePath) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const candidate = await sharp(candidatePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (
    reference.info.width !== candidate.info.width ||
    reference.info.height !== candidate.info.height ||
    reference.data.length !== candidate.data.length
  ) {
    throw new Error("Cannot compare screenshots with different dimensions");
  }
  let absoluteDifference = 0;
  let changedPixels = 0;
  const pixelCount = reference.info.width * reference.info.height;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    let pixelDifference = 0;
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(reference.data[offset + channel] - candidate.data[offset + channel]);
      absoluteDifference += difference;
      pixelDifference = Math.max(pixelDifference, difference);
    }
    if (pixelDifference > 12) changedPixels++;
  }
  return {
    meanAbsoluteChannelDifference: absoluteDifference / (pixelCount * 3),
    changedPixelPercent: (changedPixels * 100) / pixelCount,
  };
}

function medianRuns(items, selector) {
  return percentile(items.map(selector), 0.5);
}

function summarize(results, baseline) {
  const summaries = [];
  for (const workload of workloads) {
    for (const renderer of renderers) {
      const items = results.filter(
        (result) => result.workload === workload.id && result.renderer === renderer,
      );
      summaries.push({
        workload: workload.id,
        renderer,
        runs: items.length,
        framesPerSecond: medianRuns(items, (item) => item.frames.framesPerSecond),
        missedFrameEquivalent: medianRuns(items, (item) => item.frames.missedFrameEquivalent),
        p95FrameIntervalMs: medianRuns(items, (item) => item.frames.p95FrameIntervalMs),
        p95DrawMs: medianRuns(items, (item) => item.frames.p95DrawMs),
        p95TimerDelayMs: medianRuns(items, (item) => item.frames.p95TimerDelayMs),
        totalProcessCpuMs: medianRuns(items, (item) => item.processCpu.totalCpuMs),
        incrementalProcessCpuMs:
          medianRuns(items, (item) => item.processCpu.totalCpuMs) - baseline.totalProcessCpuMs,
        rendererProcessCpuMs: medianRuns(items, (item) => item.processCpu.byType.renderer ?? 0),
        gpuProcessCpuMs: medianRuns(items, (item) => item.processCpu.byType.GPU ?? 0),
        mainTaskCpuMs: medianRuns(items, (item) => item.trace.mainTaskCpuMs),
        rasterTaskCpuMs: medianRuns(items, (item) => item.trace.rasterTaskCpuMs),
        paintCpuMs: medianRuns(items, (item) => item.trace.paintCpuMs),
        jsHeapUsedBytes: medianRuns(items, (item) => item.heap.afterCollection.usedSize),
        collectibleHeapBytes: medianRuns(
          items,
          (item) => item.heap.allocatedSinceCollectionBytes,
        ),
        domElements: items[0]?.fixture.domElements ?? 0,
        canvasBackingBytes: items[0]?.fixture.canvasBackingBytes ?? 0,
      });
    }
  }
  return summaries;
}

function markdownReport(environment, baseline, summaries, visualParity) {
  const lines = [
    "# Trail renderer performance",
    "",
    `Chrome ${environment.chromeVersion}; ${environment.gpuDevice}; device pixel ratio ${pixelRatio}.`,
    `Each result is the median of ${repeats} runs of ${durationMs} ms at ${targetFps || "the display's native refresh rate"}.`,
    `The empty animation-loop baseline used ${baseline.totalProcessCpuMs.toFixed(0)} ms of browser-process CPU.`,
    "",
  ];
  for (const workload of workloads) {
    lines.push(`## ${workload.id}`, "");
    lines.push("| Renderer | FPS | Missed frames | CPU over baseline ms | Total CPU ms | Main CPU ms | Raster CPU ms | GPU CPU ms | p95 timer delay ms | Retained heap MB | Collectible heap MB | Canvas MB |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const item of summaries.filter((summary) => summary.workload === workload.id)) {
      lines.push(
        `| ${item.renderer} | ${item.framesPerSecond.toFixed(1)} | ${item.missedFrameEquivalent.toFixed(0)} | ${item.incrementalProcessCpuMs.toFixed(0)} | ${item.totalProcessCpuMs.toFixed(0)} | ${item.mainTaskCpuMs.toFixed(0)} | ${item.rasterTaskCpuMs.toFixed(0)} | ${item.gpuProcessCpuMs.toFixed(0)} | ${item.p95TimerDelayMs.toFixed(1)} | ${(item.jsHeapUsedBytes / 1_048_576).toFixed(1)} | ${(item.collectibleHeapBytes / 1_048_576).toFixed(1)} | ${(item.canvasBackingBytes / 1_048_576).toFixed(1)} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Visual parity", "", "| Workload | Renderer | Mean channel difference | Changed pixels |", "| --- | --- | ---: | ---: |");
  for (const item of visualParity) {
    lines.push(`| ${item.workload} | ${item.renderer} | ${item.meanAbsoluteChannelDifference.toFixed(2)} | ${item.changedPixelPercent.toFixed(2)}% |`);
  }
  lines.push("");
  return lines.join("\n");
}

await mkdir(outputDirectory, { recursive: true });
const server = await createServer({
  root,
  optimizeDeps: { noDiscovery: true },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const fixtureUrl = new URL(
  "smoke-tests/fixtures/trail-canvas.html",
  server.resolvedUrls.local[0],
).href;
const browser = await chromium.launch({ channel: "chrome", headless });
const browserSession = await browser.newBrowserCDPSession();
const systemInfo = await browserSession.send("SystemInfo.getInfo");
const environment = {
  chromeVersion: await browser.version(),
  headless,
  gpuDevice: systemInfo.gpu.devices[0]?.deviceString ?? "unknown",
  gpuBackend: systemInfo.gpu.auxAttributes?.glImplementationParts ?? "unknown",
};
const results = [];
const screenshots = new Map();

const cases = [
  {
    workload: { id: "baseline", trails: 0, points: 0, activeCount: 0, moveCamera: false },
    renderer: "none",
  },
  ...workloads.flatMap((workload) =>
    renderers.map((renderer) => ({ workload, renderer })),
  ),
];

for (const benchmarkCase of cases) {
  const { workload, renderer } = benchmarkCase;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const context = await browser.newContext({
        viewport: { width: 960, height: 640 },
        deviceScaleFactor: pixelRatio,
      });
      const page = await context.newPage();
      await page.goto(fixtureUrl);
      await page.waitForFunction(() => window.ready);
      await page.evaluate(
        (options) => window.setup(options),
        { ...workload, mode: renderer, mono: false, pixelRatio },
      );
      await page.evaluate(
        ({ moveCamera, targetFps }) => window.measureDuration({ durationMs: 500, targetFps, moveCamera }),
        { moveCamera: workload.moveCamera, targetFps },
      );

      const pageSession = await context.newCDPSession(page);
      await pageSession.send("Performance.enable");
      const beforeMetrics = metricMap(await pageSession.send("Performance.getMetrics"));
      const beforeProcesses = await browserSession.send("SystemInfo.getProcessInfo");
      const traceEvents = [];
      pageSession.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
      await pageSession.send("Tracing.start", {
        categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,renderer.scheduler,toplevel,gpu",
        options: "record-as-much-as-possible",
      });
      const measurement = await page.evaluate(
        (options) => window.measureDuration(options),
        { durationMs, targetFps, moveCamera: workload.moveCamera },
      );
      const traceComplete = new Promise((resolve) =>
        pageSession.once("Tracing.tracingComplete", resolve),
      );
      await pageSession.send("Tracing.end");
      await traceComplete;
      const afterProcesses = await browserSession.send("SystemInfo.getProcessInfo");
      const afterMetrics = metricMap(await pageSession.send("Performance.getMetrics"));
      const heapBeforeCollection = await pageSession.send("Runtime.getHeapUsage");
      await pageSession.send("HeapProfiler.collectGarbage");
      const heapAfterCollection = await pageSession.send("Runtime.getHeapUsage");
      const fixture = await page.evaluate(() => window.getBenchmarkInfo());

      if (repeat === 0 && renderer !== "none") {
        await page.evaluate(
          ({ moveCamera }) => window.drawFrame(45, moveCamera),
          { moveCamera: workload.moveCamera },
        );
        const screenshotPath = path.join(outputDirectory, `${workload.id}-${renderer}.png`);
        await page.locator("#scene").screenshot({ path: screenshotPath });
        screenshots.set(`${workload.id}:${renderer}`, screenshotPath);
      }

      const result = {
        workload: workload.id,
        renderer,
        repeat,
        frames: frameSummary(measurement),
        processCpu: diffProcessCpu(beforeProcesses, afterProcesses),
        trace: traceSummary(traceEvents),
        metrics: diffMetrics(beforeMetrics, afterMetrics),
        heap: {
          beforeCollection: heapBeforeCollection,
          afterCollection: heapAfterCollection,
          allocatedSinceCollectionBytes:
            heapBeforeCollection.usedSize - heapAfterCollection.usedSize,
        },
        fixture,
      };
      results.push(result);
      console.log(JSON.stringify({
        workload: result.workload,
        renderer,
        repeat,
        fps: result.frames.framesPerSecond,
        missed: result.frames.missedFrameEquivalent,
        totalCpuMs: result.processCpu.totalCpuMs,
      }));
      await context.close();
    }
}

const visualParity = [];
for (const workload of workloads) {
  const referencePath = screenshots.get(`${workload.id}:svg`);
  for (const renderer of renderers.filter((candidate) => candidate !== "svg")) {
    visualParity.push({
      workload: workload.id,
      renderer,
      ...await comparePng(referencePath, screenshots.get(`${workload.id}:${renderer}`)),
    });
  }
}

const baselineItems = results.filter((result) => result.renderer === "none");
const baseline = {
  totalProcessCpuMs: medianRuns(baselineItems, (item) => item.processCpu.totalCpuMs),
  mainTaskCpuMs: medianRuns(baselineItems, (item) => item.trace.mainTaskCpuMs),
  gpuProcessCpuMs: medianRuns(baselineItems, (item) => item.processCpu.byType.GPU ?? 0),
};
const summaries = summarize(results, baseline);
await writeFile(
  path.join(outputDirectory, "results.json"),
  JSON.stringify({ environment, durationMs, repeats, pixelRatio, targetFps, baseline, results, summaries, visualParity }, null, 2),
);
await writeFile(
  path.join(outputDirectory, "summary.md"),
  markdownReport(environment, baseline, summaries, visualParity),
);
await browser.close();
await server.close();
