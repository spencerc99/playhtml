// ABOUTME: Loads each public page from the built site and asserts no playhtml
// ABOUTME: errors, no uncaught exceptions, and no same-origin asset 404s.

import {
  test,
  expect,
  type Browser,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";

// Pages we ship and expect to load cleanly. Keep this list in sync with the
// vite build glob in vite.config.site.mts (any *.html under website/, excluding
// `test/`).
const PAGES: { path: string; skip?: string }[] = [
  { path: "/" },
  { path: "/candles" },
  { path: "/story" },
  { path: "/fridge" },
  { path: "/admin" },
  { path: "/experiments/" },
  { path: "/experiments/3/" },
  { path: "/experiments/4/" },
  { path: "/experiments/5/" },
  { path: "/experiments/6/" },
  { path: "/experiments/7/" },
  { path: "/experiments/8/" },
  { path: "/experiments/9/" },
  { path: "/experiments/one/" },
  { path: "/experiments/two/" },
  { path: "/events/gathering/" },
  { path: "/events/gray-area/" },
  { path: "/events/if-then/" },
  { path: "/events/walking-together/" },
  // The session experience (list links here with ?session=<id>). Smoke-test
  // the active session so a broken session page is caught.
  { path: "/events/walking-together/session.html?session=2026-06-06-byod" },
  { path: "/docs/" },
];

// Console messages matching any of these are surfaced as test failures. The
// list is the load-bearing part of this suite — additions here lock in
// previously-broken classes of regression.
const FATAL_CONSOLE_PATTERNS: RegExp[] = [
  // The April 2026 PR #102 regression — bare <PlayProvider> stopped calling
  // playhtml.init(), so withSharedState elements failed to register.
  /does not have proper info to initial a playhtml element/i,
  // Generic playhtml runtime errors. The library prefixes these consistently.
  /\[playhtml\]/i,
  /\[PLAYHTML\]/,
  // React's "uncaught error inside a render" path.
  /Uncaught .*Error/,
  // PlayProvider missing — would mean a page lost its provider entirely.
  /PlayProvider element missing/i,
];

// Console errors matching these are EXPECTED (network-dependent, third party,
// etc.) and should not fail the smoke test. Keep the list narrow — broad
// excludes hide regressions.
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  // PartyKit / yjs WebSocket attempts may fail in offline CI environments.
  // The library handles this gracefully (10s sync timeout) and pages still
  // render; we only care that the page itself doesn't error out.
  /Issue connecting to yjs/i,
  /WebSocket/i,
  /partykit/i,
  // Google Fonts and other third-party font CDNs can blip without affecting
  // page functionality.
  /fonts\.(googleapis|gstatic)\.com/i,
  // Favicon misses are noisy and irrelevant.
  /favicon/i,
];

function isFatal(text: string): boolean {
  if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return false;
  return FATAL_CONSOLE_PATTERNS.some((re) => re.test(text));
}

async function collectErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const sameOriginFailures: string[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isFatal(text)) consoleErrors.push(text);
  });

  page.on("pageerror", (err) => {
    pageErrors.push(`${err.name}: ${err.message}`);
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    // Only flag failures for assets served from our own origin. Cross-origin
    // network errors (partykit, fonts) are out of scope for a smoke test.
    if (!url.startsWith("http://localhost")) return;
    sameOriginFailures.push(`${req.failure()?.errorText ?? "failed"}: ${url}`);
  });

  page.on("response", (resp) => {
    const url = resp.url();
    if (!url.startsWith("http://localhost")) return;
    if (resp.status() >= 400) {
      sameOriginFailures.push(`${resp.status()}: ${url}`);
    }
  });

  return { consoleErrors, pageErrors, sameOriginFailures };
}

for (const { path, skip } of PAGES) {
  const runner = skip ? test.skip : test;
  runner(`smoke: ${path}${skip ? ` (skipped: ${skip})` : ""}`, async ({ page }) => {
    const errors = await collectErrors(page);

    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response, `no response for ${path}`).not.toBeNull();
    expect(response!.status(), `bad status for ${path}`).toBeLessThan(400);

    // Give playhtml a moment to register and any synchronous render errors to
    // surface. The library's 10s yjs sync timeout means we don't need to wait
    // for full sync — registration happens earlier.
    await page.waitForTimeout(2_000);

    // Page must have rendered *something*. Catches silent failures where a
    // React island throws and an error boundary leaves a blank document.
    const bodyText = (await page.locator("body").innerText()).trim();
    expect(bodyText.length, `${path} rendered an empty body`).toBeGreaterThan(0);

    // Title must be present. Catches HTML emit / template breakage.
    const title = await page.title();
    expect(title.length, `${path} has no <title>`).toBeGreaterThan(0);

    expect.soft(errors.pageErrors, `uncaught page errors on ${path}`).toEqual([]);
    expect
      .soft(errors.consoleErrors, `fatal console errors on ${path}`)
      .toEqual([]);
    expect
      .soft(errors.sameOriginFailures, `same-origin asset failures on ${path}`)
      .toEqual([]);

    // Surface the soft assertions if any tripped.
    if (
      errors.pageErrors.length ||
      errors.consoleErrors.length ||
      errors.sameOriginFailures.length
    ) {
      throw new Error(
        `Smoke check failed for ${path}:\n` +
          (errors.pageErrors.length
            ? `  page errors: ${errors.pageErrors.join(" | ")}\n`
            : "") +
          (errors.consoleErrors.length
            ? `  console: ${errors.consoleErrors.join(" | ")}\n`
            : "") +
          (errors.sameOriginFailures.length
            ? `  assets: ${errors.sameOriginFailures.join(" | ")}\n`
            : ""),
      );
    }
  });
}

async function openHomepageAwarenessClient(browser: Browser, room: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = await collectErrors(page);
  const host =
    process.env.PLAYHTML_AWARENESS_SMOKE_HOST ??
    "playhtml-staging.spencerc99.workers.dev";
  const params = new URLSearchParams({
    playhtmlHost: host,
    playhtmlRoom: room,
  });

  const response = await page.goto(`/?${params}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response, "homepage awareness smoke response").not.toBeNull();
  expect(response!.status()).toBeLessThan(400);

  const count = page.locator("#site-console-count[can-play]");
  await expect(count).toHaveCount(1);

  return { context, page, errors };
}

test("smoke: homepage element awareness syncs across two browser clients", async ({
  browser,
}) => {
  const room = `/smoke/homepage-awareness-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const clientA = await openHomepageAwarenessClient(browser, room);
  const clientB = await openHomepageAwarenessClient(browser, room);

  try {
    await expect
      .poll(async () => {
        return Number(
          await clientA.page.locator("#site-console-count-number").innerText(),
        );
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => {
        return Number(
          await clientB.page.locator("#site-console-count-number").innerText(),
        );
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);

    expect.soft(clientA.errors.pageErrors, "client A page errors").toEqual([]);
    expect.soft(clientB.errors.pageErrors, "client B page errors").toEqual([]);
    expect
      .soft(clientA.errors.consoleErrors, "client A console errors")
      .toEqual([]);
    expect
      .soft(clientB.errors.consoleErrors, "client B console errors")
      .toEqual([]);
    expect
      .soft(clientA.errors.sameOriginFailures, "client A asset failures")
      .toEqual([]);
    expect
      .soft(clientB.errors.sameOriginFailures, "client B asset failures")
      .toEqual([]);
  } finally {
    await clientA.context.close();
    await clientB.context.close();
  }
});
