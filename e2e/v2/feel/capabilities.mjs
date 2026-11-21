// ABOUTME: Compares how interactions feel on protocol version 1 and version 2 against one party server.
// ABOUTME: Run after `bun build-packages`: `FEEL_REPO=$PWD FEEL_PARTY=<party host> node e2e/v2/feel/capabilities.mjs`.

import path from "node:path";

const repo = process.env.FEEL_REPO;
const partyHost = process.env.FEEL_PARTY;
if (!repo || !partyHost) {
  // The library's own default is the production server, so the host is never
  // assumed here.
  throw new Error("FEEL_REPO and FEEL_PARTY must be set.");
}
const { chromium } = await import(
  path.join(repo, "node_modules/playwright/index.mjs")
);
const rounds = Number(process.env.FEEL_ROUNDS ?? 3);
const builtLibraryPath = path.join(
  repo,
  "packages/playhtml/dist/playhtml.browser.js",
);
const builtStylePath = path.join(repo, "packages/playhtml/dist/style.css");
const pageOrigin = "http://feel.test";

const fillerElements = Array.from(
  { length: 30 },
  (_, index) =>
    `<button id="filler-${index}" class="filler" can-move style="left:${20 + (index % 10) * 90}px;top:${520 + Math.floor(index / 10) * 50}px">piece ${index}</button>`,
).join("");

function pageHtml(mode, room) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${pageOrigin}/style.css" />
    <style>
      body { margin: 0; font: 16px sans-serif; height: 900px; }
      #movable { position: absolute; left: 60px; top: 60px; padding: 12px; }
      #spinner { position: absolute; left: 400px; top: 60px; width: 90px; height: 90px; background: #c4724e; }
      #grower { position: absolute; left: 700px; top: 60px; width: 60px; height: 60px; background: #4a9a8a; }
      #toggle { position: absolute; left: 60px; top: 220px; padding: 12px; }
      #toggle.clicked { background: #d4b85c; }
      #mirror { position: absolute; left: 300px; top: 220px; width: 400px; min-height: 40px; border: 1px solid #8a8279; }
      #guestbook { position: absolute; left: 60px; top: 320px; }
      .filler { position: absolute; }
    </style>
  </head>
  <body>
    <button id="movable" can-move>Drag me</button>
    <div id="spinner" can-spin></div>
    <div id="grower" can-grow></div>
    <button id="toggle" can-toggle>Toggle me</button>
    <div id="mirror" can-mirror contenteditable="true"></div>
    <section id="guestbook" can-play>
      <form id="guestbook-form"><input id="guestbook-input" /><button type="submit">Add</button></form>
      <ul id="guestbook-entries"></ul>
    </section>
    ${fillerElements}
    <script>
      const guestbook = document.getElementById("guestbook");
      const form = document.getElementById("guestbook-form");
      const input = document.getElementById("guestbook-input");
      const entries = document.getElementById("guestbook-entries");
      guestbook.defaultData = { entries: [] };
      guestbook.updateElement = ({ data }) => {
        entries.replaceChildren(
          ...data.entries.map((entry) => {
            const item = document.createElement("li");
            item.textContent = entry;
            return item;
          }),
        );
      };
      guestbook.onMount = ({ setData }) => {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const message = input.value.trim();
          if (!message) return;
          setData((draft) => { draft.entries.push(message); });
          input.value = "";
        });
      };
    </script>
    <script type="module">
      import { playhtml } from "${pageOrigin}/playhtml.js";
      playhtml.init({
        host: ${JSON.stringify(partyHost)},
        room: ${JSON.stringify(room)},
        ${mode === "v2" ? "v2: true," : ""}
      });
    </script>
  </body>
</html>`;
}

async function openPage(context, mode, room) {
  await context.route(`${pageOrigin}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/playhtml.js") {
      return route.fulfill({
        path: builtLibraryPath,
        contentType: "text/javascript",
      });
    }
    if (pathname === "/style.css") {
      return route.fulfill({ path: builtStylePath, contentType: "text/css" });
    }
    if (pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: pageHtml(mode, room),
      });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  const sockets = [];
  page.on("websocket", (socket) => {
    sockets.push(socket.url());
    if (process.env.FEEL_DEBUG) {
      console.log("WS", socket.url().slice(0, 110));
      socket.on("close", () => console.log("WS closed", socket.url().slice(0, 70)));
      socket.on("socketerror", (error) => console.log("WS error", error));
    }
  });
  if (process.env.FEEL_DEBUG) {
    page.on("console", (message) =>
      console.log(`[${message.type()}]`, message.text().slice(0, 300)),
    );
  }
  page.on("pageerror", (error) => {
    console.log(`PAGE ERROR in ${mode}: ${error.message}`);
  });
  await page.goto(`${pageOrigin}/`);
  if (process.env.FEEL_DEBUG) {
    await page.waitForTimeout(6000);
    console.log(
      "STATE",
      JSON.stringify(
        await page.evaluate(() => ({
          has: !!window.playhtml,
          loading: window.playhtml?.isLoading,
          els: document.querySelectorAll(".__playhtml-element").length,
        })),
      ),
    );
  }
  await page.waitForFunction(() => window.playhtml?.isLoading === false);
  const strays = sockets.filter((url) => !url.includes(partyHost));
  if (strays.length > 0) {
    throw new Error(`Page opened sockets outside ${partyHost}: ${strays}`);
  }
  const expectedPath = mode === "v2" ? "/parties/v2/" : "/parties/main/";
  if (!sockets.some((url) => url.includes(expectedPath))) {
    throw new Error(`Page in ${mode} never opened ${expectedPath}: ${sockets}`);
  }
  await page.waitForTimeout(1000);
  return page;
}

/** Start recording input times, DOM change times, and frame lengths. */
async function startRecording(page, selector) {
  await page.evaluate((watchedSelector) => {
    const wallClock = () => performance.timeOrigin + performance.now();
    const record = { inputs: [], changes: [], frames: [], running: true };
    window.__feel = record;
    const listeners = [];
    for (const type of ["mousemove", "click", "keydown", "submit"]) {
      const listener = () => record.inputs.push(wallClock());
      document.addEventListener(type, listener, { capture: true });
      listeners.push([type, listener]);
    }
    window.__feelListeners = listeners;
    const watched = document.querySelector(watchedSelector);
    const observer = new MutationObserver(() =>
      record.changes.push(wallClock()),
    );
    observer.observe(watched, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.__feelObserver = observer;
    let last = performance.now();
    const tick = (now) => {
      if (!record.running) return;
      record.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
}

async function stopRecording(page) {
  return page.evaluate(() => {
    const record = window.__feel;
    record.running = false;
    window.__feelObserver.disconnect();
    for (const [type, listener] of window.__feelListeners) {
      document.removeEventListener(type, listener, { capture: true });
    }
    return {
      inputs: record.inputs,
      changes: record.changes,
      frames: record.frames,
    };
  });
}

function percentile(values, fraction) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function drag(page, selector, dx, dy) {
  const box = await page.locator(selector).boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 90; step++) {
    await page.mouse.move(startX + step * dx, startY + step * dy);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

// Only the transform is shared; the rest of the style differs per visitor.
const readStyle = (selector) => (page) =>
  page.locator(selector).evaluate((element) => element.style.transform);

const scenarios = [
  {
    name: "move drag",
    selector: "#movable",
    act: (page) => drag(page, "#movable", 3, 2),
    read: readStyle("#movable"),
  },
  {
    name: "spin drag",
    selector: "#spinner",
    act: (page) => drag(page, "#spinner", 3, 0),
    read: readStyle("#spinner"),
  },
  {
    name: "grow clicks",
    selector: "#grower",
    act: async (page) => {
      for (let i = 0; i < 8; i++) {
        await page.locator("#grower").click();
        await page.waitForTimeout(150);
      }
    },
    read: readStyle("#grower"),
  },
  {
    name: "toggle clicks",
    selector: "#toggle",
    act: async (page) => {
      for (let i = 0; i < 12; i++) {
        await page.locator("#toggle").click();
        await page.waitForTimeout(150);
      }
    },
    read: (page) =>
      page.locator("#toggle").evaluate((element) => `class:${element.className}`),
  },
  {
    name: "toggle burst",
    selector: "#toggle",
    act: async (page) => {
      const box = await page.locator("#toggle").boundingBox();
      for (let i = 0; i < 21; i++) {
        await page.mouse.click(box.x + 10, box.y + 10);
        await page.waitForTimeout(20);
      }
    },
    read: (page) =>
      page.locator("#toggle").evaluate((element) => `class:${element.className}`),
  },
  {
    name: "typing",
    selector: "#mirror",
    act: async (page) => {
      await page.locator("#mirror").click();
      await page.keyboard.type("the quick brown fox jumps over", { delay: 40 });
    },
    read: (page) =>
      page.locator("#mirror").evaluate((element) => element.textContent ?? ""),
  },
  {
    name: "list adds",
    selector: "#guestbook-entries",
    act: async (page) => {
      for (let i = 0; i < 10; i++) {
        await page.locator("#guestbook-input").fill(`entry ${i}`);
        await page.locator("#guestbook-input").press("Enter");
        await page.waitForTimeout(150);
      }
    },
    read: (page) =>
      page
        .locator("#guestbook-entries")
        .evaluate((element) => element.textContent ?? ""),
  },
];

async function runScenario(scenario, actor, observer) {
  await Promise.all([
    startRecording(actor, scenario.selector),
    startRecording(observer, scenario.selector),
  ]);
  await scenario.act(actor);
  await actor.waitForTimeout(1500);
  const [local, remote] = await Promise.all([
    stopRecording(actor),
    stopRecording(observer),
  ]);
  const [actorState, observerState] = await Promise.all([
    scenario.read(actor),
    scenario.read(observer),
  ]);

  // How long each input waited for the next change the actor could see.
  const localWaits = local.inputs
    .map((input) => {
      const change = local.changes.find((time) => time >= input);
      return change === undefined ? Number.NaN : change - input;
    })
    .filter((wait) => !Number.isNaN(wait));
  const remoteGaps = remote.changes
    .slice(1)
    .map((time, index) => time - remote.changes[index]);
  const firstInput = local.inputs[0];
  const lastInput = local.inputs[local.inputs.length - 1];

  return {
    scenario: scenario.name,
    inputs: local.inputs.length,
    localChanges: local.changes.length,
    localWaits: localWaits.map(round),
    localMedian: round(percentile(localWaits, 0.5)),
    localP95: round(percentile(localWaits, 0.95)),
    localMax: round(Math.max(...localWaits)),
    frameP95: round(percentile(local.frames, 0.95)),
    frameMax: round(Math.max(...local.frames)),
    slowFrames: local.frames.filter((frame) => frame > 34).length,
    remoteChanges: remote.changes.length,
    remoteFirst: round(remote.changes[0] - firstInput),
    remoteGapMedian: round(percentile(remoteGaps, 0.5)),
    remoteGapP90: round(percentile(remoteGaps, 0.9)),
    remoteGapMax: round(Math.max(...remoteGaps)),
    remoteSettle: round(remote.changes[remote.changes.length - 1] - lastInput),
    converged: actorState === observerState && actorState !== "",
    actorState: actorState.slice(0, 80),
    observerState: observerState.slice(0, 80),
  };
}

async function runMode(mode, roundIndex) {
  const browser = await chromium.launch({ headless: true });
  const room = `feel-${mode}-${Date.now()}-${roundIndex}`;
  try {
    const actor = await openPage(await browser.newContext(), mode, room);
    const observer = await openPage(await browser.newContext(), mode, room);
    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario, actor, observer));
    }
    return results;
  } finally {
    await browser.close();
  }
}

const runs = { v1: [], v2: [] };
for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
  for (const mode of ["v1", "v2"]) {
    runs[mode].push(await runMode(mode, roundIndex));
  }
}

const numericKeys = [
  "inputs",
  "localChanges",
  "localMedian",
  "localP95",
  "localMax",
  "frameP95",
  "frameMax",
  "slowFrames",
  "remoteChanges",
  "remoteFirst",
  "remoteGapMedian",
  "remoteGapP90",
  "remoteGapMax",
  "remoteSettle",
];

console.log(`Party server: ${partyHost}. Rounds per version: ${rounds}.`);
console.log("Each number is the median across rounds. Times are milliseconds.\n");
for (const scenario of scenarios) {
  console.log(scenario.name);
  for (const mode of ["v1", "v2"]) {
    const results = runs[mode].map((run) =>
      run.find((result) => result.scenario === scenario.name),
    );
    const summary = numericKeys
      .map(
        (key) =>
          `${key}=${round(percentile(results.map((result) => result[key]), 0.5))}`,
      )
      .join(" ");
    const converged = results.filter((result) => result.converged).length;
    console.log(`  ${mode}: ${summary} converged=${converged}/${results.length}`);
    for (const result of results.filter((entry) => !entry.converged)) {
      console.log(
        `    not converged: actor=${JSON.stringify(result.actorState)} observer=${JSON.stringify(result.observerState)}`,
      );
    }
  }
}
console.log(`\nRAW ${JSON.stringify(runs)}`);
