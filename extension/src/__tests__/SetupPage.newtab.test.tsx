// ABOUTME: Covers the new tab choice on the combined setup completion step.
// ABOUTME: Verifies the opt-out value is persisted only when setup finishes.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("../utils/extensionPage", () => ({
  isSafariExtensionPageUrl: vi.fn(() => false),
}));
vi.mock("../storage/playerIdentity", () => ({
  getPublicPlayerIdentity: vi.fn().mockResolvedValue(null),
}));
vi.mock("../storage/playerColor", () => ({
  savePlayerColor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../components/TrailsHero", () => ({ TrailsHero: () => <div /> }));
vi.mock("../components/MilestoneToastPreview", () => ({
  MilestoneToastPreview: () => <div />,
}));
vi.mock("../components/PortraitCard", () => ({ PortraitCard: () => <div /> }));
vi.mock("@movement/config", () => ({ WORKER_URL: "https://example.com" }));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.mocked(browser.storage.local.set).mockReset();
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  vi.mocked(browser.tabs.getCurrent).mockResolvedValue({
    id: 1,
  } as browser.Tabs.Tab);
  vi.mocked(browser.tabs.remove).mockResolvedValue(undefined);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function renderCompletionStep() {
  const { default: SetupPage } = await import("../components/SetupPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Get started")
      ?.click();
  });
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });
  return { container, root };
}

async function finish(container: HTMLElement) {
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Finish setup")
      ?.click();
    await Promise.resolve();
  });
}

it("offers the new tab opt-in checkbox on the done step off Safari", async () => {
  const { container, root } = await renderCompletionStep();
  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );

  expect(container.textContent).toContain("All set!");
  expect(container.textContent).toContain("Review your browsing");
  expect(container.textContent).toContain("make this my new tab");
  expect(checkbox?.checked).toBe(true);
  expect(browser.storage.local.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ newtab_takeover_enabled: true }),
  );

  await finish(container);
  expect(browser.storage.local.set).toHaveBeenCalledWith(
    expect.objectContaining({ newtab_takeover_enabled: true }),
  );

  act(() => root.unmount());
  container.remove();
});

it("records declining the new tab takeover on Finish", async () => {
  const { container, root } = await renderCompletionStep();
  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  await act(async () => checkbox?.click());

  await finish(container);
  expect(browser.storage.local.set).toHaveBeenCalledWith(
    expect.objectContaining({ newtab_takeover_enabled: false }),
  );

  act(() => root.unmount());
  container.remove();
});
