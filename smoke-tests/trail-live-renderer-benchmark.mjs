// ABOUTME: Benchmarks SVG and Canvas path painting inside the production LiveTrails component.
// ABOUTME: Records full-browser CPU, main-thread time, frame pacing, memory, scene counts, and parity.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory =
  process.argv[2] ?? "/private/tmp/playhtml-trail-live-renderer-benchmark";
const durationMs = Number(process.env.TRAIL_LIVE_RENDERER_DURATION_MS ?? 2500);
const repeats = Number(process.env.TRAIL_LIVE_RENDERER_REPEATS ?? 2);
const pixelRatio = Number(process.env.TRAIL_LIVE_RENDERER_PIXEL_RATIO ?? 2);
const requestedWorkloads = process.env.TRAIL_LIVE_RENDERER_WORKLOADS?.split(",");
const workloads = [
  { id: "active", warmupMs: 3500, camera: false },
  { id: "active-camera", warmupMs: 3500, camera: true },
  { id: "mixed", warmupMs: 19_000, camera: false },
].filter(
  (workload) => !requestedWorkloads || requestedWorkloads.includes(workload.id),
);

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function median(values) {
  return percentile(values, 0.5);
}

function metricMap(result) {
  return new Map(result.metrics.map(({ name, value }) => [name, value]));
}

function diffMetrics(before, after) {
  return Object.fromEntries(
    ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"]
      .map((name) => [name, ((after.get(name) ?? 0) - (before.get(name) ?? 0)) * 1000]),
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

async function compareImages(firstPath, secondPath) {
  const first = await sharp(firstPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const second = await sharp(secondPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (first.info.width !== second.info.width || first.info.height !== second.info.height) {
    throw new Error("Parity screenshots have different dimensions");
  }
  let absoluteDifference = 0;
  let changedPixels = 0;
  const pixelCount = first.info.width * first.info.height;
  for (let offset = 0; offset < first.data.length; offset += 3) {
    const difference =
      Math.abs(first.data[offset] - second.data[offset]) +
      Math.abs(first.data[offset + 1] - second.data[offset + 1]) +
      Math.abs(first.data[offset + 2] - second.data[offset + 2]);
    absoluteDifference += difference;
    if (difference > 15) changedPixels++;
  }
  return {
    meanChannelDifference: absoluteDifference / (pixelCount * 3),
    changedPixelPercent: (changedPixels / pixelCount) * 100,
  };
}

async function sceneCounts(page) {
  return page.evaluate(() => {
    const pathLayer = document.querySelector("[data-trail-path-renderer]");
    const cursorGroups = pathLayer
      ? Array.from(document.querySelectorAll("[data-trail-path-renderer] ~ g"))
      : [];
    const canvas = document.querySelector("[data-trail-path-canvas]");
    return {
      renderer: pathLayer?.getAttribute("data-trail-path-renderer"),
      trailGroups: pathLayer?.children.length ?? 0,
      trailPathElements: pathLayer?.querySelectorAll("path").length ?? 0,
      visibleTrailPathElements: pathLayer
        ? Array.from(pathLayer.querySelectorAll("path")).filter(
            (element) => getComputedStyle(element).display !== "none",
          ).length
        : 0,
      cursorHeads: cursorGroups.length,
      visibleCursorHeads: cursorGroups.filter(
        (element) => getComputedStyle(element).display !== "none",
      ).length,
      rippleCircles: document.querySelectorAll("svg.trails-svg circle").length,
      viewBox: document.querySelector("svg.trails-svg")?.getAttribute("viewBox"),
      canvasBackingBytes:
        canvas instanceof HTMLCanvasElement ? canvas.width * canvas.height * 4 : 0,
    };
  });
}

await mkdir(outputDirectory, { recursive: true });
const server = await createServer({
  root,
  optimizeDeps: {
    noDiscovery: true,
    include: ["react", "react-dom/client", "react/jsx-dev-runtime"],
  },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const fixtureUrl = new URL(
  "smoke-tests/fixtures/trail-live-renderers.html",
  server.resolvedUrls.local[0],
);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const browserSession = await browser.newBrowserCDPSession();
const results = [];
const parity = [];
const errors = [];

for (const workload of workloads) {
  for (let repeat = 0; repeat < repeats; repeat++) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: pixelRatio,
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Fixture error:", error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error("Fixture console:", message.text());
    });
    const url = new URL(fixtureUrl);
    url.searchParams.set("workload", workload.id === "mixed" ? "mixed" : "active");
    if (workload.camera) url.searchParams.set("camera", "1");
    await page.goto(url.href);
    await page.waitForFunction(() => window.trailBenchmark?.ready);
    await page.waitForTimeout(workload.warmupMs);
    const pageSession = await page.context().newCDPSession(page);
    await pageSession.send("Performance.enable");

    const order = repeat % 2 === 0
      ? ["svg", "canvas", "svg"]
      : ["canvas", "svg", "canvas"];
    for (let position = 0; position < order.length; position++) {
      const renderer = order[position];
      await page.evaluate((nextRenderer) =>
        window.trailBenchmark.setRenderer(nextRenderer), renderer);
      const beforeMetrics = metricMap(await pageSession.send("Performance.getMetrics"));
      const beforeCpu = await browserSession.send("SystemInfo.getProcessInfo");
      const beforeHeap = await pageSession.send("Runtime.getHeapUsage");
      const frameIntervals = await page.evaluate((sampleDurationMs) =>
        window.trailBenchmark.sampleFrames(sampleDurationMs), durationMs);
      const afterHeap = await pageSession.send("Runtime.getHeapUsage");
      const afterCpu = await browserSession.send("SystemInfo.getProcessInfo");
      const afterMetrics = metricMap(await pageSession.send("Performance.getMetrics"));
      const counts = await sceneCounts(page);
      const processCpu = diffProcessCpu(beforeCpu, afterCpu);
      results.push({
        workload: workload.id,
        repeat,
        position,
        renderer,
        durationMs,
        processCpu,
        mainThread: diffMetrics(beforeMetrics, afterMetrics),
        heap: {
          usedBytes: afterHeap.usedSize,
          deltaBytes: afterHeap.usedSize - beforeHeap.usedSize,
        },
        frames: {
          count: frameIntervals.length,
          medianMs: median(frameIntervals),
          p95Ms: percentile(frameIntervals, 0.95),
          p99Ms: percentile(frameIntervals, 0.99),
          over20Ms: frameIntervals.filter((interval) => interval > 20).length,
          over50Ms: frameIntervals.filter((interval) => interval > 50).length,
        },
        counts,
      });
      console.log(results.at(-1));
    }

    if (repeat === 0) {
      await page.evaluate(() => window.trailBenchmark.setRenderer("canvas"));
      await page.evaluate(() => window.trailBenchmark.setFrozen(true));
      const canvasPath = path.join(outputDirectory, `${workload.id}-canvas.png`);
      const svgPath = path.join(outputDirectory, `${workload.id}-svg.png`);
      await page.screenshot({ path: canvasPath });
      await page.evaluate(() => window.trailBenchmark.setRenderer("svg"));
      await page.screenshot({ path: svgPath });
      parity.push({
        workload: workload.id,
        ...(await compareImages(svgPath, canvasPath)),
        svgPath,
        canvasPath,
      });
    }

    await pageSession.detach();
    await page.close();
  }
}

await browser.close();
await server.close();
if (errors.length > 0) throw new Error(errors.join("\n"));

const aggregates = [];
for (const workload of workloads) {
  for (const renderer of ["svg", "canvas"]) {
    const matching = results.filter(
      (result) => result.workload === workload.id && result.renderer === renderer,
    );
    aggregates.push({
      workload: workload.id,
      renderer,
      samples: matching.length,
      totalCpuMs: median(matching.map((result) => result.processCpu.totalCpuMs)),
      rendererCpuMs: median(
        matching.map((result) => result.processCpu.byType.renderer ?? 0),
      ),
      gpuCpuMs: median(matching.map((result) => result.processCpu.byType.GPU ?? 0)),
      taskDurationMs: median(
        matching.map((result) => result.mainThread.TaskDuration),
      ),
      scriptDurationMs: median(
        matching.map((result) => result.mainThread.ScriptDuration),
      ),
      p95FrameMs: median(matching.map((result) => result.frames.p95Ms)),
      slowFrames: median(matching.map((result) => result.frames.over20Ms)),
      medianFps: median(
        matching.map((result) => (result.frames.count * 1000) / durationMs),
      ),
      worstFps: Math.min(
        ...matching.map((result) => (result.frames.count * 1000) / durationMs),
      ),
      heapUsedBytes: median(matching.map((result) => result.heap.usedBytes)),
      counts: matching.at(-1)?.counts,
    });
  }
}

const matchedComparisons = [];
for (const workload of workloads) {
  for (const position of [0, 1, 2]) {
    const matching = results.filter(
      (result) => result.workload === workload.id && result.position === position,
    );
    const svg = matching.filter((result) => result.renderer === "svg");
    const canvas = matching.filter((result) => result.renderer === "canvas");
    if (svg.length === 0 || canvas.length === 0) continue;
    const svgCpu = median(svg.map((result) => result.processCpu.totalCpuMs));
    const canvasCpu = median(canvas.map((result) => result.processCpu.totalCpuMs));
    const svgTask = median(svg.map((result) => result.mainThread.TaskDuration));
    const canvasTask = median(canvas.map((result) => result.mainThread.TaskDuration));
    matchedComparisons.push({
      workload: workload.id,
      position,
      rippleCircles: median(
        matching.map((result) => result.counts.rippleCircles),
      ),
      totalCpuDeltaPercent: (canvasCpu / svgCpu - 1) * 100,
      mainTaskDeltaPercent: (canvasTask / svgTask - 1) * 100,
      svgFps: median(
        svg.map((result) => (result.frames.count * 1000) / durationMs),
      ),
      canvasFps: median(
        canvas.map((result) => (result.frames.count * 1000) / durationMs),
      ),
    });
  }
}

await writeFile(
  path.join(outputDirectory, "results.json"),
  `${JSON.stringify({ durationMs, repeats, pixelRatio, results, aggregates, matchedComparisons, parity }, null, 2)}\n`,
);

const tableRows = aggregates.map((row) =>
  `| ${row.workload} | ${row.renderer} | ${row.samples} | ${row.totalCpuMs.toFixed(0)} | ${row.rendererCpuMs.toFixed(0)} | ${row.gpuCpuMs.toFixed(0)} | ${row.taskDurationMs.toFixed(0)} | ${row.scriptDurationMs.toFixed(0)} | ${row.medianFps.toFixed(1)} | ${row.worstFps.toFixed(1)} | ${row.p95FrameMs.toFixed(2)} |`,
);
const comparisonRows = matchedComparisons.map((row) =>
  `| ${row.workload} | ${row.position + 1} | ${row.rippleCircles} | ${row.totalCpuDeltaPercent.toFixed(1)}% | ${row.mainTaskDeltaPercent.toFixed(1)}% | ${row.svgFps.toFixed(1)} | ${row.canvasFps.toFixed(1)} |`,
);
const parityRows = parity.map((row) =>
  `| ${row.workload} | ${row.meanChannelDifference.toFixed(3)} | ${row.changedPixelPercent.toFixed(3)}% |`,
);
const report = `# LiveTrails renderer benchmark

Each row is the median of its ${durationMs}ms samples at device pixel ratio ${pixelRatio}. The browser stayed headless. Both modes use the production LiveTrails geometry, four path layers, cursor heads, click ripples, fading, and camera code. Canvas keeps hidden SVG paths as its geometry source, so this measures the paint-backend opportunity without assuming a geometry rewrite.

| Workload | Renderer | Samples | Total CPU ms | Renderer CPU ms | GPU CPU ms | Main task ms | Script ms | Median FPS | Worst FPS | p95 frame ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${tableRows.join("\n")}

## Matched scene ages

Positive deltas mean Canvas used more CPU. Positions compare the same trail progress and ripple count across the two balanced runs.

| Workload | Position | Ripple circles | Total CPU delta | Main task delta | SVG FPS | Canvas FPS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${comparisonRows.join("\n")}

## Visual parity

| Workload | Mean channel difference | Pixels changed > 5/channel |
| --- | ---: | ---: |
${parityRows.join("\n")}

## Limits

- The benchmark covers the color renderer. A Canvas request falls back to SVG for the monochrome filter renderer.
- Canvas deliberately retains the hidden SVG geometry layer. The comparison isolates the paint-backend opportunity and includes the Canvas copy cost; it does not model a full geometry rewrite.
- Cursor heads, retained click ripples, fades, and camera behavior are production components shared by both modes. The surrounding portrait page is excluded.
- CPU is Chrome process CPU time across browser, renderer, and GPU processes. It is not a direct battery or wall-power measurement.
`;
await writeFile(path.join(outputDirectory, "report.md"), report);
console.log(`Wrote ${path.join(outputDirectory, "report.md")}`);
