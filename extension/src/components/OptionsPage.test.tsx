// ABOUTME: Covers the full settings page section structure and title search.
// ABOUTME: Verifies filtering hides section cards whose titles do not match.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { OptionsPage } from "./OptionsPage";

vi.mock("./OptionsPage.scss", () => ({}));
vi.mock("./Collections", () => ({
  DataCollectionSection: () => <div>collection controls</div>,
  YourDataSection: () => <div>data controls</div>,
  DeveloperModeSection: () => <div>developer controls</div>,
}));
vi.mock("./DeveloperFeaturesPage", () => ({
  DeveloperFeaturesSection: () => <div>feature controls</div>,
}));
vi.mock("../features/useFeatureAccess", () => ({
  useExperimentAccess: () => false,
  useFeatureState: () => ({ enabled: true }),
}));
vi.mock("../utils/extensionPage", () => ({
  isSafariExtensionPageUrl: () => false,
}));
vi.mock("../storage/playerIdentity", () => ({
  getPublicPlayerIdentity: vi.fn().mockResolvedValue({
    publicKey: "pk_12345678901234567890abcdef",
    playerStyle: { colorPalette: ["#4a9a8a"] },
  }),
}));
vi.mock("../storage/playerColor", () => ({
  savePlayerColor: vi.fn(),
}));
vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

async function renderOptions() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<OptionsPage />);
    await Promise.resolve();
  });
  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("OptionsPage", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders every settings section heading", async () => {
    const { container, root } = await renderOptions();
    try {
      expect(
        Array.from(
          container.querySelectorAll(".options-page__section > h1"),
        ).map((heading) => heading.textContent),
      ).toEqual([
        "Identity",
        "Data collection",
        "New tab",
        "Project updates",
        "Bag settings",
        "Experiments",
        "Community",
        "Your data",
        "Developer",
      ]);
    } finally {
      cleanup(root, container);
    }
  });

  it("shows bag settings only when the feature is enabled", async () => {
    const { container, root } = await renderOptions();
    try {
      expect(container.querySelector("#bag-settings")).not.toBeNull();
      expect(container.textContent).toContain("Current Site");
      expect(container.textContent).toContain("Quick Actions");
      expect(
        container
          .querySelector(".options-page__access-request button")
          ?.textContent?.trim(),
      ).toBe("Request early access");
      expect(container.textContent).toContain(
        "Leaving an email also signs you up for occasional project updates.",
      );
    } finally {
      cleanup(root, container);
    }
  });

  it("hides sections whose titles do not match the search", async () => {
    const { container, root } = await renderOptions();
    try {
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search settings"]',
      );
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setValue?.call(input, "community");
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(container.querySelector("#community")).not.toBeNull();
      expect(container.querySelector("#identity")).toBeNull();
      expect(container.querySelector("#data-collection")).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });
});
