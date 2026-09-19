// ABOUTME: Verifies the time-spent summary matches the domain rows it renders.
// ABOUTME: Covers newly visited domains whose measured screen time is still zero.

import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("../../components/ExtensionPageNav", () => ({
  ExtensionPageNav: () => null,
}));
vi.mock("../../styles/options.scss", () => ({}));
vi.mock("./stats.scss", () => ({}));

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    success: true,
    domains: [
      {
        domain: "one.example",
        eventCount: 4,
        firstVisit: 1,
        lastVisit: Date.now(),
        totalTimeMs: 30_000,
        uniquePageCount: 1,
        eventCounts: {},
      },
      {
        domain: "two.example",
        eventCount: 3,
        firstVisit: 1,
        lastVisit: Date.now(),
        totalTimeMs: 20_000,
        uniquePageCount: 1,
        eventCounts: {},
      },
      {
        domain: "three.example",
        eventCount: 2,
        firstVisit: 1,
        lastVisit: Date.now(),
        totalTimeMs: 10_000,
        uniquePageCount: 1,
        eventCounts: {},
      },
      {
        domain: "new.example",
        eventCount: 1,
        firstVisit: 1,
        lastVisit: Date.now(),
        totalTimeMs: 0,
        uniquePageCount: 1,
        eventCounts: {},
      },
    ],
  });
});

it("counts zero-second domains shown in the list", async () => {
  await act(async () => {
    await import("./stats");
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(document.querySelectorAll(".domain-row")).toHaveLength(4);
  expect(document.querySelector(".stats-page__subtitle")?.textContent).toBe(
    "1m tracked across 4 domains",
  );
});
