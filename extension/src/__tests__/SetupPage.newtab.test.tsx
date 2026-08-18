// ABOUTME: Covers the new tab step of setup on browsers that support the override.
// ABOUTME: The opt-in checkbox is offered here, unlike Safari's bookmark advice.

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

async function renderToNewTabStep() {
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

  return { container, root };
}

it("offers the new tab opt-in checkbox off Safari", async () => {
  const { container, root } = await renderToNewTabStep();

  expect(container.textContent).toContain("See your browsing evolve");
  expect(container.textContent).toContain("make this my new tab");
  expect(container.textContent).not.toContain(
    "Safari doesn't let extensions change the new tab",
  );

  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(checkbox).toBeTruthy();
  // Presented as an opt-out: checked by default.
  expect(checkbox?.checked).toBe(true);

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });

  expect(browser.storage.local.set).toHaveBeenCalledWith({
    newtab_takeover_enabled: true,
  });

  act(() => root.unmount());
  container.remove();
});

it("records declining the new tab takeover", async () => {
  const { container, root } = await renderToNewTabStep();

  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  await act(async () => {
    checkbox!.click();
    await Promise.resolve();
  });

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((element) => element.textContent === "Continue")
      ?.click();
    await Promise.resolve();
  });

  expect(browser.storage.local.set).toHaveBeenCalledWith({
    newtab_takeover_enabled: false,
  });

  act(() => root.unmount());
  container.remove();
});
