// ABOUTME: Verifies first-time setup preserves its completion previews before completion.
// ABOUTME: Covers History, Wikipedia, milestone, and dev-navigation content.

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
vi.mock("./MilestoneToastPreview", () => ({
  MilestoneToastPreview: () => <div>milestone preview</div>,
}));
vi.mock("@movement/config", () => ({
  WORKER_URL: "https://worker.example",
}));
vi.mock("../storage/playerColor", () => ({
  savePlayerColor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage/playerIdentity", () => ({
  getPublicPlayerIdentity: vi.fn().mockResolvedValue({
    playerStyle: { colorPalette: ["#4a9a8a"] },
  }),
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

async function fillEmail(container: HTMLElement, value: string) {
  const email = container.querySelector<HTMLInputElement>(
    'input[type="email"]',
  );
  if (!email) throw new Error("Missing email input");

  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(email, value);
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("SetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    });
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.tabs.getCurrent).mockResolvedValue({
      id: 1,
      index: 0,
      highlighted: true,
      active: true,
      pinned: false,
      incognito: false,
    });
    vi.mocked(browser.tabs.remove).mockResolvedValue(undefined);
    vi.spyOn(window, "close").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps the original completion tips and adds History and Wikipedia", async () => {
    const { container, root } = await renderSetup();

    try {
      expect(container.textContent).toContain(
        "we were online turns the existing Internet into a living, shared world. Let's get you set up in a few steps so we can respect your preferences for privacy and share how the extension works.",
      );
      expect(container.textContent).toContain(
        "Email for project updates (optional)",
      );
      expect(container.textContent).toContain(
        "Get occasional updates about we were online and opportunities to help shape new features",
      );
      expect(container.textContent).toContain("Help shape WWO");
      expect(container.textContent).toContain("takes about a minute");
      expect(container.textContent).not.toContain(
        "The Discord is always open",
      );
      expect(
        container.querySelector(".setup-step__discord-card svg"),
      ).toBeNull();
      expect(container.querySelector('input[type="email"]')).not.toBeNull();

      await click(container, "Get started");
      await click(container, "Continue");

      expect(container.textContent).toContain("All set!");
      expect(
        container.querySelector(".setup-page__inner--complete"),
      ).not.toBeNull();
      expect(container.querySelector(".setup-step--complete")).not.toBeNull();
      expect(container.textContent).toContain("See your trail, anywhere");
      expect(container.querySelector(".setup-step__trail-preview")).not.toBeNull();
      expect(
        container
          .querySelector(".setup-step__trail-preview svg")
          ?.getAttribute("aria-hidden"),
      ).toBe("true");
      expect(container.textContent).toContain("See your progress");
      expect(container.textContent).toContain(
        "in your browser toolbar anytime to see your current portrait. Pin it to keep it one click away.",
      );
      const toolbarIcon = container.querySelector(
        ".setup-step__progress-note .setup-step__toolbar-icon img",
      );
      expect(toolbarIcon?.getAttribute("src")).toContain("icon/32.png");
      expect(toolbarIcon?.getAttribute("alt")).toBe(
        "we were online extension icon",
      );
      expect(container.textContent).not.toContain("See your current portrait");
      expect(container.querySelector(".setup-step__portrait-preview")).toBeNull();
      expect(container.textContent).toContain("Review your browsing");
      expect(container.textContent).toContain("milestone preview");
      expect(container.textContent).toContain(
        "We'll share some of your progress as you browse.",
      );
      expect(container.textContent).toContain("Wikipedia feels inhabited");
      expect(container.querySelector('input[type="email"]')).toBeNull();
      expect(browser.storage.local.set).toHaveBeenCalled();
      expect(browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ onboarding_complete: "true" }),
      );
      expect(savePlayerColor).toHaveBeenCalledWith("#4a9a8a");

      await click(container, "Finish setup");

      expect(browser.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ onboarding_complete: "true" }),
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it("subscribes through the Worker before completing setup", async () => {
    const { container, root } = await renderSetup();

    try {
      await fillEmail(container, "person@example.com");
      await click(container, "Get started");
      await click(container, "Continue");
      await click(container, "Finish setup");

      await vi.waitFor(() => {
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
      });
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        onboarding_complete: "true",
        newtab_takeover_enabled: true,
        setup_email: "person@example.com",
      });
    } finally {
      cleanup(root, container);
    }
  });

  it("completes setup when the optional subscription request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { container, root } = await renderSetup();

    try {
      await fillEmail(container, "person@example.com");
      await click(container, "Get started");
      await click(container, "Continue");
      await click(container, "Finish setup");

      await vi.waitFor(() => {
        expect(container.querySelector('[role="status"]')?.textContent).toContain(
          "Setup is complete, but we couldn’t sign you up for updates",
        );
      });
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        onboarding_complete: "true",
        newtab_takeover_enabled: true,
      });
      expect(browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ setup_email: "person@example.com" }),
      );
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      expect(button(container, "Close setup")).toBeDefined();

      await click(container, "Close setup");
      await vi.waitFor(() => {
        expect(browser.tabs.remove).toHaveBeenCalledWith(1);
      });
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

      await click(preview.container, "complete");
      expect(preview.container.textContent).toContain("All set!");
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    } finally {
      cleanup(preview.root, preview.container);
    }
  });
});
