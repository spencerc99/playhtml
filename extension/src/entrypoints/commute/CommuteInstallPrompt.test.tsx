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
import { CommuteStationPoster } from "./CommuteStationPoster";

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

    expect(container.textContent).toContain("internet transit pass");
    expect(container.textContent).toContain("join the ride");
    expect(container.textContent).toContain("get the extension");
    expect(container.textContent).not.toContain("add your stops");
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

  it("opens and dismisses the station poster overlay", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<CommuteStationPoster stationVisible />);
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    const poster = container.querySelector<HTMLButtonElement>(
      ".station-install-poster",
    );
    expect(poster?.getAttribute("aria-label")).toBe(
      "Open the internet transit pass poster",
    );
    act(() => poster?.click());

    const dialog = document.querySelector<HTMLElement>(
      ".commute-poster-dialog",
    );
    expect(dialog?.textContent).toContain("internet transit pass");
    expect(dialog?.textContent).toContain("join the ride");
    expect(dialog?.textContent).toContain(
      "this line runs on the stops of riders like you — install we were online and the places you visit become stations on everyone's commute.",
    );
    expect(dialog?.querySelector("a")?.href).toBe("https://wewere.online/");

    act(() =>
      dialog
        ?.querySelector<HTMLButtonElement>(
          ".commute-poster-dialog__close",
        )
        ?.click(),
    );
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();

    act(() => poster?.click());
    const backdrop = document.querySelector<HTMLElement>(
      ".commute-poster-backdrop",
    );
    act(() => {
      backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();

    act(() => poster?.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();
    act(() => root.unmount());
  });

  it("removes the poster trigger while the station is offscreen but keeps an open overlay", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<CommuteStationPoster stationVisible={false} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(container.querySelector(".station-install-poster")).toBeNull();

    act(() => {
      root.render(<CommuteStationPoster stationVisible />);
    });
    const poster = container.querySelector<HTMLButtonElement>(
      ".station-install-poster",
    );
    act(() => poster?.click());
    expect(document.querySelector(".commute-poster-dialog")).not.toBeNull();

    act(() => {
      root.render(<CommuteStationPoster stationVisible={false} />);
    });
    expect(container.querySelector(".station-install-poster")).toBeNull();
    expect(document.querySelector(".commute-poster-dialog")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();
    act(() => root.unmount());
  });
});
