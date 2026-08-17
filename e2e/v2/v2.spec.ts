// ABOUTME: Verifies version 2 synchronization across independent browser contexts.
// ABOUTME: Covers built-in capabilities, concurrent array inserts, persistence, and replay.

import { expect, test, type Page } from "@playwright/test";
import {
  getGuestbookEntries,
  waitForV2Ready,
  withV2PagePair,
} from "./fixtures";

const pagePath = "/test/v2.html";

async function submitGuestbookEntry(
  page: Page,
  message: string,
): Promise<void> {
  const input = page.locator("#guestbook-input");
  await input.fill(message);
  await page.locator('#guestbook-form button[type="submit"]').click();
}

test("move synchronizes the dragged position", async ({ browser }, testInfo) => {
  await withV2PagePair(browser, testInfo, pagePath, async ({ pageA, pageB }) => {
    const movableA = pageA.locator("#movable");
    const movableB = pageB.locator("#movable");
    const before = await movableA.evaluate(
      (element) => (element as HTMLElement).style.transform,
    );
    const box = await movableA.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await pageA.mouse.move(startX, startY);
    await pageA.mouse.down();
    await pageA.mouse.move(startX + 80, startY + 40, { steps: 8 });
    await pageA.mouse.up();

    await expect
      .poll(
        () =>
          movableA.evaluate(
            (element) => (element as HTMLElement).style.transform,
          ),
      )
      .not.toBe(before);
    const moved = await movableA.evaluate(
      (element) => (element as HTMLElement).style.transform,
    );
    await expect
      .poll(
        () =>
          movableB.evaluate(
            (element) => (element as HTMLElement).style.transform,
          ),
      )
      .toBe(moved);
  });
});

test("toggle synchronizes in both directions", async ({ browser }, testInfo) => {
  await withV2PagePair(browser, testInfo, pagePath, async ({ pageA, pageB }) => {
    const toggleA = pageA.locator("#toggle");
    const toggleB = pageB.locator("#toggle");

    await toggleA.click();
    await expect(toggleB).toHaveClass(/toggled/);

    await toggleB.click();
    await expect(toggleA).not.toHaveClass(/toggled/);
  });
});

test("guestbook concurrent appends survive in one server order", async ({
  browser,
}, testInfo) => {
  await withV2PagePair(browser, testInfo, pagePath, async ({ pageA, pageB }) => {
    const messages = ["from-context-a", "from-context-b"];
    await Promise.all([
      submitGuestbookEntry(pageA, messages[0]),
      submitGuestbookEntry(pageB, messages[1]),
    ]);

    await expect.poll(() => getGuestbookEntries(pageA)).toHaveLength(2);
    const orderedEntries = await getGuestbookEntries(pageA);
    expect(orderedEntries).toHaveLength(2);
    expect(orderedEntries).toEqual(expect.arrayContaining(messages));
    await expect
      .poll(() => getGuestbookEntries(pageB))
      .toEqual(orderedEntries);
  });
});

test("reload restores persisted guestbook state", async ({ browser }, testInfo) => {
  await withV2PagePair(browser, testInfo, pagePath, async ({ pageA, pageB }) => {
    await submitGuestbookEntry(pageA, "survives-reload");
    await expect
      .poll(() => getGuestbookEntries(pageB))
      .toEqual(["survives-reload"]);

    await pageA.reload();
    await waitForV2Ready(pageA);
    await expect
      .poll(() => getGuestbookEntries(pageA))
      .toEqual(["survives-reload"]);
  });
});

test("disconnect replay delivers an offline write after reconnect", async ({
  browser,
}, testInfo) => {
  await withV2PagePair(browser, testInfo, pagePath, async ({
    contextA,
    pageA,
    pageB,
  }) => {
    await contextA.setOffline(true);
    await submitGuestbookEntry(pageA, "replayed-after-disconnect");
    await expect
      .poll(() => getGuestbookEntries(pageA))
      .toEqual(["replayed-after-disconnect"]);

    await contextA.setOffline(false);
    await expect
      .poll(() => getGuestbookEntries(pageB), { timeout: 20_000 })
      .toEqual(["replayed-after-disconnect"]);
  });
});
