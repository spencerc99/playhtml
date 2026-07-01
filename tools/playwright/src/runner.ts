// ABOUTME: Launches browser contexts, runs a scene, records video.
// ABOUTME: CLI entry point: bun src/runner.ts --scene <name> [--no-video] [--headless]

import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import path from "path";
import fs from "fs";
import { installErrorCollector } from "./errors.js";
import { createPersonas } from "./personas.js";
import {
  chooseBrowserLaunchMode,
  chooseRecordedActor,
  smoothMoveSteps,
} from "./runtime.js";
import type { SceneConfig, SceneRuntimeOptions } from "./scene.js";
import {
  computeTrimWindow,
  ffmpegIsAvailable,
  trimVideo,
} from "./video.js";

const EXTENSION_PATH = path.resolve(
  import.meta.dir,
  "../../../extension/dist/chrome-mv3",
);
const VIDEO_DIR = path.resolve(import.meta.dir, "../videos");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  return {
    scene: get("--scene"),
    noVideo: has("--no-video"),
    headless: has("--headless"),
    headed: has("--headed"),
    port: get("--port"),
    actors: get("--actors"),
    duration: get("--duration"),
    seed: get("--seed"),
    baseUrl: get("--base-url"),
    hostUrl: get("--host-url"),
  };
}

function parsePositiveInteger(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function defaultBaseUrl(port: string | undefined) {
  return port ? `http://localhost:${port}` : undefined;
}

async function createSyncHelpers(recording: { markStart: () => void }) {
  return {
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),

    parallel: async (...fns: (() => Promise<void>)[]) => {
      await Promise.all(fns.map((fn) => fn()));
    },

    markRecordingStart: recording.markStart,

    smoothMove: async (
      page: import("@playwright/test").Page,
      targetX: number,
      targetY: number,
      opts?: { steps?: number; duration?: number },
    ) => {
      const duration = opts?.duration ?? 500;
      const steps = opts?.steps ?? smoothMoveSteps(duration);
      const stepDelay = duration / steps;

      const currentPos = await page.evaluate(() => {
        return (window as any).__playwrightMousePos ?? { x: 0, y: 0 };
      });

      // Generate a slight perpendicular wobble for organic feel
      const dx = targetX - currentPos.x;
      const dy = targetY - currentPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Perpendicular direction for wobble
      const perpX = dist > 0 ? -dy / dist : 0;
      const perpY = dist > 0 ? dx / dist : 0;
      // Wobble amplitude: subtle, proportional to distance
      const wobbleAmp = Math.min(8, dist * 0.03);

      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        // Ease in-out cubic
        const eased =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // Wobble: sine wave along the perpendicular axis, fades at endpoints
        const wobbleFade = Math.sin(progress * Math.PI); // 0 at start/end, 1 at middle
        const wobble = Math.sin(progress * Math.PI * 2.5) * wobbleAmp * wobbleFade;

        const x = currentPos.x + (targetX - currentPos.x) * eased + perpX * wobble;
        const y = currentPos.y + (targetY - currentPos.y) * eased + perpY * wobble;
        await page.mouse.move(x, y);
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      }

      await page.evaluate(
        ({ x, y }: { x: number; y: number }) => {
          (window as any).__playwrightMousePos = { x, y };
        },
        { x: targetX, y: targetY },
      );
    },
  };
}

async function run() {
  const args = parseArgs();

  if (!args.scene) {
    console.log(`
Usage:
  bun tools/playwright/src/runner.ts --scene <name> [--no-video] [--headless]

Scenes are defined in tools/playwright/scenes/<name>.ts
    `);
    process.exit(1);
  }

  // Load scene
  const scenePath = path.resolve(import.meta.dir, `../scenes/${args.scene}.ts`);
  if (!fs.existsSync(scenePath)) {
    console.error(`Scene not found: ${scenePath}`);
    console.log(
      "Available scenes:",
      fs
        .readdirSync(path.resolve(import.meta.dir, "../scenes"))
        .filter((f: string) => f.endsWith(".ts"))
        .map((f: string) => f.replace(".ts", ""))
        .join(", "),
    );
    process.exit(1);
  }

  const sceneModule = await import(scenePath);
  const scene: SceneConfig = sceneModule.default;

  // Apply --port: substitute {port} in the scene URL and expose on scene.port.
  if (args.port) {
    scene.port = args.port;
  }
  // Always resolve {port} so the initial page.goto() doesn't hit a literal
  // placeholder. Scenes that care about the raw port read ctx.port.
  if (scene.url.includes("{port}")) {
    scene.url = scene.url.replace(/\{port\}/g, scene.port ?? "4321");
  }

  const actorCount = parsePositiveInteger(args.actors, "--actors") ?? scene.actors ?? 2;
  const durationMs =
    parsePositiveInteger(args.duration, "--duration") ?? scene.durationMs ?? 120_000;
  const seed = args.seed ?? `${args.scene}-${Date.now()}`;
  const baseUrl = args.baseUrl ?? scene.baseUrl ?? defaultBaseUrl(args.port);
  const hostUrl = args.hostUrl ?? scene.hostUrl;
  const personas = createPersonas(actorCount, seed);
  const options: SceneRuntimeOptions = {
    durationMs,
    seed,
    ...(baseUrl ? { baseUrl } : {}),
    ...(hostUrl ? { hostUrl } : {}),
  };
  const viewport = scene.viewport ?? { width: 1280, height: 720 };
  const recordActor = scene.recordActor ?? 0;
  const selectedRecordActor = chooseRecordedActor(actorCount, recordActor);
  const videoDir = scene.videoDir ?? VIDEO_DIR;
  const extensionPath = scene.extensionPath ?? EXTENSION_PATH;
  const runHeadless = args.headless && !args.headed;
  const browserLaunchMode = chooseBrowserLaunchMode(scene);

  const useCamera = scene.camera ?? false;

  console.log(`Scene: ${args.scene}`);
  console.log(`Actors: ${actorCount}${useCamera ? " + camera" : ""}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Seed: ${seed}`);
  if (baseUrl) console.log(`Base URL: ${baseUrl}`);
  if (hostUrl) console.log(`Open in your browser: ${hostUrl}`);
  console.log(`Extension: ${scene.extension ? extensionPath : "none"}`);
  console.log(`Browser mode: ${runHeadless ? "headless" : "headed"}`);
  console.log(`Actor browser process mode: ${browserLaunchMode}`);
  console.log(`URL: ${scene.url}`);
  console.log();

  // Ensure video directory exists
  if (!args.noVideo) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    `--window-size=${viewport.width},${viewport.height}`,
  ];
  if (scene.extension) {
    launchArgs.push(
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    );
  }

  let sharedBrowser: Browser | null = null;
  if (browserLaunchMode === "shared") {
    sharedBrowser = await chromium.launch({
      headless: runHeadless,
      args: launchArgs,
    });
  }

  let videoStartedAtMs: number | undefined;
  let recordingStartedAtMs: number | undefined;
  const markRecordingStart = () => {
    if (recordingStartedAtMs !== undefined) return;
    recordingStartedAtMs = Date.now();
    console.log("Recording action window started.");
  };

  // Helper to launch a browser context with optional extension and video
  async function launchActor(label: string, record: boolean) {
    const videoOptions = record ? { recordVideo: { dir: videoDir, size: viewport } } : {};
    if (record && videoStartedAtMs === undefined) {
      videoStartedAtMs = Date.now();
    }

    let context: BrowserContext;
    if (sharedBrowser) {
      context = await sharedBrowser.newContext({
        viewport,
        ...videoOptions,
      });
    } else {
      const userDataDir = `/tmp/playwright-${label}-${Date.now()}`;
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: runHeadless,
        args: launchArgs,
        ignoreDefaultArgs: scene.extension
          ? ["--disable-extensions", "--disable-component-extensions-with-background-pages", "--enable-automation"]
          : [],
        viewport,
        ...videoOptions,
      });
    }

    const page = context.pages()[0] ?? (await context.newPage());
    if (!page.viewportSize()) {
      await page.setViewportSize(viewport);
    }
    await page.evaluate(() => {
      (window as any).__playwrightMousePos = { x: 0, y: 0 };
      document.addEventListener("mousemove", (e) => {
        (window as any).__playwrightMousePos = { x: e.clientX, y: e.clientY };
      });
    });
    return { context, page };
  }

  // Launch actor contexts
  const contexts: BrowserContext[] = [];
  const pages: import("@playwright/test").Page[] = [];
  const errorCollectors: ReturnType<typeof installErrorCollector>[] = [];

  const recordFromActor = !useCamera && !args.noVideo;
  for (let i = 0; i < actorCount; i++) {
    const shouldRecord = recordFromActor && i === selectedRecordActor;
    const { context, page } = await launchActor(`actor-${i}`, shouldRecord);
    contexts.push(context);
    pages.push(page);
    errorCollectors.push(installErrorCollector(page, `Actor ${i}`));
  }

  // Launch camera context (records video, sees all remote cursors)
  let cameraContext: BrowserContext | null = null;
  let cameraPage: import("@playwright/test").Page | null = null;
  if (useCamera && !args.noVideo) {
    console.log("Launching camera...");
    const cam = await launchActor("camera", true);
    cameraContext = cam.context;
    cameraPage = cam.page;
    errorCollectors.push(installErrorCollector(cameraPage, "Camera"));
  }

  // Navigate all actors + camera to the starting URL
  console.log("Navigating all actors...");
  const allPages = [...pages, ...(cameraPage ? [cameraPage] : [])];
  await Promise.all(allPages.map((page) => page.goto(scene.url, { waitUntil: "domcontentloaded" })));

  // Wait for pages to settle (extension to load, etc.)
  console.log("Waiting for pages to settle...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Verify extension is loaded if expected
  if (scene.extension) {
    for (let i = 0; i < pages.length; i++) {
      const hasPlayhtml = await pages[i].evaluate(() => "playhtml" in window);
      const hasCursors = await pages[i].evaluate(() => "cursors" in window);
      const extensionEls = await pages[i].evaluate(() =>
        document.querySelectorAll("[class*='playhtml']").length
      );
      // Check if content script injected
      const contentScriptLoaded = await pages[i].evaluate(() =>
        document.querySelectorAll("style[id*='playhtml']").length
      );
      console.log(`  Actor ${i}: playhtml=${hasPlayhtml}, cursors=${hasCursors}, extensionEls=${extensionEls}, contentScript=${contentScriptLoaded}`);
    }

    // Check for extension pages (setup page opens on first install)
    const allContexts = [...contexts, ...(cameraContext ? [cameraContext] : [])];
    for (let i = 0; i < allContexts.length; i++) {
      const label = i < contexts.length ? `Actor ${i}` : "Camera";
      const ctxPages = allContexts[i].pages();
      console.log(`  ${label}: ${ctxPages.length} pages: ${ctxPages.map(p => p.url()).join(", ")}`);

      // If setup page opened, click through the wizard
      for (const p of ctxPages) {
        if (p.url().includes("options.html") || p.url().includes("setup.html")) {
          console.log(`  Completing setup on ${label}...`);
          // Step 1: "Get started"
          const getStarted = await p.$(".setup-step__btn-primary");
          if (getStarted) {
            await getStarted.click();
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          // Step 2: "Let's go" (applies consent + saves identity)
          const letsGo = await p.$(".setup-step__btn-primary");
          if (letsGo) {
            await letsGo.click();
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          // Close the setup tab
          await p.close();
        }
      }
    }

    // Capture console output to diagnose extension issues
    for (let i = 0; i < pages.length; i++) {
      pages[i].on("console", (msg) => {
        const text = msg.text();
        if (text.includes("playhtml") || text.includes("PLAYHTML") || text.includes("LinkGlow") || text.includes("Follow") || text.includes("Wiki") || text.includes("Error") || text.includes("error") || text.includes("boot")) {
          console.log(`  [Actor ${i}] ${msg.type()}: ${text}`);
        }
      });
    }

    // Reload all pages (actors + camera) after setup completion
    console.log("Reloading pages after setup...");
    const pagesToReload = [...pages, ...(cameraPage ? [cameraPage] : [])];
    await Promise.all(pagesToReload.map((page) => page.reload({ waitUntil: "domcontentloaded" })));
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Wait longer for async init to complete
    console.log("Waiting for extension init...");
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // Re-check
    for (let i = 0; i < pages.length; i++) {
      const hasPlayhtml = await pages[i].evaluate(() => "playhtml" in window);
      const hasCursors = await pages[i].evaluate(() => "cursors" in window);
      const consoleErrors = await pages[i].evaluate(() => {
        // Check for any extension-related errors
        return (window as any).__extensionErrors ?? "none";
      });
      console.log(`  Actor ${i} (after init): playhtml=${hasPlayhtml}, cursors=${hasCursors}`);
    }
  }

  // Run the choreography
  console.log("Running scene...\n");
  const sync = await createSyncHelpers({ markStart: markRecordingStart });

  // Close browser contexts cleanly on SIGINT so WebSockets get their close
  // handshake — avoids "Network connection lost" noise on the server.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, closing browsers...`);
    const allContexts = [...contexts, ...(cameraContext ? [cameraContext] : [])];
    await Promise.allSettled(allContexts.map((c) => c.close()));
    if (sharedBrowser) await sharedBrowser.close();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  let sceneError: unknown;
  try {
    await scene.run({
      pages,
      contexts,
      sync,
      camera: cameraPage ?? undefined,
      port: scene.port,
      personas,
      options,
    });
  } catch (err) {
    console.error("Scene error:", err);
    sceneError = err;
  }

  for (const collector of errorCollectors) {
    try {
      collector.assertClean();
    } catch (err) {
      sceneError ??= err;
      console.error(err);
    }
  }

  console.log("\nScene complete.");

  // Save video from camera or selected actor
  if (!args.noVideo) {
    const recordPage = cameraPage ?? (recordFromActor ? pages[selectedRecordActor] : null);
    if (!recordPage) { console.log("No video to save"); process.exit(0); }
    await recordPage.close();
    const video = recordPage.video();
    if (video) {
      const videoPath = await video.path();
      const timestamp = Date.now();
      const rawOutputPath = path.join(videoDir, `${args.scene}-${timestamp}-raw.webm`);
      fs.renameSync(videoPath, rawOutputPath);

      const trimWindow =
        videoStartedAtMs === undefined
          ? null
          : computeTrimWindow({
              videoStartedAtMs,
              recordingStartedAtMs,
              sceneDurationMs: durationMs,
            });

      if (trimWindow && ffmpegIsAvailable()) {
        const outputPath = path.join(videoDir, `${args.scene}-${timestamp}.mp4`);
        trimVideo({
          inputPath: rawOutputPath,
          outputPath,
          ...trimWindow,
        });
        console.log(`Raw video saved: ${rawOutputPath}`);
        console.log(
          `Video saved: ${outputPath} (${trimWindow.durationSeconds.toFixed(
            1,
          )}s action window)`,
        );
      } else {
        if (trimWindow) {
          console.warn("ffmpeg unavailable; saved untrimmed Playwright video.");
        }
        console.log(`Video saved: ${rawOutputPath}`);
      }
    }
  }

  // Cleanup
  for (const context of contexts) {
    await context.close();
  }
  if (cameraContext) {
    await cameraContext.close();
  }
  if (sharedBrowser) {
    await sharedBrowser.close();
  }

  if (sceneError) {
    throw sceneError;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
