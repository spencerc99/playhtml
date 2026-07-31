// ABOUTME: Verifies the commute install ticket only appears without the extension.
// ABOUTME: Covers delayed display and late content-script detection.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTENSION_INSTALL_ATTRIBUTE,
  markExtensionInstalled,
} from "../../utils/extensionInstallMarker";
import { CommuteInstallPrompt } from "./CommuteInstallPrompt";

async function renderPrompt(): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<CommuteInstallPrompt />);
  });

  return { container, root };
}

describe("CommuteInstallPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute(EXTENSION_INSTALL_ATTRIBUTE);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("appears after the extension detection window", async () => {
    const { container, root } = await renderPrompt();

    expect(container.querySelector(".commute-install-cta")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(container.textContent).toContain("get the extension");
    const link = container.querySelector("a");
    expect(link?.href).toBe("https://wewere.online/");
    expect(link?.target).toBe("_blank");
    act(() => root.unmount());
  });

  it("stays hidden when the extension is already installed", async () => {
    markExtensionInstalled(document.documentElement);
    const { container, root } = await renderPrompt();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(container.querySelector(".commute-install-cta")).toBeNull();
    act(() => root.unmount());
  });

  it("disappears when the content script arrives after the page", async () => {
    const { container, root } = await renderPrompt();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(container.querySelector(".commute-install-cta")).not.toBeNull();

    await act(async () => {
      markExtensionInstalled(document.documentElement);
      await Promise.resolve();
    });

    expect(container.querySelector(".commute-install-cta")).toBeNull();
    act(() => root.unmount());
  });
});
