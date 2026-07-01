// ABOUTME: Headless video capture of the wewere.online archive viz via Playwright.
// ABOUTME: Records a .webm at any resolution; supports cinematic N-swaps, speed ramps, and settings injection.

// Usage:
//   bun capture.mjs --url <URL> --out <DIR> [options]
//
// Options:
//   --url <url>            Page URL to record (required). Settings ride in the ?s= blob.
//   --out <dir>            Output directory for the .webm (required).
//   --seconds <n>          Record duration in seconds (default 50).
//   --width <px>           Viewport width (default 1920).
//   --height <px>          Viewport height (default 1080).
//   --swap-every <sec>     Press "N" every N seconds to swap the cinematic subject (default 0 = never).
//   --slow <n> --fast <n>  Speed ramp: play at <slow> animationSpeed, then bump to <fast>.
//   --ramp-at <sec>        When to bump from slow→fast (default 2). Requires --slow and --fast.
//   --settings <json>      JSON object merged into localStorage "internet-movement-settings-v2"
//                          before load — for scroll/window settings that aren't URL-settable.
//   --chrome <path>        Chromium executable (default: the pinned ms-playwright build below).
//   --wait <sec>           Settle time before recording the action (default 5).
//
// Why a fixed settle instead of waiting for trail paths: typing/scrolling-only
// scenes have no trail paths, so we wait a fixed time rather than for a selector.
//
// Tip: 4K (3840x2160) can drop frames on filter-heavy scenes (the windows viz).
// Record at 1920x1080 and upscale in encoding — see encode.sh.

import { chromium } from "playwright";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("url");
const outDir = arg("out");
if (!url || !outDir) {
  console.error("capture.mjs: --url and --out are required. See header for usage.");
  process.exit(1);
}

const seconds = Number(arg("seconds", 50));
const width = Number(arg("width", 1920));
const height = Number(arg("height", 1080));
const swapEvery = Number(arg("swap-every", 0));
const slow = arg("slow") ? Number(arg("slow")) : null;
const fast = arg("fast") ? Number(arg("fast")) : null;
const rampAt = Number(arg("ramp-at", 2));
const settingsJson = arg("settings");
const waitSec = Number(arg("wait", 5));
const executablePath =
  arg("chrome") ||
  process.env.PW_CHROME ||
  "/Users/spencerchang/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const browser = await chromium.launch({
  executablePath,
  // sRGB so recorded colors match the page; no color-management surprises.
  args: ["--force-color-profile=srgb"],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width, height } },
});
const page = await context.newPage();

// Inject scroll/window settings that aren't URL-settable (they normally ride in
// the ?s= blob). Merge onto whatever the app would default to.
if (settingsJson) {
  const overrides = JSON.parse(settingsJson);
  await page.addInitScript((ov) => {
    try {
      const KEY = "internet-movement-settings-v2";
      const cur = JSON.parse(localStorage.getItem(KEY) || "{}");
      localStorage.setItem(KEY, JSON.stringify({ ...cur, ...ov }));
    } catch {
      /* ignore */
    }
  }, overrides);
}

// First load warms the page: fetches event data, loads fonts, lets the viz
// initialize. Then we RELOAD so the timed recording window starts on a blank
// canvas and captures the draw-on from frame zero (data is cached, so the
// redraw begins immediately). Trim `waitSec` in encoding to drop the warm-up
// and land the clip's first frame on the blank-page reload.
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitSec * 1000);
await page.reload({ waitUntil: "domcontentloaded" });

if (slow !== null && fast !== null) {
  // Speed ramp: slow, readable opening, then accelerate. Smooth because the
  // animation loop accumulates elapsed time (no teleport on speed change).
  await page.evaluate((s) => window.__setAnimationSpeed?.(s), slow);
  await page.waitForTimeout(rampAt * 1000);
  await page.evaluate((s) => window.__setAnimationSpeed?.(s), fast);
  await page.waitForTimeout((seconds - rampAt) * 1000);
} else if (swapEvery > 0) {
  // Cinematic: press N to swap to a new (moving) subject through the clip.
  const swaps = Math.floor(seconds / swapEvery);
  for (let i = 0; i < swaps; i++) {
    await page.waitForTimeout(swapEvery * 1000);
    await page.keyboard.press("n");
  }
  await page.waitForTimeout(Math.max(0, seconds - swaps * swapEvery) * 1000);
} else {
  await page.waitForTimeout(seconds * 1000);
}

await context.close();
await browser.close();
console.log("done");
