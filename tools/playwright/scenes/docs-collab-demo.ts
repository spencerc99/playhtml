// ABOUTME: Three simulated readers browsing the docs site — drifting, scrolling,
// ABOUTME: clicking copy buttons, and interacting with the live capability demos.

import { defineScene } from "../src/scene.js";
import type { Page } from "@playwright/test";

const DEFAULT_PORT = "4322";

function routes(port: string) {
  const base = `http://localhost:${port}`;
  return {
    capabilities: `${base}/docs/capabilities/`,
    gettingStarted: `${base}/docs/getting-started/`,
    concepts: `${base}/docs/concepts/`,
    home: `${base}/docs/`,
    presence: `${base}/docs/data/presence/`,
  };
}

// Click a copy button on one of the code blocks if one is in view.
// Returns true if a button was clicked.
async function clickNearestCopyButton(
  page: Page,
  sync: { smoothMove: (p: Page, x: number, y: number, o?: { duration?: number }) => Promise<void>; wait: (ms: number) => Promise<void> },
): Promise<boolean> {
  const viewport = page.viewportSize();
  if (!viewport) return false;

  const copyButtons = await page.$$("button.copy");
  for (const btn of copyButtons) {
    const box = await btn.boundingBox();
    if (!box) continue;
    if (box.y > 40 && box.y < viewport.height - 40 && box.width > 0) {
      await sync.smoothMove(page, box.x + box.width / 2, box.y + box.height / 2, {
        duration: 700,
      });
      await sync.wait(200);
      await btn.click();
      return true;
    }
  }
  return false;
}

// Random-ish drift around the current viewport area.
async function drift(
  page: Page,
  sync: { smoothMove: (p: Page, x: number, y: number, o?: { duration?: number }) => Promise<void>; wait: (ms: number) => Promise<void> },
  steps = 3,
) {
  const vp = page.viewportSize();
  if (!vp) return;
  for (let i = 0; i < steps; i++) {
    const x = 200 + Math.random() * (vp.width - 400);
    const y = 200 + Math.random() * (vp.height - 400);
    await sync.smoothMove(page, x, y, { duration: 600 + Math.random() * 500 });
    await sync.wait(200 + Math.random() * 400);
  }
}

async function scrollSome(page: Page, amount = 400) {
  await page.mouse.wheel(0, amount);
}

// Pick up a can-move element by its id and drag it to a random spot inside its
// dragBounds parent. Uses mouse.down/move/up with a smooth path so playhtml's
// pointer handlers see a real drag gesture.
async function dragCanMove(
  page: Page,
  id: string,
  sync: { smoothMove: (p: Page, x: number, y: number, o?: { duration?: number }) => Promise<void>; wait: (ms: number) => Promise<void> },
) {
  const el = await page.$(`#${id}`);
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Find the .dragBounds ancestor box so we stay inside it. Fall back to the
  // viewport with a safe margin.
  const bounds = await page.evaluate((elementId) => {
    const node = document.getElementById(elementId);
    let parent = node?.parentElement;
    while (parent && !parent.classList.contains("dragBounds")) {
      parent = parent.parentElement;
    }
    const rect = (parent ?? node)?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }, id);

  const vp = page.viewportSize();
  const boundsBox = bounds ?? { x: 80, y: 120, width: (vp?.width ?? 1200) - 160, height: 260 };

  const targetX = boundsBox.x + 40 + Math.random() * Math.max(40, boundsBox.width - 80 - box.width);
  const targetY = boundsBox.y + 20 + Math.random() * Math.max(20, boundsBox.height - 40 - box.height);

  await sync.smoothMove(page, startX, startY, { duration: 500 });
  await sync.wait(150);
  await page.mouse.down();
  await sync.smoothMove(page, targetX, targetY, { duration: 900 });
  await page.mouse.up();
  await sync.wait(350);
  return true;
}

export default defineScene({
  actors: 3,
  extension: false,
  url: "http://localhost:{port}/docs/capabilities/",
  camera: false, // recording not used — Spencer drives the host browser
  viewport: { width: 1280, height: 800 },

  async run({ pages, sync, port }) {
    const R = routes(port ?? DEFAULT_PORT);
    const [reader1, reader2, reader3] = pages;

    // Spread the actors across different pages so Spencer's host cursor
    // discovers them as they arrive / leave.
    console.log("Navigating actors to starting pages");
    await Promise.all([
      reader1.goto(R.capabilities, { waitUntil: "domcontentloaded" }),
      reader2.goto(R.gettingStarted, { waitUntil: "domcontentloaded" }),
      reader3.goto(R.home, { waitUntil: "domcontentloaded" }),
    ]);
    await sync.wait(2500);

    // Loop the choreography so Spencer has plenty of time to jump between
    // pages and find everyone.
    for (let loop = 0; loop < 8; loop++) {
      console.log(`\n--- Loop ${loop + 1} ---`);

      // Reader 1: browses capabilities, occasionally drags the hat or cat
      //           and copies a code block.
      // Reader 2: scrolls getting-started, clicks the toggle, copies a snippet.
      // Reader 3: drifts the home page, clicks the lamp.
      await sync.parallel(
        async () => {
          if (reader1.url().includes("/capabilities/")) {
            await drift(reader1, sync, 2);
            // Occasionally drag the hat or the cat (both are can-move elements
            // inside the MoveHatCatDemo near the top of the page).
            const target = Math.random() < 0.5 ? "hat" : "cat";
            await dragCanMove(reader1, target, sync);
            await drift(reader1, sync, 1);
            await clickNearestCopyButton(reader1, sync);
            await sync.wait(700);
            await scrollSome(reader1, 350);
            await drift(reader1, sync, 2);
          } else {
            await drift(reader1, sync, 3);
            await scrollSome(reader1, 400);
            await clickNearestCopyButton(reader1, sync);
            await sync.wait(700);
            await drift(reader1, sync, 2);
          }
        },
        async () => {
          await drift(reader2, sync, 2);
          await scrollSome(reader2, 350);
          await drift(reader2, sync, 2);

          // Click the on/off toggle if we can find it.
          const toggle = await reader2.$("#ph-docs-toggle-demo");
          const box = await toggle?.boundingBox();
          if (box) {
            await sync.smoothMove(
              reader2,
              box.x + box.width / 2,
              box.y + box.height / 2,
              { duration: 700 },
            );
            await sync.wait(200);
            await toggle!.click();
            await sync.wait(500);
          }

          await clickNearestCopyButton(reader2, sync);
          await sync.wait(700);
          await drift(reader2, sync, 2);
        },
        async () => {
          await drift(reader3, sync, 2);
          // Click the splash lamp
          const lamp = await reader3.$("#ph-splash-lamp");
          const box = await lamp?.boundingBox();
          if (box) {
            await sync.smoothMove(
              reader3,
              box.x + box.width / 2,
              box.y + box.height / 2,
              { duration: 900 },
            );
            await sync.wait(250);
            await lamp!.click();
            await sync.wait(600);
          }
          await drift(reader3, sync, 2);
          await scrollSome(reader3, 500);
          await drift(reader3, sync, 2);
        },
      );

      // Shuffle: every other loop, rotate actors to different pages so
      // Spencer sees people coming and going.
      if (loop % 2 === 1) {
        console.log("Rotating actors");
        const routeList = Object.values(R);
        const pick = () => routeList[Math.floor(Math.random() * routeList.length)];
        await Promise.all([
          reader1.goto(pick(), { waitUntil: "domcontentloaded" }),
          reader2.goto(pick(), { waitUntil: "domcontentloaded" }),
          reader3.goto(pick(), { waitUntil: "domcontentloaded" }),
        ]);
        await sync.wait(2000);
      }
    }

    console.log("\nScene complete — idling for 30s so Spencer can keep exploring");
    await sync.wait(30000);
  },
});
