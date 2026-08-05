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
  vi.mocked(browser.tabs.getCurrent).mockResolvedValue({ id: 1 });
  vi.mocked(browser.tabs.remove).mockReset();
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
      .find((element) => element.textContent === "Let's go")
      ?.click();
    await Promise.resolve();
  });

  const closeButton = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Close",
  );
  expect(closeButton).toBeDefined();

  await act(async () => {
    closeButton?.click();
    await Promise.resolve();
  });

  expect(browser.tabs.getCurrent).toHaveBeenCalledOnce();
  expect(browser.tabs.remove).toHaveBeenCalledWith(1);

  act(() => root.unmount());
  container.remove();
});
