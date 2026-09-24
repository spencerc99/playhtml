// ABOUTME: Profiles the public live trail visualization with rendering layers selectively suppressed.
// ABOUTME: Separates camera, path-painting, and animation-loop costs without changing production data.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputDirectory = process.argv[2] ?? "/private/tmp/playhtml-live-trail-performance";
const durationMs = Number(process.env.TRAIL_LIVE_DURATION_MS ?? 2500);
const repeats = Number(process.env.TRAIL_LIVE_REPEATS ?? 3);
const url = "https://wewere.online/portrait/?viz=trails&clean=2";
const requestedModes = process.env.TRAIL_LIVE_MODES?.split(",");
const modes = [
  "current",
  "freeze-camera",
  "hide-paths",
  "hide-cursors",
  "hide-ripples",
  "normal-ripple-blend",
  "isolate-svg",
  "ripple-30fps",
  "hide-svg",
].filter((mode) =>
  mode === "current" || !requestedModes || requestedModes.includes(mode),
);

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function metricsByName(result) {
  return new Map(result.metrics.map(({ name, value }) => [name, value]));
}

function diffMetrics(before, after) {
  return Object.fromEntries(
    ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "JSHeapUsedSize"]
      .map((name) => [name, (after.get(name) ?? 0) - (before.get(name) ?? 0)]),
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

function median(items, selector) {
  return percentile(items.map(selector), 0.5);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const browserSession = await browser.newBrowserCDPSession();
const systemInfo = await browserSession.send("SystemInfo.getInfo");
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  const setAttribute = Element.prototype.setAttribute;
  window.__freezeTrailViewBox = false;
  window.__rippleFps = 0;
  const lastRippleUpdate = new WeakMap();
  Element.prototype.setAttribute = function setProfiledAttribute(name, value) {
    if (
      window.__freezeTrailViewBox &&
      name === "viewBox" &&
      this.classList?.contains("trails-svg")
    ) {
      return;
    }
    if (window.__rippleFps && name === "r" && this instanceof SVGCircleElement) {
      const now = performance.now();
      const previous = lastRippleUpdate.get(this) ?? -Infinity;
      if (now - previous < 1000 / window.__rippleFps - 1) return;
      lastRippleUpdate.set(this, now);
    }
    return setAttribute.call(this, name, value);
  };
});
await page.goto(url);
await page.waitForSelector("svg.trails-svg", { state: "attached", timeout: 30_000 });
await page.waitForTimeout(2500);
const pageSession = await page.context().newCDPSession(page);
await pageSession.send("Performance.enable");
const results = [];

for (let repeat = 0; repeat < repeats; repeat++) {
  for (const experiment of modes.filter((mode) => mode !== "current")) {
    const pairId = `${repeat}-${experiment}`;
    for (const [position, mode] of ["current", experiment, "current"].entries()) {
    const layer = await page.evaluate((selectedMode) => {
      const svg = document.querySelector("svg.trails-svg");
      const pathLayer = [...svg.children]
        .sort((a, b) => b.querySelectorAll("path").length - a.querySelectorAll("path").length)[0];
      const pathLayerIndex = [...svg.children].indexOf(pathLayer);
      window.__freezeTrailViewBox = selectedMode === "freeze-camera";
      window.__rippleFps = selectedMode === "ripple-30fps" ? 30 : 0;
      svg.style.isolation = selectedMode === "isolate-svg" ? "isolate" : "";
      for (const [index, child] of [...svg.children].entries()) {
        child.style.visibility = "visible";
        if (selectedMode === "hide-paths" && child === pathLayer) {
          child.style.visibility = "hidden";
        }
        if (selectedMode === "hide-cursors" && index > pathLayerIndex) {
          child.style.visibility = "hidden";
        }
        if (selectedMode === "hide-ripples" && index < pathLayerIndex) {
          child.style.visibility = "hidden";
        }
      }
      for (const circle of [...svg.children]
        .slice(0, pathLayerIndex)
        .flatMap((child) => [...child.querySelectorAll("circle")])) {
        circle.style.mixBlendMode =
          selectedMode === "normal-ripple-blend" ? "normal" : "multiply";
      }
      svg.style.display = selectedMode === "hide-svg" ? "none" : "";
      return {
        paths: svg.querySelectorAll("path").length,
        pathLayerPaths: pathLayer.querySelectorAll("path").length,
        cursorPaths: [...svg.children]
          .slice(pathLayerIndex + 1)
          .reduce((total, child) => total + child.querySelectorAll("path").length, 0),
        ripplePaths: [...svg.children]
          .slice(0, pathLayerIndex)
          .reduce((total, child) => total + child.querySelectorAll("path").length, 0),
        rippleCircles: [...svg.children]
          .slice(0, pathLayerIndex)
          .reduce((total, child) => total + child.querySelectorAll("circle").length, 0),
        filteredPaths: svg.querySelectorAll("path[filter]").length,
        viewBox: svg.getAttribute("viewBox"),
      };
    }, mode);
    await page.waitForTimeout(250);
    const beforeMetrics = metricsByName(await pageSession.send("Performance.getMetrics"));
    const beforeProcesses = await browserSession.send("SystemInfo.getProcessInfo");
    const measurement = await page.evaluate(async (sampleDurationMs) => {
      const svg = document.querySelector("svg.trails-svg");
      const mutations = { d: 0, opacity: 0, transform: 0, viewBox: 0 };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName in mutations) mutations[record.attributeName]++;
        }
      });
      observer.observe(svg, { subtree: true, attributes: true });
      const frameTimes = [];
      let previous = 0;
      const startedAt = performance.now();
      while (performance.now() - startedAt < sampleDurationMs) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        if (previous) frameTimes.push(now - previous);
        previous = now;
      }
      observer.disconnect();
      const paths = [...svg.querySelectorAll("path")];
      return {
        wallMs: performance.now() - startedAt,
        frameCount: frameTimes.length + 1,
        p95FrameIntervalMs: frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)] ?? 0,
        mutations,
        visiblePaths: paths.filter((path) => getComputedStyle(path).display !== "none").length,
        pathDataCharacters: paths.reduce((total, path) => total + (path.getAttribute("d")?.length ?? 0), 0),
      };
    }, durationMs);
    const afterProcesses = await browserSession.send("SystemInfo.getProcessInfo");
    const afterMetrics = metricsByName(await pageSession.send("Performance.getMetrics"));
    const result = {
      mode,
      repeat,
      pairId,
      position,
      layer,
      measurement,
      processCpu: diffProcessCpu(beforeProcesses, afterProcesses),
      metrics: diffMetrics(beforeMetrics, afterMetrics),
    };
    results.push(result);
    console.log(JSON.stringify({
      mode,
      repeat,
      totalCpuMs: result.processCpu.totalCpuMs,
      rendererCpuMs: result.processCpu.byType.renderer ?? 0,
      gpuCpuMs: result.processCpu.byType.GPU ?? 0,
      paths: layer.paths,
    }));
    }
  }
}

const summaries = modes.map((mode) => {
  const items = results.filter((result) => result.mode === mode);
  return {
    mode,
    totalCpuMs: median(items, (item) => item.processCpu.totalCpuMs),
    rendererCpuMs: median(items, (item) => item.processCpu.byType.renderer ?? 0),
    gpuCpuMs: median(items, (item) => item.processCpu.byType.GPU ?? 0),
    taskDurationMs: median(items, (item) => item.metrics.TaskDuration * 1000),
    scriptDurationMs: median(items, (item) => item.metrics.ScriptDuration * 1000),
    framesPerSecond: median(
      items,
      (item) => (item.measurement.frameCount * 1000) / item.measurement.wallMs,
    ),
    paths: median(items, (item) => item.layer.paths),
    pathDataCharacters: median(items, (item) => item.measurement.pathDataCharacters),
    dMutations: median(items, (item) => item.measurement.mutations.d),
    viewBoxMutations: median(items, (item) => item.measurement.mutations.viewBox),
  };
});
const comparisons = modes
  .filter((mode) => mode !== "current")
  .map((mode) => {
    const deltas = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const pairId = `${repeat}-${mode}`;
      const pair = results.filter((result) => result.pairId === pairId);
      const current = pair.filter((result) => result.mode === "current");
      const experiment = pair.find((result) => result.mode === mode);
      const expectedCpuMs = current.reduce(
        (total, result) => total + result.processCpu.totalCpuMs / current.length,
        0,
      );
      const expectedPaths = current.reduce(
        (total, result) => total + result.layer.paths / current.length,
        0,
      );
      deltas.push({
        cpuDeltaMs: experiment.processCpu.totalCpuMs - expectedCpuMs,
        cpuDeltaPercent:
          ((experiment.processCpu.totalCpuMs - expectedCpuMs) / expectedCpuMs) * 100,
        pathCountDelta: experiment.layer.paths - expectedPaths,
      });
    }
    return {
      mode,
      cpuDeltaMs: median(deltas, (delta) => delta.cpuDeltaMs),
      cpuDeltaPercent: median(deltas, (delta) => delta.cpuDeltaPercent),
      pathCountDelta: median(deltas, (delta) => delta.pathCountDelta),
    };
  });
const environment = {
  chromeVersion: await browser.version(),
  gpuDevice: systemInfo.gpu.devices[0]?.deviceString ?? "unknown",
  gpuBackend: systemInfo.gpu.auxAttributes?.glImplementationParts ?? "unknown",
};
await writeFile(
  path.join(outputDirectory, "results.json"),
  JSON.stringify({ environment, url, durationMs, repeats, results, summaries, comparisons }, null, 2),
);
await browser.close();
