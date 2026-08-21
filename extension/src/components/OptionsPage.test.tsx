// ABOUTME: Covers the full settings page structure and merged settings groups.
// ABOUTME: Verifies navigation order and dividers between card content blocks.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { OptionsPage } from "./OptionsPage";

const featureState = vi.hoisted(() => ({
  experimentAccess: false,
  bagSettingsEnabled: true,
}));

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
  useExperimentAccess: () => featureState.experimentAccess,
  useFeatureState: () => ({ enabled: featureState.bagSettingsEnabled }),
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
    featureState.experimentAccess = false;
    featureState.bagSettingsEnabled = true;
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
        "Browser",
        "Bag settings",
        "Experiments",
        "Community",
        "Your data",
      ]);
      expect(
        Array.from(container.querySelectorAll("nav a")).map(
          (link) => link.textContent,
        ),
      ).toEqual([
        "identity",
        "data collection",
        "browser",
        "bag settings",
        "experiments",
        "community",
        "your data",
      ]);
    } finally {
      cleanup(root, container);
    }
  });

  it("keeps bag settings feature-gated in its existing position", async () => {
    featureState.bagSettingsEnabled = false;
    const { container, root } = await renderOptions();
    try {
      expect(container.querySelector("#bag-settings")).toBeNull();
      expect(
        Array.from(container.querySelectorAll("nav a")).map(
          (link) => link.textContent,
        ),
      ).toEqual([
        "identity",
        "data collection",
        "browser",
        "experiments",
        "community",
        "your data",
      ]);
    } finally {
      cleanup(root, container);
    }
  });

  it("merges project updates into Community and Developer mode into Experiments", async () => {
    const { container, root } = await renderOptions();
    try {
      expect(container.querySelector("#project-updates")).toBeNull();
      expect(container.querySelector("#developer")).toBeNull();
      expect(container.querySelector("#community")?.textContent).toContain(
        "Only used for occasional project updates.",
      );
      expect(container.querySelector("#community")?.textContent).toContain(
        "Subscribe",
      );
      expect(container.querySelector("#experiments")?.textContent).toContain(
        "developer controls",
      );
      expect(container.querySelector('input[type="search"]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it("does not render a divider before the first Experiments card block", async () => {
    const { container, root } = await renderOptions();
    try {
      const accessRequest = container.querySelector(
        ".options-page__access-request",
      );
      expect(accessRequest?.previousElementSibling).toBeNull();
      expect(
        accessRequest?.classList.contains(
          "options-page__access-request--divided",
        ),
      ).toBe(false);
    } finally {
      cleanup(root, container);
    }
  });

  it("renders dividers when Experiments card blocks have content above them", async () => {
    featureState.experimentAccess = true;
    const { container, root } = await renderOptions();
    try {
      const accessRequest = container.querySelector(
        ".options-page__access-request",
      );
      expect(accessRequest?.previousElementSibling?.textContent).toContain(
        "feature controls",
      );
      expect(
        accessRequest?.classList.contains(
          "options-page__access-request--divided",
        ),
      ).toBe(true);

      const developerMode = container.querySelector(
        ".options-page__developer-mode",
      );
      expect(developerMode?.previousElementSibling).toBe(accessRequest);
      expect(
        developerMode?.classList.contains(
          "options-page__developer-mode--divided",
        ),
      ).toBe(true);
    } finally {
      cleanup(root, container);
    }
  });
});
