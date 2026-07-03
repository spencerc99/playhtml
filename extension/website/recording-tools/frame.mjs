// ABOUTME: Grabs a single PNG frame of the archive viz via Playwright, at any size.
// ABOUTME: For quickly eyeballing a composition / tuning before committing to a full recording.

// Usage:
//   bun frame.mjs --url <URL> --out <PNG> [--width 1600] [--height 1000] [--wait 14] [--settings <json>]

import { chromium } from "playwright";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("url");
const out = arg("out");
if (!url || !out) {
  console.error("frame.mjs: --url and --out are required.");
  process.exit(1);
}
const width = Number(arg("width", 1600));
const height = Number(arg("height", 1000));
const waitSec = Number(arg("wait", 14));
const settingsJson = arg("settings");
const executablePath =
  arg("chrome") ||
  process.env.PW_CHROME ||
  "/Users/spencerchang/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const browser = await chromium.launch({
  executablePath,
  args: ["--force-color-profile=srgb"],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
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
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitSec * 1000);
await page.screenshot({ path: out });
console.log("frame written:", out);
await context.close();
await browser.close();
