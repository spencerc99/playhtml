// ABOUTME: Tests the extension's internal feature settings screen.
// ABOUTME: Verifies catalog rendering, toggles, and reset behavior.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURE_CATALOG, FEATURE_IDS, type FeatureId, type FeatureState } from "../flags";
import { DeveloperFeaturesPage } from "./DeveloperFeaturesPage";
import {
  clearFeatureOverrides,
  getAllFeatureStates,
  getFeatureOverrides,
  setFeatureOverride,
} from "../features/featureAccess";

vi.mock("./DeveloperFeaturesPage.scss", () => ({}));
vi.mock("../features/featureAccess", () => ({
  clearFeatureOverrides: vi.fn().mockResolvedValue(undefined),
  getAllFeatureStates: vi.fn(),
  getFeatureOverrides: vi.fn(),
  setFeatureOverride: vi.fn().mockResolvedValue(undefined),
}));

const enabledStates = Object.fromEntries(
  FEATURE_IDS.map((feature) => {
    const stage = FEATURE_CATALOG[feature].defaultStage;
    return [feature, {
      enabled: stage === "released",
      available: true,
      stage,
      source: stage === "released" ? "released" : "available",
    }];
  }),
) as Record<FeatureId, FeatureState>;

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<DeveloperFeaturesPage onBack={() => {}} />));
  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("DeveloperFeaturesPage", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(getAllFeatureStates).mockResolvedValue(enabledStates);
    vi.mocked(getFeatureOverrides).mockResolvedValue({ COMMUTE: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("lists the full catalog and toggles the effective feature state", async () => {
    const { container, root } = await renderPage();
    try {
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
        FEATURE_IDS.filter((feature) => FEATURE_CATALOG[feature].defaultStage !== "released").length,
      );
      const commuteToggle = container.querySelector<HTMLInputElement>(
        'input[aria-label="Enable Internet Commute"]',
      );
      await act(async () => commuteToggle?.click());
      expect(setFeatureOverride).toHaveBeenCalledWith("COMMUTE", true);
    } finally {
      cleanup(root, container);
    }
  });

  it("clears local choices through the reset control", async () => {
    const { container, root } = await renderPage();
    try {
      const reset = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Reset choices",
      );
      await act(async () => reset?.click());
      expect(clearFeatureOverrides).toHaveBeenCalledOnce();
    } finally {
      cleanup(root, container);
    }
  });
});
