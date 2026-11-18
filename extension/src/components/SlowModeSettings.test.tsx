// ABOUTME: Verifies the popup's scenic route (Slow Mode) controls, train board button, and ride history.
// ABOUTME: Confirms setting and frequency changes persist through extension storage.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  SLOW_MODE_SETTINGS_KEY,
  SLOW_MODE_STATE_KEY,
  type SlowModeState,
} from "../features/slowMode/slowMode";
import { SlowModeSettings } from "./SlowModeSettings";

const ENABLED_SETTINGS = {
  enabled: true,
  chancePercent: 40,
  stopVisibility: "domain",
};

const EMPTY_STATE: SlowModeState = {
  lastCommuteAt: null,
  lastCommuteByDomain: {},
  rides: [],
};

function mockStorage(values: Record<string, unknown>) {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [SLOW_MODE_SETTINGS_KEY]: ENABLED_SETTINGS,
    [SLOW_MODE_STATE_KEY]: EMPTY_STATE,
    ...values,
  });
}

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, root };
}

function setSelect(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SlowModeSettings", () => {
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockStorage({});
    vi.mocked(browser.storage.local.set).mockClear();
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("names the setting scenic route and persists frequency changes", async () => {
    const rendered = await render(<SlowModeSettings />);
    root = rendered.root;
    const { container } = rendered;

    expect(container.textContent).toContain("scenic route");
    expect(container.textContent).toContain("no rides yet today");
    expect(
      container.querySelector('input[aria-label="Take the scenic route"]'),
    ).not.toBeNull();

    const chance = container.querySelector<HTMLSelectElement>(
      "select.scenic-route__chance",
    )!;
    expect(chance.value).toBe("40");
    await act(async () => setSelect(chance, "70"));

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [SLOW_MODE_SETTINGS_KEY]: { ...ENABLED_SETTINGS, chancePercent: 70 },
    });
  });

  it("collapses frequency, stop sharing, and history while turned off", async () => {
    mockStorage({
      [SLOW_MODE_SETTINGS_KEY]: { ...ENABLED_SETTINGS, enabled: false },
    });
    const rendered = await render(<SlowModeSettings />);
    root = rendered.root;
    const { container } = rendered;

    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.textContent).not.toContain("share my stop");
    expect(container.textContent).not.toContain("today");

    const toggle = container.querySelector<HTMLInputElement>(
      'input[aria-label="Take the scenic route"]',
    )!;
    await act(async () => toggle.click());

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [SLOW_MODE_SETTINGS_KEY]: ENABLED_SETTINGS,
    });
    expect(container.textContent).toContain("share my stop");
  });

  it("boards the commute from the train button", async () => {
    const onBoard = vi.fn();
    const rendered = await render(<SlowModeSettings onBoard={onBoard} />);
    root = rendered.root;

    const train =
      rendered.container.querySelector<HTMLButtonElement>(".board-train")!;
    expect(train.getAttribute("aria-label")).toBe("Board the Internet Commute");
    await act(async () => train.click());
    expect(onBoard).toHaveBeenCalledTimes(1);
  });

  it("leaves out the train button when there is no way to board", async () => {
    const rendered = await render(<SlowModeSettings />);
    root = rendered.root;

    expect(rendered.container.querySelector(".board-train")).toBeNull();
  });

  it("folds today's rides behind a history toggle", async () => {
    const now = Date.now();
    mockStorage({
      [SLOW_MODE_STATE_KEY]: {
        lastCommuteAt: null,
        lastCommuteByDomain: {},
        rides: [
          {
            id: "ride-1",
            startedAt: now,
            destinationUrl: "https://arena.example/",
            destinationDomain: "arena.example",
            stopCount: 5,
            outcome: "arrived",
          },
          {
            id: "ride-2",
            startedAt: now,
            destinationUrl: "https://neocities.example/",
            destinationDomain: "neocities.example",
            stopCount: 3,
            outcome: "left",
          },
        ],
      },
    });
    const rendered = await render(<SlowModeSettings />);
    root = rendered.root;
    const { container } = rendered;

    const history = container.querySelector<HTMLDetailsElement>(
      "details.scenic-route__history",
    )!;
    expect(history.open).toBe(false);
    expect(history.querySelector("summary")?.textContent).toContain(
      "2 commutes today",
    );
    expect(history.textContent).toContain(
      "commuted to arena.example · 5 stops",
    );
    expect(history.textContent).toContain(
      "stepped off before neocities.example · 3 stops",
    );
  });
});
