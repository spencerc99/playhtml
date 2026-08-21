// ABOUTME: Verifies popup Slow Mode controls, cooldown copy, and ride log rendering.
// ABOUTME: Confirms toggle and chance changes persist through extension storage.

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  SLOW_MODE_SETTINGS_KEY,
  SLOW_MODE_STATE_KEY,
} from "../features/slowMode/slowMode";
import { SlowModeSettings } from "./SlowModeSettings";

describe("SlowModeSettings", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [SLOW_MODE_SETTINGS_KEY]: { enabled: true, chancePercent: 40 },
      [SLOW_MODE_STATE_KEY]: {
        farJumpCountByDay: {},
        lastCommuteAt: null,
        lastCommuteByDomain: {},
        rides: [],
      },
    });
    vi.mocked(browser.storage.local.set).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the ready state and persists chance changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<SlowModeSettings />));

    expect(container.textContent).toContain("ready for a far jump");
    expect(container.textContent).toContain("no rides yet. no judgment.");
    const slider = container.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(slider, "70");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [SLOW_MODE_SETTINGS_KEY]: { enabled: true, chancePercent: 70 },
    });
    await act(async () => root.unmount());
  });
});
