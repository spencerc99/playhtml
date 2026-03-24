// ABOUTME: Launches browser contexts, runs a scene, records video.
// ABOUTME: CLI entry point: bun src/runner.ts --scene <name> [--no-video] [--headed]

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import type { SceneConfig } from "./scene.js";

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
    headed: has("--headed"),
  };
}

async function createSyncHelpers() {
  return {
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),

    parallel: async (...fns: (() => Promise<void>)[]) => {
      await Promise.all(fns.map((fn) => fn()));
    },

    smoothMove: async (
      page: import("@playwright/test").Page,
      targetX: number,
      targetY: number,
      opts?: { steps?: number; duration?: number },
    ) => {
      const duration = opts?.duration ?? 500;
      const steps = opts?.steps ?? Math.max(15, Math.round(duration / 16));
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
  bun tools/playwright/src/runner.ts --scene <name> [--no-video] [--headed]

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
  const actorCount = scene.actors ?? 2;
  const viewport = scene.viewport ?? { width: 1280, height: 720 };
  const recordActor = scene.recordActor ?? 0;
  const videoDir = scene.videoDir ?? VIDEO_DIR;
  const extensionPath = scene.extensionPath ?? EXTENSION_PATH;

  const useCamera = scene.camera ?? false;

  console.log(`Scene: ${args.scene}`);
  console.log(`Actors: ${actorCount}${useCamera ? " + camera" : ""}`);
  console.log(`Extension: ${scene.extension ? extensionPath : "none"}`);
  console.log(`URL: ${scene.url}`);
  console.log();

  // Ensure video directory exists
  if (!args.noVideo) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  // Helper to launch a browser context with optional extension and video
  async function launchActor(label: string, record: boolean) {
    const userDataDir = `/tmp/playwright-${label}-${Date.now()}`;
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
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: launchArgs,
      ignoreDefaultArgs: scene.extension
        ? ["--disable-extensions", "--disable-component-extensions-with-background-pages", "--enable-automation"]
        : [],
      viewport,
      ...(record ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.evaluate(() => {
      (window as any).__playwrightMousePos = { x: 0, y: 0 };
      document.addEventListener("mousemove", (e) => {
        (window as any).__playwrightMousePos = { x: e.clientX, y: e.clientY };
      });
    });
    return { context, page };
  }

  // Launch actor contexts
  const contexts: import("@playwright/test").BrowserContext[] = [];
  const pages: import("@playwright/test").Page[] = [];

  const recordFromActor = !useCamera && !args.noVideo;
  for (let i = 0; i < actorCount; i++) {
    const shouldRecord = recordFromActor && i === 0;
    const { context, page } = await launchActor(`actor-${i}`, shouldRecord);
    contexts.push(context);
    pages.push(page);
  }

  // Launch camera context (records video, sees all remote cursors)
  let cameraContext: import("@playwright/test").BrowserContext | null = null;
  let cameraPage: import("@playwright/test").Page | null = null;
  if (useCamera && !args.noVideo) {
    console.log("Launching camera...");
    const cam = await launchActor("camera", true);
    cameraContext = cam.context;
    cameraPage = cam.page;
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
  const sync = await createSyncHelpers();

  try {
    await scene.run({ pages, contexts, sync, camera: cameraPage ?? undefined });
  } catch (err) {
    console.error("Scene error:", err);
  }

  console.log("\nScene complete.");

  // Save video from camera or actor 0
  if (!args.noVideo) {
    const recordPage = cameraPage ?? (recordFromActor ? pages[0] : null);
    if (!recordPage) { console.log("No video to save"); process.exit(0); }
    await recordPage.close();
    const video = recordPage.video();
    if (video) {
      const videoPath = await video.path();
      const outputPath = path.join(videoDir, `${args.scene}-${Date.now()}.webm`);
      fs.renameSync(videoPath, outputPath);
      console.log(`Video saved: ${outputPath}`);
    }
  }

  // Cleanup
  for (const context of contexts) {
    await context.close();
  }
  if (cameraContext) {
    await cameraContext.close();
  }
}

run().catch(console.error);
