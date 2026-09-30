// ABOUTME: Covers Safari's all-website permission step in extension setup.
// ABOUTME: Verifies the native permission request follows an explicit user click.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("../utils/extensionPage", () => ({
  isSafariExtensionPageUrl: vi.fn(() => true),
}));
vi.mock("../storage/playerIdentity", () => ({
  getPublicPlayerIdentity: vi.fn().mockResolvedValue(null),
}));
vi.mock("../storage/playerColor", () => ({
  savePlayerColor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../components/TrailsHero", () => ({
  TrailsHero: () => <div />,
}));
vi.mock("../components/MilestoneToastPreview", () => ({
  MilestoneToastPreview: () => <div />,
}));
vi.mock("../components/PortraitCard", () => ({
  PortraitCard: () => <div />,
}));
vi.mock("@movement/config", () => ({
  WORKER_URL: "https://example.com",
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.mocked(browser.permissions.contains).mockReset();
  vi.mocked(browser.permissions.contains).mockResolvedValue(false);
  vi.mocked(browser.permissions.request).mockReset();
  vi.mocked(browser.permissions.request).mockResolvedValue(true);
  vi.mocked(browser.tabs.getCurrent).mockReset();
  vi.mocked(browser.tabs.getCurrent).mockResolvedValue({
    id: 1,
    index: 0,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
  });
  vi.mocked(browser.tabs.remove).mockReset();
  vi.mocked(browser.tabs.remove).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.set).mockReset();
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.get).mockReset();
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("requests all-site access from a Safari onboarding button", async () => {
  const { default: SetupPage } = await import("../components/SetupPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });

  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Allow on every website",
  );
  expect(button).toBeDefined();
  expect(container.textContent).toContain(
    "When Safari asks, choose “Always Allow on Every Website.”",
  );

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });

  expect(browser.permissions.request).toHaveBeenCalledWith({
    origins: ["http://*/*", "https://*/*"],
  });
  expect(container.textContent).toContain("Safari website access is on.");

  act(() => root.unmount());
  container.remove();
});

it("closes the setup tab after onboarding", async () => {
  const { default: SetupPage } = await import("../components/SetupPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Get started")
      ?.click();
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });
  const finishButton = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Finish setup",
  );
  expect(finishButton).toBeDefined();

  await act(async () => {
    finishButton?.click();
    await Promise.resolve();
  });

  expect(browser.tabs.getCurrent).toHaveBeenCalledOnce();
  expect(browser.tabs.remove).toHaveBeenCalledWith(1);

  act(() => root.unmount());
  container.remove();
});

it("offers recovery when Safari cannot save setup choices", async () => {
  vi.mocked(browser.storage.local.set)
    .mockRejectedValueOnce(
      new Error("Invalid call to browser.storage.local.set(). Disk I/O error."),
    )
    .mockResolvedValueOnce(undefined);
  const { default: SetupPage } = await import("../components/SetupPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Get started")
      ?.click();
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain(
    "Safari couldn’t save your choices. Disable and re-enable we were online in Safari Settings → Extensions, then try again.",
  );
  const retryButton = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Try again",
  );
  expect(retryButton).toBeDefined();
  expect(retryButton?.disabled).toBe(false);

  await act(async () => {
    retryButton?.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("All set!");

  act(() => root.unmount());
  container.remove();
});

async function advanceToDoneStep(container: HTMLElement) {
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Get started")
      ?.click();
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });
}

it("offers recovery when Safari cannot finish setup", async () => {
  vi.mocked(browser.storage.local.set)
    // Consent choices, then the failing finish.
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new Error("Invalid call to browser.storage.local.set(). Disk I/O error."),
    )
    .mockResolvedValueOnce(undefined);
  const { default: SetupPage } = await import("../components/SetupPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Get started")
      ?.click();
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Finish setup")
      ?.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain(
    "Safari couldn’t save your choices. Disable and re-enable we were online in Safari Settings → Extensions, then try again.",
  );
  const retryButton = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Try again",
  );
  expect(retryButton).toBeDefined();
  expect(retryButton?.disabled).toBe(false);

  await act(async () => {
    retryButton?.click();
    await Promise.resolve();
  });

  expect(browser.tabs.remove).toHaveBeenCalledWith(1);

  act(() => root.unmount());
  container.remove();
});

it("offers bookmarking instead of the new tab checkbox on Safari", async () => {
  const { default: SetupPage } = await import("../components/SetupPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });

  await advanceToDoneStep(container);

  // The step and its preview still show, but the opt-in is replaced by advice.
  expect(container.textContent).toContain("Review your browsing");
  expect(container.querySelector("img")).toBeTruthy();
  expect(container.textContent).toContain(
    "Safari doesn't let extensions change the new tab",
  );
  const historyLink = [...container.querySelectorAll("a")].find(
    (element) => element.textContent === "Open History ↗",
  );
  expect(historyLink?.getAttribute("href")).toBe(
    "chrome-extension://test/walking-record.html",
  );
  expect(container.textContent).not.toContain("make this my new tab");
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Finish setup")
      ?.click();
    await Promise.resolve();
  });

  // Safari never opts in to a takeover the browser cannot honor.
  expect(browser.storage.local.set).toHaveBeenCalledWith(
    expect.objectContaining({ newtab_takeover_enabled: false }),
  );

  act(() => root.unmount());
  container.remove();
});
