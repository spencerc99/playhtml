// ABOUTME: Verifies first-time setup continues through the product tour before completion.
// ABOUTME: Covers history, Wikipedia, and social early-access onboarding steps.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import SetupPage from "./SetupPage";
import { savePlayerColor } from "../storage/playerColor";

vi.mock("./SetupPage.scss", () => ({}));
vi.mock("./TrailsHero", () => ({
  TrailsHero: () => null,
}));
vi.mock("./Collections", () => ({
  CollectorList: () => <div>collector choices</div>,
}));
vi.mock("../storage/playerColor", () => ({
  savePlayerColor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage/playerIdentity", () => ({
  getPublicPlayerIdentity: vi.fn().mockResolvedValue({
    playerStyle: { colorPalette: ["#4a9a8a"] },
  }),
}));
vi.mock("@movement/config", () => ({
  WORKER_URL: "https://worker.example",
}));

async function renderSetup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SetupPage />);
    await Promise.resolve();
  });

  return { container, root };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(container: HTMLElement, label: string) {
  await act(async () => {
    button(container, label).click();
    await Promise.resolve();
  });
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("SetupPage", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    });
    window.history.replaceState({}, "", "/");
    vi.spyOn(window, "close").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("introduces history, Wikipedia, and social access before completing setup", async () => {
    const { container, root } = await renderSetup();

    try {
      await click(container, "Get started");
      await click(container, "Continue");

      expect(container.textContent).toContain("Your history");
      expect(browser.storage.local.set).toHaveBeenCalled();
      expect(browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ onboarding_complete: "true" }),
      );
      expect(savePlayerColor).toHaveBeenCalledWith("#4a9a8a");

      await click(container, "Next");
      expect(container.textContent).toContain("Wikipedia");

      await click(container, "Next");
      expect(container.textContent).toContain("More social places are coming");

      const email = container.querySelector<HTMLInputElement>(
        'input[type="email"]',
      );
      expect(email).not.toBeNull();
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setValue?.call(email, "person@example.com");
        email!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(container, "Finish setup");

      expect(browser.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          onboarding_complete: "true",
          setup_email: "person@example.com",
        }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "https://worker.example/subscribe",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "person@example.com",
            source: "extension-setup",
          }),
        }),
      );
    } finally {
      cleanup(root, container);
    }
  });

  it("shows direct step navigation only with the dev query parameter", async () => {
    const regular = await renderSetup();
    expect(
      regular.container.querySelector('[aria-label="Setup step preview"]'),
    ).toBeNull();
    cleanup(regular.root, regular.container);

    window.history.replaceState({}, "", "/?dev");
    const preview = await renderSetup();

    try {
      const devNav = preview.container.querySelector(
        '[aria-label="Setup step preview"]',
      );
      expect(devNav).not.toBeNull();

      await click(preview.container, "wikipedia");
      expect(preview.container.textContent).toContain(
        "Wikipedia feels inhabited",
      );
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    } finally {
      cleanup(preview.root, preview.container);
    }
  });
});
