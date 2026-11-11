// ABOUTME: Runs simulated visitors on the local filming copy: headless browsers whose cursors
// ABOUTME: wander and play with the homepage toys, so a screen recording shows a busy room.

import { chromium, type Browser, type Page } from "playwright";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "4" },
    url: {
      type: "string",
      default: "http://localhost:5199/?playhtmlHost=localhost:1998",
    },
    // Seconds to run; 0 runs until Ctrl+C.
    duration: { type: "string", default: "0" },
    // How busy each person is: lower waits longer between moves.
    pace: { type: "string", default: "1" },
    // Comma-separated element ids people may play with (default: all toys in view).
    only: { type: "string" },
    // Let people scroll around the page instead of staying at the top.
    roam: { type: "boolean", default: false },
    // Include the hydrant, which makes it rain on everyone's screen.
    rain: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    width: { type: "string", default: "1440" },
    height: { type: "string", default: "900" },
  },
});

const count = Number(values.count);
const pace = Math.max(0.1, Number(values.pace));
const only = values.only
  ?.split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const viewport = { width: Number(values.width), height: Number(values.height) };

type Toy = {
  selector: string;
  kind: "click" | "drag" | "spin";
  weight: number;
};

const TOYS: Toy[] = [
  { selector: "#lamp-hanging", kind: "click", weight: 3 },
  { selector: "#sign", kind: "drag", weight: 3 },
  { selector: "#stamp", kind: "spin", weight: 3 },
  { selector: "#plant", kind: "click", weight: 2 },
  { selector: "#orb-1", kind: "click", weight: 2 },
  { selector: "#orb-2", kind: "click", weight: 2 },
  { selector: "#orb-3", kind: "click", weight: 2 },
  ...(values.rain
    ? [
        {
          selector: "#rain-sprinkler .fire-hydrant",
          kind: "click",
          weight: 0.5,
        } as Toy,
      ]
    : []),
].filter(
  (toy) => !only || only.includes(toy.selector.replace(/^#/, "").split(" ")[0]),
);

const random = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / pace));
let stopping = false;

type Point = { x: number; y: number };

// Moves along a gently curved path with ease-in-out, like a hand on a trackpad.
async function glide(page: Page, from: Point, to: Point, speed = 1) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(8, Math.round(distance / (14 * speed)));
  const bend = random(-0.25, 0.25) * distance;
  const nx = -(to.y - from.y) / (distance || 1);
  const ny = (to.x - from.x) / (distance || 1);
  const control = {
    x: (from.x + to.x) / 2 + nx * bend,
    y: (from.y + to.y) / 2 + ny * bend,
  };
  for (let i = 1; i <= steps; i++) {
    const linear = i / steps;
    const t =
      linear < 0.5 ? 2 * linear * linear : 1 - (-2 * linear + 2) ** 2 / 2;
    const x =
      (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x;
    const y =
      (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y;
    await page.mouse.move(x, y);
    await new Promise((r) => setTimeout(r, 16));
  }
  return to;
}

async function visibleBox(page: Page, selector: string) {
  const box = await page
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  if (!box) return null;
  const inView =
    box.y + box.height / 2 > 0 &&
    box.y + box.height / 2 < viewport.height &&
    box.x + box.width / 2 > 0 &&
    box.x + box.width / 2 < viewport.width;
  return inView ? box : null;
}

function pickToy(): Toy | null {
  const total = TOYS.reduce((sum, toy) => sum + toy.weight, 0);
  let roll = Math.random() * total;
  for (const toy of TOYS) {
    roll -= toy.weight;
    if (roll <= 0) return toy;
  }
  return null;
}

async function play(page: Page, at: Point): Promise<Point> {
  const toy = pickToy();
  if (!toy) return at;
  const box = await visibleBox(page, toy.selector);
  if (!box) return at;
  const center = {
    x: box.x + box.width / 2 + random(-0.2, 0.2) * box.width,
    y: box.y + box.height / 2 + random(-0.2, 0.2) * box.height,
  };
  at = await glide(page, at, center);
  await sleep(random(150, 500));

  if (toy.kind === "click") {
    const clicks = toy.selector.startsWith("#orb")
      ? Math.ceil(random(1, 5))
      : 1;
    for (let i = 0; i < clicks; i++) {
      await page.mouse.click(center.x, center.y);
      await sleep(random(120, 300));
    }
    return at;
  }

  await page.mouse.down();
  const end =
    toy.kind === "spin"
      ? { x: center.x + random(-160, 160), y: center.y + random(-10, 10) }
      : { x: center.x + random(-180, 180), y: center.y + random(-70, 70) };
  at = await glide(page, center, end, 0.5);
  await page.mouse.up();
  return at;
}

async function wander(page: Page, at: Point): Promise<Point> {
  const margin = 40;
  const to = {
    x: Math.min(
      viewport.width - margin,
      Math.max(margin, at.x + random(-500, 500)),
    ),
    y: Math.min(
      viewport.height - margin,
      Math.max(margin, at.y + random(-300, 300)),
    ),
  };
  return glide(page, at, to, random(0.6, 1.4));
}

async function runPerson(browser: Browser, index: number) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(values.url!, { waitUntil: "load" });
  await page.waitForTimeout(1500 + index * 700);

  let at: Point = {
    x: random(100, viewport.width - 100),
    y: random(100, viewport.height - 100),
  };
  await page.mouse.move(at.x, at.y);
  console.log(`person ${index + 1} joined`);

  while (!stopping) {
    const roll = Math.random();
    try {
      if (roll < 0.55) at = await wander(page, at);
      else if (roll < 0.85) at = await play(page, at);
      else if (values.roam && roll < 0.92) {
        await page.mouse.wheel(0, random(-600, 900));
      } else await sleep(random(600, 2000)); // idle: cursor rests
    } catch (error) {
      if (!stopping)
        console.warn(`person ${index + 1}:`, (error as Error).message);
    }
    await sleep(random(200, 1200));
  }
  await context.close();
}

let browser: Browser;
try {
  browser = await chromium.launch({
    headless: !values.headed,
    executablePath: process.env.FILMING_CHROMIUM_PATH || undefined,
  });
} catch (error) {
  console.error((error as Error).message.split("\n")[0]);
  console.error(
    "Install the browser once with: bunx playwright install chromium",
  );
  process.exit(1);
}
console.log(`Starting ${count} simulated people on ${values.url}`);
const people = Array.from({ length: count }, (_, i) => runPerson(browser, i));

const stop = async () => {
  if (stopping) return;
  stopping = true;
  console.log("Stopping...");
  await Promise.allSettled(people);
  await browser.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (Number(values.duration) > 0)
  setTimeout(stop, Number(values.duration) * 1000);
await Promise.allSettled(people);
