// ABOUTME: Verifies React version 2 shared state across independent contexts.
// ABOUTME: Confirms draft increments preserve both concurrent counter clicks.

import { expect, test } from "@playwright/test";
import { withV2PagePair } from "./fixtures";

test("React counter preserves concurrent increments", async ({
  browser,
}, testInfo) => {
  await withV2PagePair(
    browser,
    testInfo,
    "/test/v2-react.html",
    async ({ pageA, pageB }) => {
      const counterA = pageA.locator("#react-v2-counter");
      const counterB = pageB.locator("#react-v2-counter");

      await Promise.all([counterA.click(), counterB.click()]);

      await expect(counterA).toHaveText("Shared count: 2");
      await expect(counterB).toHaveText("Shared count: 2");
    },
  );
});
