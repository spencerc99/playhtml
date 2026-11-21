// ABOUTME: Verifies which page controls the built extension saves as button scraps, and what they keep.
// ABOUTME: Loads a local page of real-world button patterns, then reads stored scraps and the scraps page.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension =
  process.env.SCRAP_BUTTONS_EXTENSION ||
  resolve(workspace, "extension/dist/chrome-mv3");
const evidence = process.env.SCRAP_EVIDENCE_DIR || "/tmp/scrap-button-evidence";
// Set to "report" to print what was saved without asserting, for a before run.
const mode = process.env.SCRAP_BUTTONS_MODE || "assert";
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "wwo-scrap-buttons-"));

const arrow =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const download =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const cross =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const heart =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.2 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.7 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>';

// Each case is one control a real page might tag as a button. `keep` says
// whether it reads as a button with everything it shows carried.
const cases = [
  {
    label: "Sign up",
    keep: true,
    html: `<button class="solid">Sign up</button>`,
  },
  {
    label: "Download",
    keep: true,
    html: `<button class="solid green">${download}Download</button>`,
  },
  {
    label: "Continue",
    keep: true,
    html: `<button class="outline">Continue${arrow}</button>`,
  },
  {
    label: "Subscribe",
    keep: true,
    html: `<button class="unset"><span class="pill">Subscribe</span></button>`,
  },
  {
    label: "Get started",
    keep: true,
    html: `<button class="gradient">Get started</button>`,
  },
  {
    label: "Lifted",
    keep: true,
    html: `<button class="lifted">Lifted</button>`,
  },
  {
    label: "",
    keep: true,
    icon: "heart",
    html: `<button class="round" aria-label="Like">${heart}</button>`,
  },
  {
    label: "Read more",
    keep: false,
    html: `<button class="tailwind-ghost">Read more</button>`,
  },
  {
    label: "White on white",
    keep: false,
    html: `<button class="same-as-page">White on white</button>`,
  },
  {
    label: "Overview",
    keep: false,
    html: `<button class="tab">Overview</button>`,
  },
  {
    label: "",
    keep: false,
    icon: "cross",
    html: `<button class="bare" aria-label="Close">${cross}</button>`,
  },
  {
    label: "Search",
    keep: false,
    html: `<button class="solid"><span class="material">search</span>Search</button>`,
  },
  {
    label: "Like",
    keep: false,
    html: `<button class="solid"><i class="fa-heart"></i>Like</button>`,
  },
  {
    label: "Share",
    keep: false,
    html: `<button class="solid"><img src="/share.svg" width="16" height="16" alt="">Share</button>`,
  },
  {
    label: "willhess17 4 years ago",
    keep: false,
    html: `<div role="button" tabindex="0" class="prose">willhess17 4 years ago</div>`,
  },
];

const shareIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="4" cy="8" r="2.5" fill="#fff"/><circle cx="12" cy="4" r="2.5" fill="#fff"/><circle cx="12" cy="12" r="2.5" fill="#fff"/></svg>';

const page = `<!doctype html><meta charset="utf-8"><title>Button garden</title>
<style>
  body { margin: 40px; background: #fff; font: 16px system-ui, sans-serif; color: #222; }
  .grid { display: grid; grid-template-columns: repeat(3, 260px); gap: 28px 24px; }
  .cell { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .cell small { color: #888; font-size: 12px; }
  button { font: 600 15px system-ui, sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
  .solid { background: #2952e3; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; }
  .green { background: #1f7a4d; border-radius: 999px; }
  .outline { background: transparent; color: #2952e3; border: 2px solid #2952e3; border-radius: 6px; padding: 8px 14px; gap: 6px; }
  .unset { all: unset; cursor: pointer; }
  .pill { display: inline-block; background: #ffcf3f; color: #3b2500; font: 700 14px Georgia, serif; padding: 9px 20px; border-radius: 20px; letter-spacing: 0.04em; text-transform: uppercase; }
  .gradient { background: linear-gradient(135deg, #ff7a59, #c13584); color: #fff; border: 0; border-radius: 12px; padding: 11px 22px; }
  .lifted { background: transparent; border: 0; color: #222; padding: 10px 18px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
  .round { background: #ffe1e6; color: #e0245e; border: 0; width: 44px; height: 44px; border-radius: 50%; justify-content: center; padding: 0; }
  .tailwind-ghost { background: transparent; border: 0; color: #2952e3; padding: 8px 0;
    box-shadow: 0 0 #0000, 0 0 #0000, 0 0 #0000; }
  .same-as-page { background: #fff; border: 0; color: #444; padding: 8px 12px; }
  .tab { background: transparent; border: 0; border-bottom: 2px solid #222; color: #222; padding: 8px 4px; border-radius: 0; }
  .bare { background: transparent; border: 0; color: #555; width: 40px; height: 40px; justify-content: center; padding: 0; }
  .material { font-family: "Material Icons", "Material Symbols Outlined"; font-weight: 400; font-size: 18px; }
  .fa-heart::before { content: "\\f004"; font-family: "Font Awesome 6 Free"; }
  .prose { color: #606060; font-size: 13px; width: 220px; }
</style>
<h1>Button garden</h1>
<div class="grid">
${cases
  .map(
    (entry) =>
      `<div class="cell">${entry.html}<small>${entry.keep ? "keep" : "skip"}: ${entry.label || entry.icon}</small></div>`,
  )
  .join("\n")}
</div>`;

const server = createServer((request, response) => {
  if (request.url === "/share.svg") {
    response.setHeader("content-type", "image/svg+xml");
    response.end(shareIcon);
    return;
  }
  if (request.url === "/favicon.ico") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
  headless: true,
  reducedMotion: "reduce",
  viewport: { width: 1200, height: 850 },
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--disable-background-networking",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  ],
});
const pageErrors = [];
context.on("page", (tab) =>
  tab.on("pageerror", (error) => pageErrors.push(error.message)),
);
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return url.protocol === "chrome-extension:" || url.hostname === "127.0.0.1"
    ? route.continue()
    : route.abort("blockedbyclient");
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const worker =
  context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;

async function buttonScraps() {
  return worker.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const r = indexedDB.open("collection_events_db");
      r.onsuccess = () => resolveDb(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolveRows, reject) => {
        const r = db
          .transaction("events")
          .objectStore("events")
          .index("type")
          .getAll("element");
        r.onsuccess = () =>
          resolveRows(
            r.result
              .filter((event) => event.data.kind === "button")
              .map((event) => event.data),
          );
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}

try {
  await worker.evaluate(async () =>
    chrome.storage.local.set({
      wwoFeatureAccess: {
        features: { SCRAPS: { stage: "beta", available: true } },
        checkedAt: Date.now(),
      },
      collection_mode_cursor: "off",
      collection_mode_navigation: "off",
      collection_mode_viewport: "off",
      collection_mode_keyboard: "off",
    }),
  );
  const garden = await context.newPage();
  await garden.goto(origin);
  await garden.screenshot({
    path: resolve(evidence, "0-page.png"),
    clip: { x: 0, y: 0, width: 900, height: 560 },
  });
  // Give the visibility timers time to fire and the buffer time to flush.
  await garden.waitForTimeout(6000);
  const saved = await buttonScraps();
  const summary = saved.map((data) => ({
    text: data.text,
    icon: Boolean(data.innerSvg),
    trailingIcon: Boolean(data.trailingSvg),
    background: data.styles.backgroundColor,
    gap: data.styles.columnGap,
  }));
  console.log(JSON.stringify(summary, null, 2));
  await writeFile(
    resolve(evidence, "saved.json"),
    JSON.stringify(saved, null, 2),
  );

  if (mode === "assert") {
    // innerText applies the page's text-transform, as the scrap is shown.
    const savedTexts = saved.map((data) => data.text.toLowerCase()).sort();
    const expected = cases
      .filter((entry) => entry.keep)
      .map((entry) => entry.label.toLowerCase())
      .sort();
    assert.deepEqual(savedTexts, expected, "only real buttons are saved");
    const byText = Object.fromEntries(
      saved.map((data) => [
        data.text === "SUBSCRIBE" ? "Subscribe" : data.text,
        data,
      ]),
    );
    assert.ok(byText.Download.innerSvg, "a leading icon is kept");
    assert.equal(byText.Download.trailingSvg, undefined);
    assert.ok(byText.Continue.trailingSvg, "a trailing icon stays trailing");
    assert.equal(byText.Continue.innerSvg, undefined);
    assert.equal(
      byText.Continue.styles.columnGap,
      "6px",
      "the page's gap is kept",
    );
    assert.equal(
      byText.Subscribe.styles.backgroundColor,
      "rgb(255, 207, 63)",
      "a face painted by the button's child is captured from that child",
    );
    assert.equal(byText.Subscribe.styles.textTransform, "uppercase");
    assert.ok(byText[""].innerSvg, "an icon-only button with a face is kept");
    assert.match(
      byText.Download.innerSvg,
      /width="[\d.]+em"/,
      "icons size with the text",
    );
  }

  const scraps = await context.newPage();
  await scraps.setViewportSize({ width: 1200, height: 900 });
  await scraps.goto(`${extensionOrigin}/scraps.html`);
  await scraps.getByRole("button", { name: "archive", exact: true }).click();
  await expect(scraps.locator(".scrap-collage__tile").first()).toBeVisible();
  await scraps.waitForTimeout(1500);
  await scraps.screenshot({
    path: resolve(evidence, "1-scraps-archive.png"),
    clip: { x: 0, y: 70, width: 1200, height: 200 },
  });
  const continueTile = scraps
    .locator(".scrap-collage__tile")
    .filter({ hasText: "Continue" });
  if ((await continueTile.count()) > 0) {
    await continueTile.first().click();
    await expect(scraps.locator(".scrap-lightbox")).toHaveCSS("opacity", "1");
    await scraps.waitForTimeout(500);
    await scraps.screenshot({ path: resolve(evidence, "2-lightbox.png") });
  }
  assert.deepEqual(pageErrors, [], "no page errors");
  console.log(`evidence in ${evidence}`);
} finally {
  await context.close();
  server.close();
}
