// ABOUTME: Creates independent browser-context pairs for version 2 tests.
// ABOUTME: Gives each pair a unique query-derived room and configured PartyKit host.

import { randomUUID } from "node:crypto";
import type {
  Browser,
  BrowserContext,
  Page,
  TestInfo,
} from "@playwright/test";

const partyHost = process.env.PLAYHTML_E2E_PARTY ?? "localhost:2000";

export type V2PagePair = {
  contextA: BrowserContext;
  contextB: BrowserContext;
  pageA: Page;
  pageB: Page;
};

export async function waitForV2Ready(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const playhtml = (
      window as Window & { playhtml?: { isLoading: boolean } }
    ).playhtml;
    return playhtml?.isLoading === false;
  });
}

export async function getGuestbookEntries(page: Page): Promise<string[]> {
  return page.locator("#guestbook-entries li").allTextContents();
}

export async function withV2PagePair(
  browser: Browser,
  testInfo: TestInfo,
  path: string,
  callback: (pair: V2PagePair) => Promise<void>,
): Promise<void> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const room = `e2e-${testInfo.testId}-${randomUUID()}`;
  const query = new URLSearchParams({
    party: partyHost,
    room,
  }).toString();
  const url = `${path}?${query}`;

  try {
    await Promise.all([pageA.goto(url), pageB.goto(url)]);
    await Promise.all([waitForV2Ready(pageA), waitForV2Ready(pageB)]);
    await callback({ contextA, contextB, pageA, pageB });
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
}
