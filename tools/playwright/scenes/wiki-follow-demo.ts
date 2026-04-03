// ABOUTME: Demo scene: two cursors meet on Wikipedia, one follows the other to a new article.
// ABOUTME: Records from alice's perspective with a visible local cursor.

import { defineScene } from "../src/scene.js";

function cursorSVG(fill: string): string {
  return `<svg height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none">
    <g fill="none" fill-rule="evenodd" transform="translate(10 7)">
      <path d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z" fill="#fff"/>
      <path d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z" fill="${fill}"/>
    </g>
  </svg>`;
}

async function setupLocalCursor(page: import("@playwright/test").Page, color: string) {
  await page.evaluate((svg) => {
    const style = document.createElement("style");
    style.textContent = `
      * { cursor: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      html { scrollbar-width: none !important; }
    `;
    document.head.appendChild(style);
    document.getElementById("__playwright-cursor")?.remove();
    const cursor = document.createElement("div");
    cursor.id = "__playwright-cursor";
    Object.assign(cursor.style, {
      position: "fixed",
      width: "32px",
      height: "32px",
      pointerEvents: "none",
      zIndex: "2147483647",
      left: "-100px",
      top: "-100px",
    });
    cursor.innerHTML = svg;
    document.body.appendChild(cursor);
    document.addEventListener("mousemove", (e) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
    });
  }, cursorSVG(color));
}

export default defineScene({
  actors: 2,
  extension: true,
  url: "https://en.wikipedia.org/wiki/Wikipedia",
  camera: false,
  viewport: { width: 1024, height: 768 },

  async run({ pages, sync }) {
    const [alice, bob] = pages;

    await setupLocalCursor(alice, "#c4724e");

    // --- Act 1: Cursors enter from different edges ---
    console.log("Act 1: Cursors enter");

    // Alice enters from the left, Bob from the bottom-right
    await sync.parallel(
      () => sync.smoothMove(alice, 320, 350, { duration: 1200 }),
      () => sync.smoothMove(bob, 750, 450, { duration: 1400 }),
    );

    // Both read — small natural movements, no long pauses
    await sync.parallel(
      async () => {
        await sync.smoothMove(alice, 360, 370, { duration: 600 });
        await sync.smoothMove(alice, 400, 355, { duration: 500 });
        await sync.smoothMove(alice, 430, 380, { duration: 700 });
      },
      async () => {
        await sync.smoothMove(bob, 720, 430, { duration: 500 });
        await sync.smoothMove(bob, 690, 410, { duration: 600 });
        await sync.smoothMove(bob, 660, 390, { duration: 700 });
      },
    );

    // --- Act 2: Drift together ---
    console.log("Act 2: Drift together");

    await sync.parallel(
      async () => {
        await sync.smoothMove(alice, 480, 370, { duration: 900 });
        await sync.smoothMove(alice, 520, 365, { duration: 600 });
      },
      async () => {
        await sync.smoothMove(bob, 610, 375, { duration: 800 });
        await sync.smoothMove(bob, 575, 368, { duration: 500 });
      },
    );

    // Close enough for proximity
    await sync.wait(1500);

    // --- Act 3: Alice follows ---
    console.log("Act 3: Follow");

    await alice.keyboard.press("f");
    await sync.wait(1500);

    // --- Act 4: Bob reads and scrolls, alice tethers ---
    console.log("Act 4: Reading together");

    await sync.smoothMove(bob, 550, 420, { duration: 600 });
    await bob.mouse.wheel(0, 300);
    await sync.smoothMove(bob, 500, 380, { duration: 500 });
    await sync.smoothMove(bob, 530, 400, { duration: 400 });
    await bob.mouse.wheel(0, 250);
    await sync.smoothMove(bob, 480, 370, { duration: 600 });

    // --- Act 5: Bob finds and clicks the Writing system link ---
    console.log("Act 5: Navigate to Writing system");

    // Scroll to find the link
    await bob.mouse.wheel(0, 200);
    await sync.wait(300);

    // Try to find the "Writing system" or similar link
    const linkSelector = '#mw-content-text .mw-parser-output a[href="/wiki/Writing_system"]';
    let link = await bob.$(linkSelector);

    if (!link) {
      // Fallback to any visible wiki link
      const allLinks = await bob.$$('#mw-content-text .mw-parser-output a[href^="/wiki/"]:not([href*=":"])');
      for (const l of allLinks.slice(3, 15)) {
        const box = await l.boundingBox();
        if (box && box.y > 150 && box.y < 550 && box.x > 200) {
          link = l;
          break;
        }
      }
    }

    if (link) {
      const box = await link.boundingBox();
      if (box) {
        await sync.smoothMove(bob, box.x + box.width / 2, box.y + box.height / 2, { duration: 800 });
        await sync.wait(300);
        await link.click();
        console.log("Bob clicked link");
      }
    }

    // Wait for countdown + navigation
    await sync.wait(6000);

    // --- Act 6: New page — cursors appear from center ---
    console.log("Act 6: New page");

    // Re-setup alice's cursor
    await setupLocalCursor(alice, "#c4724e");

    // Bob moves first so his cursor is visible when alice arrives
    await sync.smoothMove(bob, 500, 380, { duration: 400 });
    await sync.smoothMove(bob, 550, 400, { duration: 500 });

    // Alice appears from center
    await sync.smoothMove(alice, 450, 370, { duration: 400 });

    // Both explore the new page together
    await sync.parallel(
      async () => {
        await sync.smoothMove(alice, 420, 350, { duration: 500 });
        await sync.smoothMove(alice, 460, 380, { duration: 600 });
        await sync.smoothMove(alice, 500, 360, { duration: 500 });
      },
      async () => {
        await sync.smoothMove(bob, 580, 420, { duration: 600 });
        await sync.smoothMove(bob, 540, 390, { duration: 500 });
        await sync.smoothMove(bob, 600, 370, { duration: 700 });
      },
    );

    await sync.wait(1500);
    console.log("Scene complete");
  },
});
