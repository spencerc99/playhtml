// ABOUTME: Measures how dragging a word feels on the fridge page, on protocol version 1 and version 2.
// ABOUTME: Run: `FEEL_REPO=$PWD FEEL_SITE=http://localhost:5178 FEEL_PARTY=<party host> node e2e/v2/feel/fridge.mjs`, with `node e2e/v2/feel/party-proxy.mjs 1999 <party host>` running and rooms `localhost%3A5178-feelv1` and `-feelv2` seeded as version 1 copies of the fridge.

import path from "node:path";

const repo = process.env.FEEL_REPO;
const site = process.env.FEEL_SITE;
const partyHost = process.env.FEEL_PARTY;
if (!repo || !site || !partyHost) {
  throw new Error("FEEL_REPO, FEEL_SITE and FEEL_PARTY must be set.");
}
const { chromium } = await import(
  path.join(repo, "node_modules/playwright/index.mjs")
);
const rounds = Number(process.env.FEEL_ROUNDS ?? 3);
const urls = {
  v1: `${site}/fridge?wall=feelv1`,
  v2: `${site}/fridge?wall=feelv2&__pv2=${encodeURIComponent(partyHost)}`,
};
// Sockets a version is allowed to open, so a run can never reach production.
const allowedSockets = {
  v1: ["ws://localhost:1999/", "ws://localhost:5178/"],
  v2: [`wss://${partyHost}/`, "ws://localhost:5178/"],
};

function percentile(values, fraction) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}
const round = (value) => Math.round(value * 10) / 10;

async function openPage(browser, mode) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto(urls[mode]);
  await page.waitForFunction(() => window.playhtml?.isLoading === false);
  await page.waitForFunction(
    () => document.querySelectorAll(".fridgeWordHolder").length > 100,
  );
  await page.waitForTimeout(2500);
  const strays = sockets.filter(
    (url) => !allowedSockets[mode].some((prefix) => url.startsWith(prefix)),
  );
  if (strays.length > 0) throw new Error(`Unexpected sockets: ${strays}`);
  return page;
}

/** Finds a word that is on screen and not covered by anything else. */
async function findWord(page) {
  return page.evaluate(() => {
    for (const holder of document.querySelectorAll(".fridgeWordHolder")) {
      const word = holder.firstElementChild;
      if (!word) continue;
      const rect = word.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10) continue;
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      if (x < 100 || y < 150 || x > 800 || y > 450) continue;
      const top = document.elementFromPoint(x, y);
      if (!top || !holder.contains(top)) continue;
      return { id: holder.id, x, y };
    }
    return null;
  });
}

async function startRecording(page, id) {
  await page.evaluate((holderId) => {
    const wallClock = () => performance.timeOrigin + performance.now();
    const record = { inputs: [], changes: [], frames: [], running: true };
    window.__feel = record;
    window.__feelInput = () => record.inputs.push(wallClock());
    document.addEventListener("mousemove", window.__feelInput, {
      capture: true,
    });
    const holder = document.getElementById(holderId);
    window.__feelObserver = new MutationObserver(() =>
      record.changes.push(wallClock()),
    );
    window.__feelObserver.observe(holder, {
      attributes: true,
      attributeFilter: ["style"],
    });
    let last = performance.now();
    const tick = (now) => {
      if (!record.running) return;
      record.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
}

async function stopRecording(page, id) {
  return page.evaluate((holderId) => {
    const record = window.__feel;
    record.running = false;
    window.__feelObserver.disconnect();
    document.removeEventListener("mousemove", window.__feelInput, {
      capture: true,
    });
    return {
      inputs: record.inputs,
      changes: record.changes,
      frames: record.frames,
      transform: document.getElementById(holderId).style.transform,
    };
  }, id);
}

async function runMode(mode) {
  const browser = await chromium.launch({ headless: true });
  try {
    const actor = await openPage(browser, mode);
    const observer = await openPage(browser, mode);
    const word = await findWord(actor);
    if (!word) throw new Error("No visible word to drag.");
    await Promise.all([
      startRecording(actor, word.id),
      startRecording(observer, word.id),
    ]);
    await actor.mouse.move(word.x, word.y);
    await actor.mouse.down();
    const dragStart = Date.now();
    for (let step = 1; step <= 90; step++) {
      await actor.mouse.move(word.x + step * 3, word.y + step * 2);
      await actor.waitForTimeout(16);
    }
    const dragMs = Date.now() - dragStart;
    await actor.mouse.up();
    await actor.waitForTimeout(2000);
    const [local, remote] = await Promise.all([
      stopRecording(actor, word.id),
      stopRecording(observer, word.id),
    ]);
    const waits = local.inputs
      .map((input) => {
        const change = local.changes.find((time) => time >= input);
        return change === undefined ? Number.NaN : change - input;
      })
      .filter((wait) => !Number.isNaN(wait));
    const gaps = remote.changes
      .slice(1)
      .map((time, index) => time - remote.changes[index]);
    return {
      dragMs,
      inputs: local.inputs.length,
      localChanges: local.changes.length,
      localMedian: round(percentile(waits, 0.5)),
      localP95: round(percentile(waits, 0.95)),
      localMax: round(Math.max(...waits)),
      frameMedian: round(percentile(local.frames, 0.5)),
      frameP95: round(percentile(local.frames, 0.95)),
      frameMax: round(Math.max(...local.frames)),
      slowFrames: local.frames.filter((frame) => frame > 34).length,
      remoteChanges: remote.changes.length,
      remoteFirst: round(remote.changes[0] - local.inputs[0]),
      remoteGapMedian: round(percentile(gaps, 0.5)),
      remoteGapP90: round(percentile(gaps, 0.9)),
      remoteGapMax: round(Math.max(...gaps)),
      remoteSettle: round(
        remote.changes[remote.changes.length - 1] -
          local.inputs[local.inputs.length - 1],
      ),
      converged: local.transform === remote.transform && local.transform !== "",
    };
  } finally {
    await browser.close();
  }
}

const runs = { v1: [], v2: [] };
for (let index = 0; index < rounds; index++) {
  for (const mode of ["v1", "v2"]) {
    const result = await runMode(mode);
    runs[mode].push(result);
    console.log(mode, JSON.stringify(result));
  }
}
console.log("\nMedians across rounds:");
for (const mode of ["v1", "v2"]) {
  const keys = Object.keys(runs[mode][0]).filter((key) => key !== "converged");
  console.log(
    `  ${mode}: ` +
      keys
        .map(
          (key) =>
            `${key}=${round(percentile(runs[mode].map((run) => run[key]), 0.5))}`,
        )
        .join(" ") +
      ` converged=${runs[mode].filter((run) => run.converged).length}/${runs[mode].length}`,
  );
}
