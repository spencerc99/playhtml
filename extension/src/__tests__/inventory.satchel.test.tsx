// ABOUTME: Covers the inventory satchel's collapsed and expanded presentation contracts.
// ABOUTME: Verifies left-edge docking, six visible slots, and a single active surface.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { InventoryAPI, Item } from "../features/inventory/types";
import { INVENTORY_CSS } from "../features/inventory/inventory.styles";

function makeInventory(): InventoryAPI {
  const items: Item[] = Array.from({ length: 8 }, (_, index) => ({
    id: `item-${index + 1}`,
    tier: "system",
    label: `Item ${index + 1}`,
    icon: `item-${index + 1}.png`,
  }));
  return {
    register: vi.fn(),
    list: () => items,
    arm: vi.fn(),
    disarm: vi.fn(),
    getArmed: () => null,
    onArmedChange: () => () => {},
    hidePageObjects: vi.fn(),
    hidePageObjectsOnSite: vi.fn().mockResolvedValue(undefined),
    showPageObjects: vi.fn(),
    arePageObjectsVisible: () => true,
    onPageObjectsVisibilityChange: () => () => {},
    count: () => Infinity,
  };
}

async function renderSatchel() {
  const { Satchel } = await import("../features/inventory/Satchel");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const inventory = makeInventory();
  await act(async () => {
    root.render(
      <Satchel
        inventory={inventory}
        openSignal={{ at: null, seq: 0 }}
      />,
    );
  });
  return { container, inventory, root };
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("Satchel", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("defaults to the left edge and shows six slots in two columns", async () => {
    const { container, root } = await renderSatchel();
    try {
      expect(container.querySelector(".wwo-nub")?.classList).toContain("edge-l");
      expect(container.querySelectorAll(".wwo-slot")).toHaveLength(6);
      expect(INVENTORY_CSS).toContain("grid-template-columns: repeat(2, 1fr)");
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("replaces the collapsed icon with the expanded kit", async () => {
    const { container, root } = await renderSatchel();
    try {
      const nub = container.querySelector(".wwo-nub");
      expect(nub).toBeInstanceOf(HTMLDivElement);
      Object.assign(nub!, { setPointerCapture: vi.fn() });
      await act(async () => {
        nub?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        nub?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });

      expect(container.querySelector(".wwo-kit")?.classList).toContain("show");
      expect(container.querySelector(".wwo-nub")).toBeNull();
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("arms a numbered item while the kit is open", async () => {
    const { container, inventory, root } = await renderSatchel();
    try {
      const nub = container.querySelector(".wwo-nub");
      Object.assign(nub!, { setPointerCapture: vi.fn() });
      await act(async () => {
        nub?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        nub?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
      });

      expect(inventory.arm).toHaveBeenCalledWith("item-1");
      expect(container.querySelector(".wwo-kit")?.classList).not.toContain("show");
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("hides page objects immediately and offers a site-wide preference", async () => {
    const { container, inventory, root } = await renderSatchel();
    try {
      const nub = container.querySelector(".wwo-nub");
      Object.assign(nub!, { setPointerCapture: vi.fn() });
      await act(async () => {
        nub?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        nub?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      const hide = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "hide",
      );
      await act(async () => {
        hide?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(inventory.hidePageObjects).toHaveBeenCalledOnce();
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
        "Keep the satchel hidden here?",
      );

      const onlyThisTime = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Only this time",
      );
      await act(async () => {
        onlyThisTime?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(inventory.hidePageObjectsOnSite).not.toHaveBeenCalled();
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("saves the hidden default for the current site", async () => {
    const { container, inventory, root } = await renderSatchel();
    try {
      const nub = container.querySelector(".wwo-nub");
      Object.assign(nub!, { setPointerCapture: vi.fn() });
      await act(async () => {
        nub?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        nub?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      const hide = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "hide",
      );
      await act(async () => {
        hide?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const alwaysHide = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Always hide on this site",
      );
      await act(async () => {
        alwaysHide?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(inventory.hidePageObjectsOnSite).toHaveBeenCalledOnce();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("keeps the hide preference prompt inside the viewport", async () => {
    const { container, root } = await renderSatchel();
    try {
      const nub = container.querySelector(".wwo-nub");
      Object.assign(nub!, { setPointerCapture: vi.fn() });
      await act(async () => {
        nub?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        nub?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      const kit = container.querySelector(".wwo-kit") as HTMLDivElement;
      kit.style.left = "900px";
      const hide = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "hide",
      );
      await act(async () => {
        hide?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(
        (container.querySelector('[role="dialog"]') as HTMLDivElement).style.left,
      ).toBe("792px");
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("uses the standard WWO surface and action styling", () => {
    expect(INVENTORY_CSS).toContain("background: #f5f0e8");
    expect(INVENTORY_CSS).toContain("background: #4a9a8a");
    expect(INVENTORY_CSS).toContain(
      "font-family: 'Atkinson Hyperlegible', system-ui, sans-serif",
    );
    expect(INVENTORY_CSS).toContain(
      "font-family: 'Lora', Georgia, serif",
    );
  });
});
