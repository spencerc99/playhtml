// ABOUTME: Verifies standalone extension pages share one navigation contract.
// ABOUTME: Covers active-page labeling and the internal-only scraps visibility gate.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { ExtensionPageNav } from "../components/ExtensionPageNav";

vi.mock("../components/ExtensionPageNav.scss", () => ({}));

async function renderNavigation(currentPage: "portrait" | "time") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<ExtensionPageNav currentPage={currentPage} />);
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("ExtensionPageNav", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the shared public pages and identifies the current page", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      internalDevFeaturesEnabled: false,
    });
    const { container, root } = await renderNavigation("portrait");

    try {
      expect(container.textContent).toContain("portrait");
      expect(container.textContent).toContain("history");
      expect(container.textContent).not.toContain("time");
      expect(container.textContent).not.toContain("walking record");
      expect(container.textContent).not.toContain("scraps");
      expect(
        container.querySelector('[aria-current="page"]')?.textContent,
      ).toBe("portrait");
    } finally {
      cleanup(root, container);
    }
  });

  it("does not release scraps through internal development mode", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      internalDevFeaturesEnabled: true,
    });
    const { container, root } = await renderNavigation("portrait");

    try {
      expect(container.textContent).not.toContain("scraps");
      expect(browser.storage.local.get).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });
});
